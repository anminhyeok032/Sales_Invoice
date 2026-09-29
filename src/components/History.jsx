import React, { useState, useRef, useEffect, useMemo } from 'react';
import useStore, { resolveSupplier } from '../store';
import { useReactToPrint } from 'react-to-print';
import TransactionPrintTemplate from './TransactionPrintTemplate';
import { Printer, Trash2, Plus, Save, Link2, Unlink, DatabaseBackup } from 'lucide-react';
import {
  isFileSystemAccessSupported,
  getConnectedHandle,
  connectBackupFile,
  disconnectBackupFile,
  writeTransactionsBackup,
} from '../lib/transactionExcelSync';
import { applyItemChange, createEmptyItem, computeTotals } from '../lib/transactionItems';
import { matchReceiver, receiverInfo } from '../lib/companyLookup';
import { parseLegacyImportFile, summarizeImport, mergeCompanies } from '../lib/legacyImport';
import { toDateKey, isWithinRange } from '../lib/dateRange';
import TransactionItemsTable from './TransactionItemsTable';
import CollapsibleCard from './CollapsibleCard';
import { applyOverride, patchFor } from '../lib/partyOverride';
import { PartiesPanel } from './StatementPartiesCard';

// 한 번에 그리는 최대 줄 수. 가져온 내역이 수천 건이라 전부 그리면 목록이 버벅인다.
const VISIBLE_LIMIT = 500;

const pad2 = (n) => String(n).padStart(2, '0');
const won = (n) => n.toLocaleString();
const fmtDate = (key, raw) => (key ? `${key.slice(0, 4)}.${key.slice(4, 6)}.${key.slice(6, 8)}` : (raw || ''));

// 기간 칸이 정확히 한 해(quarter 0)나 한 분기이면 그 값. 비어 있으면 전체. 그 밖에는 null(직접 입력).
function periodOf(fromKey, toKey) {
  if (!fromKey && !toKey) return { year: '', quarter: 0 };
  if (!fromKey || !toKey || fromKey.slice(0, 4) !== toKey.slice(0, 4)) return null;
  const year = fromKey.slice(0, 4);
  const md = `${fromKey.slice(4)}-${toKey.slice(4)}`;
  if (md === '0101-1231') return { year, quarter: 0 };
  for (let q = 1; q <= 4; q += 1) {
    const last = new Date(Number(year), q * 3, 0).getDate();
    if (md === `${pad2(q * 3 - 2)}01-${pad2(q * 3)}${pad2(last)}`) return { year, quarter: q };
  }
  return null;
}

function History() {
  const {
    transactions, transactionsLoaded, companies, deleteTransaction, saveTransaction,
    importTransactions, setCompanies, setCompaniesDirty,
    transactionExcelFileName, setTransactionExcelFileName,
  } = useStore();
  const [selectedTx, setSelectedTx] = useState(null);
  // 저장할 때 골랐던 공급자로 다시 찍는다. 예전 프로그램에서 가져온 내역처럼 기록이
  // 없거나, 그 공급자를 지웠으면 기본 공급자.
  const supplier = useStore((state) => resolveSupplier(state, selectedTx?.supplierId));
  // 자동 작성에서 이 명세서만 고쳐 둔 공급자/공급받는자 칸. 여기서는 고치지 않고 출력에만 반영한다.
  const printSupplier = applyOverride(supplier, selectedTx?.supplierOverride?.[supplier.id]);

  // 공급받는자: 저장할 때 고른 거래처(receiverId). 이 기능 전에 저장돼 엑셀 이름('가나')만
  // 남아 있거나 그 거래처를 지웠으면, 자동 작성과 같은 방식으로 이름을 비교해 찾는다.
  const receiverAliases = useStore((state) => state.receiverAliases);
  const receiverMatch = useMemo(() => {
    if (!selectedTx) return null;
    const auto = matchReceiver(companies, selectedTx.companyName, receiverAliases);
    const saved = companies.find((c) => c.id === selectedTx.receiverId);
    if (saved) return { ...auto, company: saved, how: 'saved', ambiguous: false };
    if (selectedTx.receiverId === '') return { ...auto, company: null, how: 'saved', ambiguous: false };
    return auto;
  }, [selectedTx, companies, receiverAliases]);
  const receiverBase = selectedTx && receiverInfo(receiverMatch.company, selectedTx.companyName);
  const receiverPatch = selectedTx && patchFor(selectedTx.receiverOverride, receiverMatch.company?.id ?? '');
  const printReceiver = selectedTx && applyOverride(receiverBase, receiverPatch);
  const printRef = useRef();
  const importInputRef = useRef();
  const [importError, setImportError] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [sortKey, setSortKey] = useState('date');   // date | name | amount
  const [sortDesc, setSortDesc] = useState(true);

  // 목록 한 줄에 보여줄 값. 기존 프로그램 목록처럼 작성일자 / 내용 / 상호명 / 금액 / 세액 / 합계.
  //  - 상호명: 엑셀 이름('가나')이 아니라 실제로 인쇄되는 공급받는자 상호
  //  - 내용: 첫 품목 + '외 N종' (기존 프로그램이 만들던 방식)
  // 목록 전체(수천 건)를 도는 계산이라, 이름 비교(fuzzy)는 하지 않고 id/별칭/이름 일치만 본다.
  const rows = useMemo(() => {
    const byId = new Map(companies.map((c) => [c.id, c]));
    return transactions.map((tx) => {
      const company = byId.get(tx.receiverId) || byId.get(receiverAliases[tx.companyName])
        || companies.find((c) => c.name === tx.companyName);
      const override = patchFor(tx.receiverOverride, company?.id ?? '');
      const named = (tx.items || []).filter((i) => String(i.name || '').trim());
      const totals = computeTotals(tx.items || []);
      // 기존 DB에는 상호 앞에 공백이 붙은 것('  천 일 정 공 (주)')이 있다. 화면에서는 안 보이지만
      // 정렬하면 맨 앞으로 튀어나오므로, 앞뒤 공백은 떼고 정렬할 때는 공백을 모두 무시한다.
      const name = String(override?.name || company?.name || tx.companyName || '').trim();
      return {
        tx,
        dateKey: toDateKey(tx.date),
        name,
        sortName: name.replace(/\s+/g, ''),
        summary: named.length ? `${named[0].name.trim()}${named.length > 1 ? ` 외 ${named.length - 1}종` : ''}` : '',
        ...totals,
      };
    });
  }, [transactions, companies, receiverAliases]);

  // 조회 대상 거래처는 저장된 내역에 실제로 있는 상호만 보여준다.
  const companyOptions = useMemo(
    () => [...new Set(rows.map((r) => r.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
    [rows]
  );
  const yearOptions = useMemo(
    () => [...new Set(rows.map((r) => r.dateKey.slice(0, 4)).filter(Boolean))].sort().reverse(),
    [rows]
  );

  const fromKey = toDateKey(fromDate);
  const toKey = toDateKey(toDate);
  const filterActive = Boolean(fromKey || toKey || companyFilter);

  const filtered = useMemo(() => {
    const dir = sortDesc ? -1 : 1;
    const cmp = {
      date: (a, b) => a.dateKey.localeCompare(b.dateKey),
      name: (a, b) => a.sortName.localeCompare(b.sortName, 'ko'),
      amount: (a, b) => a.total - b.total,
    }[sortKey];
    return rows
      .filter((r) => (companyFilter ? r.name === companyFilter : true))
      .filter((r) => isWithinRange(r.tx.date, fromKey, toKey))
      .sort((a, b) => dir * cmp(a, b) || dir * a.dateKey.localeCompare(b.dateKey));
  }, [rows, companyFilter, fromKey, toKey, sortKey, sortDesc]);

  // 아래 고정 줄: 지금 조회된 목록 전체의 매출 합계(화면에 다 그리지 않은 줄까지).
  const listTotals = useMemo(() => filtered.reduce(
    (acc, r) => ({ supply: acc.supply + r.supply, tax: acc.tax + r.tax, total: acc.total + r.total }),
    { supply: 0, tax: 0, total: 0 },
  ), [filtered]);

  // 연도/분기 빠른 선택. 따로 상태를 두지 않고 기간 칸을 채우기만 한다 —
  // 기간 칸이 정확히 그 연도/분기이면 그 값으로 보이고, 직접 고친 기간이면 '직접 입력'.
  const period = periodOf(fromKey, toKey);
  const setPeriod = (year, quarter) => {
    if (!year) { setFromDate(''); setToDate(''); return; }
    const [m1, m2] = quarter ? [quarter * 3 - 2, quarter * 3] : [1, 12];
    const last = new Date(Number(year), m2, 0).getDate();
    const yy = year.slice(2);
    setFromDate(`${yy}.${pad2(m1)}.01`);
    setToDate(`${yy}.${pad2(m2)}.${pad2(last)}`);
  };

  const resetFilters = () => {
    setFromDate('');
    setToDate('');
    setCompanyFilter('');
  };

  // --- Local excel backup of the saved transaction history (write-only) ---
  const [backupStatus, setBackupStatus] = useState('checking'); // checking | unsupported | disconnected | connected
  const [backupError, setBackupError] = useState('');

  useEffect(() => {
    if (!isFileSystemAccessSupported()) {
      setBackupStatus('unsupported');
      return;
    }
    (async () => {
      const handle = await getConnectedHandle();
      if (handle) {
        setTransactionExcelFileName(handle.name);
        setBackupStatus('connected');
      } else {
        setBackupStatus('disconnected');
      }
    })();
  }, []);

  const handleConnectBackup = async () => {
    try {
      const handle = await connectBackupFile();
      setTransactionExcelFileName(handle.name);
      setBackupStatus('connected');
      await writeTransactionsBackup(useStore.getState().transactions);
      setBackupError('');
    } catch (err) {
      if (err.name !== 'AbortError') {
        setBackupError('백업 파일 연결에 실패했습니다: ' + err.message);
      }
    }
  };

  const handleDisconnectBackup = async () => {
    await disconnectBackupFile();
    setTransactionExcelFileName('');
    setBackupStatus('disconnected');
    setBackupError('');
  };

  const backupNow = async () => {
    if (backupStatus !== 'connected') return;
    try {
      await writeTransactionsBackup(useStore.getState().transactions);
      setBackupError('');
    } catch (err) {
      setBackupError('백업 저장 중 오류가 발생했습니다: ' + err.message);
    }
  };

  // --- 기존 프로그램(Tradetax.gdb) 내역 가져오기 ---
  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';   // 같은 파일을 다시 골라도 change가 걸리도록
    if (!file) return;

    setImportError('');
    setImportNotice('');
    try {
      const parsed = parseLegacyImportFile(await file.text());
      const state = useStore.getState();
      const s = summarizeImport(parsed, state.transactions, state.companies);

      const lines = [
        `${file.name} 을(를) 가져옵니다.`,
        '',
        `거래명세서 ${s.total.toLocaleString()}건 (품목 ${s.items.toLocaleString()}줄)`,
        `  · 새로 추가: ${s.added.toLocaleString()}건`,
        `  · 이미 있어서 덮어씀: ${s.overwritten.toLocaleString()}건`,
        s.minYear ? `  · 기간: ${s.minYear}년 ~ ${s.maxYear}년` : '',
        '',
        s.newCompanies > 0
          ? `거래처 ${s.newCompanies}곳이 새로 추가됩니다 (기존 거래처 정보는 그대로 둡니다).`
          : '새로 추가할 거래처는 없습니다.',
        '',
        '진행할까요?',
      ].filter(Boolean);
      if (!window.confirm(lines.join('\n'))) return;

      importTransactions(parsed.transactions);
      if (s.newCompanies > 0) {
        setCompanies(mergeCompanies(state.companies, parsed.companies));
        // 업체목록.xls와 연동 중이면 새로 들어온 거래처를 아직 그 파일에 안 썼다는
        // 표시를 남긴다. CompanyManager와 같은 규칙 — 연동 중일 때만 dirty로 둔다.
        if (state.companyExcelFileName) setCompaniesDirty(true);
      }
      setImportNotice(
        `거래명세서 ${s.total.toLocaleString()}건을 가져왔습니다` +
        (s.newCompanies > 0 ? `, 거래처 ${s.newCompanies}곳 추가.` : '.')
      );
      await backupNow();
    } catch (err) {
      setImportError('가져오기에 실패했습니다: ' + err.message);
    }
  };

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: selectedTx ? `거래명세서_${selectedTx.companyName}_${selectedTx.year}년${selectedTx.month}월` : '명세서',
  });


  const setItems = (items) => {
    if (!selectedTx) return;
    setSelectedTx({ ...selectedTx, items });
  };

  const handleItemChange = (index, field, value) => {
    if (!selectedTx) return;
    setItems(applyItemChange(selectedTx.items, index, field, value));
  };

  const addItem = () => {
    if (!selectedTx) return;
    setItems([...selectedTx.items, createEmptyItem()]);
  };

  const deleteItem = (index) => {
    if (!selectedTx) return;
    const newItems = [...selectedTx.items];
    newItems.splice(index, 1);
    setItems(newItems);
  };

  const handleSave = () => {
    if (!selectedTx) return;
    saveTransaction(selectedTx);
    backupNow();
    alert('수정된 내용이 안전하게 저장되었습니다!');
  };

  return (
    <div>
      <div className="header">
        <h1>저장된 내역 관리</h1>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem',
        padding: '0.75rem', backgroundColor: '#f8fafc', borderRadius: '6px', flexWrap: 'wrap'
      }}>
        {backupStatus === 'checking' && (
          <span style={{ fontSize: '0.875rem', color: '#64748b' }}>엑셀 백업 상태 확인 중...</span>
        )}
        {backupStatus === 'unsupported' && (
          <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
            이 브라우저는 로컬 엑셀 백업을 지원하지 않습니다 (Chrome 또는 Edge에서만 가능).
          </span>
        )}
        {backupStatus === 'disconnected' && (
          <>
            <span style={{ fontSize: '0.875rem', color: '#64748b' }}>저장된 내역이 로컬 엑셀 파일로 백업되고 있지 않습니다.</span>
            <button className="btn" onClick={handleConnectBackup}><Link2 size={16} /> 엑셀 백업 연결</button>
          </>
        )}
        {backupStatus === 'connected' && (
          <>
            <span style={{ fontSize: '0.875rem', color: '#16a34a', fontWeight: 500 }}>
              엑셀 백업됨: {transactionExcelFileName} (저장할 때마다 자동 갱신)
            </span>
            <button className="btn" onClick={handleDisconnectBackup}><Unlink size={16} /> 백업 해제</button>
          </>
        )}
        {backupError && <span style={{ fontSize: '0.875rem', color: 'red', width: '100%' }}>{backupError}</span>}

        <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => importInputRef.current?.click()}>
            <DatabaseBackup size={16} /> 기존 프로그램 데이터 가져오기
          </button>
          <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>
            tools/gdb 로 만든 tradetax-import.json 을 고르면 예전 거래명세서가 이 목록에 들어옵니다.
          </span>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportFile}
            style={{ display: 'none' }}
          />
        </div>
        {importError && <span style={{ fontSize: '0.875rem', color: 'red', width: '100%' }}>{importError}</span>}
        {importNotice && <span style={{ fontSize: '0.875rem', color: '#16a34a', width: '100%' }}>{importNotice}</span>}
      </div>

      {/* 세로로 긴 화면을 기준으로 목록 -> 편집 순으로 쌓는다. 목록은 접을 수 있어서
          내역을 고른 뒤에는 편집 영역만 남길 수 있다. */}
      <div>
        <CollapsibleCard
          title="저장된 거래명세서 목록"
          count={transactionsLoaded ? `${transactions.length.toLocaleString()}건` : null}
        >
          {/* 기존 프로그램 '거래명세서 발행' 목록 화면을 따른다: 위에 조회 조건, 아래에 촘촘한 목록. */}
          {transactions.length > 0 && (
            <div className="history-filters">
              <div className="history-filters__row">
                <select className="input-field" style={{ width: '6.5rem' }} title="연도"
                  value={period ? period.year : '__custom'}
                  onChange={(e) => setPeriod(e.target.value === '__custom' ? '' : e.target.value, 0)}>
                  <option value="">전체 연도</option>
                  {yearOptions.map((y) => <option key={y} value={y}>{y}년</option>)}
                  {!period && <option value="__custom">직접 입력</option>}
                </select>
                <select className="input-field" style={{ width: '9.5rem' }} title="분기"
                  disabled={!period || !period.year}
                  value={period ? period.quarter : 0}
                  onChange={(e) => setPeriod(period.year, Number(e.target.value))}>
                  <option value={0}>전체 분기</option>
                  {[1, 2, 3, 4].map((q) => (
                    <option key={q} value={q}>{q}/4 분기 ({pad2(q * 3 - 2)}~{pad2(q * 3)}월)</option>
                  ))}
                </select>
                <span className="history-filters__range">
                  <input className="input-field" placeholder="26.01.01" value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)} />
                  <span>~</span>
                  <input className="input-field" placeholder="26.12.31" value={toDate}
                    onChange={(e) => setToDate(e.target.value)} />
                </span>
              </div>
              <div className="history-filters__row">
                <select className="input-field" style={{ flex: '1 1 12rem', minWidth: 0 }}
                  value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
                  <option value="">전체 거래처 ({companyOptions.length}곳)</option>
                  {companyOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <label className="history-filters__label">정렬</label>
                <select className="input-field" style={{ width: '6.5rem' }} value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                  <option value="date">작성일자</option>
                  <option value="name">상호명</option>
                  <option value="amount">금액</option>
                </select>
                <label className="history-filters__check">
                  <input type="checkbox" checked={sortDesc} onChange={(e) => setSortDesc(e.target.checked)} /> 내림차순
                </label>
                <strong className="history-filters__count">{filtered.length.toLocaleString()}건</strong>
                {filterActive && (
                  <button className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8125rem' }} onClick={resetFilters}>초기화</button>
                )}
              </div>
              {fromKey && toKey && fromKey > toKey && (
                <p style={{ margin: 0, fontSize: '0.8125rem', color: '#dc2626' }}>시작일이 종료일보다 뒤입니다.</p>
              )}
            </div>
          )}

          {!transactionsLoaded ? (
            <p style={{ color: 'gray' }}>저장된 내역을 불러오는 중입니다...</p>
          ) : transactions.length === 0 ? (
            <p style={{ color: 'gray' }}>저장된 내역이 없습니다.</p>
          ) : (
            <>
              <div className="history-list">
                <table className="data-table history-table">
                  <thead>
                    <tr>
                      <th style={{ width: '5.6rem' }}>작성일자</th>
                      <th>내용</th>
                      <th style={{ width: '24%' }}>상호명</th>
                      <th className="num" style={{ width: '5.6rem' }}>금액</th>
                      <th className="num" style={{ width: '4.2rem' }}>세액</th>
                      <th className="num" style={{ width: '5.6rem' }}>합계</th>
                      <th style={{ width: '2rem' }} title="삭제" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, VISIBLE_LIMIT).map((r) => (
                      <tr key={r.tx.id} onClick={() => setSelectedTx(r.tx)}
                        className={selectedTx?.id === r.tx.id ? 'is-selected' : undefined}>
                        <td>{fmtDate(r.dateKey, r.tx.date)}</td>
                        <td title={r.summary}>{r.summary}</td>
                        <td title={r.name !== r.tx.companyName ? `엑셀 이름: ${r.tx.companyName}` : r.name}>{r.name}</td>
                        <td className="num">{won(r.supply)}</td>
                        <td className="num">{r.tax ? won(r.tax) : ''}</td>
                        <td className="num">{won(r.total)}</td>
                        <td style={{ textAlign: 'center', padding: 0 }}>
                          <button className="btn" title="삭제"
                            style={{ padding: '2px', color: 'red', border: 'none', background: 'none' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!window.confirm(`${fmtDate(r.dateKey, r.tx.date)} ${r.name} 명세서를 삭제할까요?`)) return;
                              deleteTransaction(r.tx.id);
                              if (selectedTx?.id === r.tx.id) setSelectedTx(null);
                              backupNow();
                            }}>
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length > VISIBLE_LIMIT && (
                <p style={{ margin: '0.375rem 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                  {filtered.length.toLocaleString()}건 중 {VISIBLE_LIMIT}건만 표시합니다. 연도·분기나 거래처로 좁혀주세요.
                  (아래 합계는 조회된 {filtered.length.toLocaleString()}건 전체 기준)
                </p>
              )}
            </>
          )}
        </CollapsibleCard>

        <div className="card" style={{ overflowX: 'auto' }}>
          <div className="card-title" style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: '0.75rem', flexWrap: 'wrap',
          }}>
            <span>{selectedTx ? `${selectedTx.companyName} 내역 수정` : '상세보기'}</span>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="btn" onClick={addItem} disabled={!selectedTx}><Plus size={16} /> 줄 추가</button>
              <button className="btn" onClick={handleSave} disabled={!selectedTx}><Save size={16} /> 변경사항 저장</button>
              <button className="btn btn-primary" onClick={handlePrint} disabled={!selectedTx}>
                <Printer size={16} /> 출력/PDF
              </button>
            </div>
          </div>

          {selectedTx ? (
            <>
              <div className="input-group" style={{ width: '150px', marginBottom: '0.5rem' }}>
                <label className="input-label">출력용 작성일자</label>
                <input
                  className="input-field"
                  value={selectedTx.date}
                  onChange={e => setSelectedTx({ ...selectedTx, date: e.target.value })}
                />
              </div>

              {/* 칸 내용은 자동 작성에서만 고친다. 여기서는 누구로 찍을지만 고른다. */}
              <div style={{ marginBottom: '0.75rem' }}>
                <PartiesPanel
                  readOnly
                  supplierBase={supplier}
                  supplierPatch={selectedTx.supplierOverride?.[supplier.id]}
                  supplierId={supplier.id}
                  onSupplierChange={(id) => setSelectedTx({ ...selectedTx, supplierId: id })}
                  receiverBase={receiverBase}
                  receiverPatch={receiverPatch}
                  companies={companies}
                  excelName={selectedTx.companyName}
                  receiverMatch={receiverMatch}
                  onReceiverChoose={(id) => setSelectedTx({ ...selectedTx, receiverId: id })}
                />
              </div>

              <TransactionItemsTable
                items={selectedTx.items}
                onItemChange={handleItemChange}
                onItemsChange={setItems}
                onDeleteItem={deleteItem}
                dateColWidth="52px"
              />
            </>
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'gray' }}>
              위 목록에서 내역을 선택해주세요.
            </div>
          )}
        </div>
      </div>

      {/* 기존 프로그램 목록 화면 아래의 '매출' 줄처럼, 화면 아래에 붙어서 지금 조회된 목록 전체의
          매출 합계를 보여준다. 목록을 아래로 내려도 계속 보인다. */}
      {transactionsLoaded && transactions.length > 0 && (
        <div className="history-footer">
          <span className="history-footer__title">
            조회 매출 <strong>{filtered.length.toLocaleString()}</strong>건
          </span>
          <span className="history-footer__cell">금액 <b>{won(listTotals.supply)}</b></span>
          <span className="history-footer__cell">세액 <b>{won(listTotals.tax)}</b></span>
          <span className="history-footer__cell history-footer__cell--total">합계 <b>{won(listTotals.total)}</b></span>
        </div>
      )}

      {/* Hidden print template */}
      {selectedTx && (
        <div style={{ position: 'fixed', top: 0, left: '-10000px', opacity: 0, pointerEvents: 'none' }}>
          <TransactionPrintTemplate
            ref={printRef}
            data={selectedTx.items}
            supplier={printSupplier}
            receiver={printReceiver}
            date={selectedTx.date}
          />
        </div>
      )}
    </div>
  );
}

export default History;
