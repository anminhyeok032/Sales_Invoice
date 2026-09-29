import React, { useState, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import useStore, { resolveSupplier } from '../store';
import { Upload, Save, Printer, Plus } from 'lucide-react';
import TransactionPrintTemplate from './TransactionPrintTemplate';
import { useReactToPrint } from 'react-to-print';
import { writeTransactionsBackup } from '../lib/transactionExcelSync';
import { resolveColumnMapping } from '../lib/excelSchema';
import { applyItemChange, createEmptyItem } from '../lib/transactionItems';
import { matchReceiver, receiverInfo } from '../lib/companyLookup';
import TransactionItemsTable from './TransactionItemsTable';
import CollapsibleCard from './CollapsibleCard';
import StatementPartiesCard from './StatementPartiesCard';
import { applyOverride, patchFor, withPatch } from '../lib/partyOverride';

// Column layout can vary between NC가공일지 workbooks; header text is matched
// against these aliases so reordered/renamed columns still resolve correctly.
// Only fields actually consumed below are listed (장비/제품No/외주 are unused today).
const NC_LOG_FIELD_DEFS = [
  { key: 'date', aliases: ['날짜', '일자', '작업일자', '작업일'], fallbackIndex: 1 },
  { key: 'company', aliases: ['업체', '거래처', '업체명', '거래처명'], fallbackIndex: 2, required: true },
  { key: 'moldNo', aliases: ['금형No', '금형번호', '금형'], fallbackIndex: 3 },
  { key: 'newOrMod', aliases: ['신작or수정', '신작or수정or자사불량', '신작/수정', '신작수정', '구분'], fallbackIndex: 4 },
  { key: 'core', aliases: ['코어'], fallbackIndex: 6 },
  { key: 'qty', aliases: ['수량', '수량(EA)'], fallbackIndex: 8 },
  { key: 'processingTime', aliases: ['가공시간', '가공 시간'], fallbackIndex: 9 },
  { key: 'note', aliases: ['비고', '메모', '특이사항'], fallbackIndex: 11 },
];

// 가공시간 셀은 두 가지 형태로 들어온다:
// 1) 순수 숫자 (엑셀 시간값, 하루=1) — 해당 행 전체의 합산 가공시간이 이미 들어있음
// 2) "각 H:MM" 문자열 — 수량 1개당 소요시간이므로 수량만큼 곱해서 합산해야 함
const parseHM = (text) => {
  const m = String(text).trim().match(/^(\d+):(\d{1,2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

const minutesToHM = (minutes) => {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
};

const formatProcessingTime = (raw, qty) => {
  if (raw == null || raw === '') return '';

  if (typeof raw === 'number') {
    return minutesToHM(raw * 24 * 60);
  }

  const text = String(raw).trim();
  if (text.startsWith('각')) {
    const perUnitMinutes = parseHM(text.replace('각', '').trim());
    if (perUnitMinutes == null) return text;
    return minutesToHM(perUnitMinutes * (Number(qty) || 0));
  }

  return text;
};

// Helper to convert Excel serial date to MM/DD
const excelDateToJSDate = (serial) => {
  if (!serial || isNaN(serial)) return serial; // If it's already a string or empty
  const utc_days  = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;                                        
  const date_info = new Date(utc_value * 1000);
  const year = date_info.getFullYear().toString().slice(-2);
  const month = date_info.getMonth() + 1;
  const day = date_info.getDate();
  return `${year}/${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}`;
}

function NewTransaction() {
  const {
    companies, saveTransaction,
    excelRawData, excelSheetNames, excelSelectedSheet, excelGroupedData, excelSelectedCompany,
    excelSupplierId, excelOverrides, setExcelState,
    receiverAliases, setReceiverAlias, clearReceiverAlias,
  } = useStore();
  // 공급자 선택도 엑셀 세션 상태처럼 탭을 옮겨 다녀도 유지한다.
  const supplier = useStore((state) => resolveSupplier(state, excelSupplierId));
  const setSupplierId = (id) => setExcelState({ excelSupplierId: id });

  const groupedData = excelGroupedData || {};
  const sheetNames = excelSheetNames || [];
  const selectedSheet = excelSelectedSheet || '';
  const selectedCompany = excelSelectedCompany || '';

  // 엑셀 업체 이름('가나')으로 거래처 목록에서 공급받는자('(주)가나테크')를 찾는다.
  // 직접 골라 둔 것(receiverAliases)이 있으면 그걸 쓰고, 없으면 이름 비교로 추정.
  const matches = useMemo(() => {
    const out = {};
    Object.keys(excelGroupedData || {}).forEach((name) => {
      out[name] = matchReceiver(companies, name, receiverAliases);
    });
    return out;
  }, [excelGroupedData, companies, receiverAliases]);
  const receiverMatch = matches[selectedCompany] || matchReceiver(companies, selectedCompany, receiverAliases);
  const receiverId = receiverMatch.company?.id ?? '';

  // 이 명세서(= 지금 고른 거래처의 명세서)에서만 쓰는 공급받는자/공급자 수정분.
  // 거래처별로 따로 들고, 공급자 수정분은 공급자별로 따로 든다 — 다른 공급자로 바꿨을 때
  // 앞 공급자에게 한 수정이 엉뚱하게 덮어써지면 안 된다.
  const overrides = (excelOverrides || {})[selectedCompany] || {};
  // 공급받는자 수정분도 거래처 id별로 든다 — 다른 거래처로 바꿔 고르면 앞 거래처에 한 수정이 따라오면 안 된다.
  const receiverPatch = patchFor(overrides.receiver, receiverId);
  const supplierPatch = overrides.supplier?.[supplier.id];
  const setOverrides = (next) => setExcelState({
    excelOverrides: { ...(excelOverrides || {}), [selectedCompany]: next },
  });
  const setReceiverPatch = (patch) =>
    setOverrides({ ...overrides, receiver: withPatch(overrides.receiver, receiverId, patch) });
  const setSupplierPatch = (patch) => setOverrides({
    ...overrides, supplier: { ...(overrides.supplier || {}), [supplier.id]: patch },
  });

  const setGroupedData = (data) => setExcelState({ excelGroupedData: data });
  const setSelectedCompany = (data) => setExcelState({ excelSelectedCompany: data });
  
  const [year, setYear] = useState(new Date().getFullYear());
  const [currentDate, setCurrentDate] = useState(new Date().toISOString().split('T')[0].replace(/-/g, '/'));

  const printRef = useRef();

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `거래명세서_${selectedCompany}_${currentDate.replace(/\//g, '')}`,
  });

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const data = new Uint8Array(event.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      
      const rawData = {};
      wb.SheetNames.forEach(sheet => {
        rawData[sheet] = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1 });
      });

      const months = wb.SheetNames;
      setExcelState({
        excelRawData: rawData,
        excelSheetNames: months,
        excelSelectedSheet: months.length > 0 ? months[0] : ''
      });
      
      if (months.length > 0) {
        parseSheet(rawData, months[0]);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSheetSelect = (e) => {
    const sheetName = e.target.value;
    setExcelState({ excelSelectedSheet: sheetName });
    if (excelRawData && Object.keys(excelRawData).length > 0) {
      parseSheet(excelRawData, sheetName);
    }
  };

  const parseSheet = (rawData, sheetName) => {
    const json = rawData[sheetName];
    if (!json) return;
    
    const { columnMap, dataStartRow } = resolveColumnMapping(json, NC_LOG_FIELD_DEFS, {
      maxScanRows: 10,
      fallbackDataStartRow: 2,
    });

    const newGroupedData = {};

    for (let i = dataStartRow; i < json.length; i++) {
      const row = json[i];
      if (!row || row.length === 0) continue;

      const rawDate = columnMap.date != null ? row[columnMap.date] : undefined;
      const companyName = columnMap.company != null ? row[columnMap.company] : undefined;

      if (!companyName) continue;

      const moldNo = (columnMap.moldNo != null && row[columnMap.moldNo]) || '';
      const newOrMod = (columnMap.newOrMod != null && row[columnMap.newOrMod]) || '';
      const core = (columnMap.core != null && row[columnMap.core]) || '';
      const qty = (columnMap.qty != null && row[columnMap.qty]) || 0;
      const rawProcessingTime = columnMap.processingTime != null ? row[columnMap.processingTime] : undefined;
      const unit = 'EA';
      const note = (columnMap.note != null && row[columnMap.note]) || '';

      const parts = [];
      if (moldNo) parts.push(moldNo);
      if (core) parts.push(core);
      const itemName = parts.join(' / ');

      const formattedDate = excelDateToJSDate(rawDate);

      const item = {
        date: formattedDate || '',
        name: itemName,
        spec: note,
        unit: unit,
        qty: Number(qty) || 0,
        price: 0,
        supply: 0,
        tax: 0,
        note: '',
        // 화면 확인용 항목 — 인쇄되는 거래명세표(품목/규격)에는 포함되지 않음
        newOrMod,
        processingTime: formatProcessingTime(rawProcessingTime, qty),
      };

      if (!newGroupedData[companyName]) {
        newGroupedData[companyName] = [];
      }
      newGroupedData[companyName].push(item);
    }

    setExcelState({ excelGroupedData: newGroupedData, excelOverrides: {} });
    const comps = Object.keys(newGroupedData);
    if (comps.length > 0) {
      setSelectedCompany(comps[0]);
    } else {
      setSelectedCompany('');
    }
  };

  const currentItems = groupedData[selectedCompany] || [];


  const setCurrentItems = (items) => {
    setGroupedData({ ...groupedData, [selectedCompany]: items });
  };

  const handleItemChange = (index, field, value) => {
    setCurrentItems(applyItemChange(groupedData[selectedCompany], index, field, value));
  };

  const addItem = () => {
    setCurrentItems([...groupedData[selectedCompany], createEmptyItem()]);
  };

  const deleteItem = (index) => {
    const items = [...groupedData[selectedCompany]];
    items.splice(index, 1);
    setCurrentItems(items);
  };

  const handleSave = () => {
    if (!selectedCompany) return;
    saveTransaction({
      year: year,
      month: parseInt(selectedSheet),
      companyName: selectedCompany,
      date: currentDate,
      // 저장된 내역에서 다시 출력할 때 같은 공급자로 찍히도록 같이 남긴다.
      supplierId: supplier.id,
      // 이 명세서에서만 고친 칸들. 저장된 내역에서 다시 출력해도 똑같이 찍히도록 남긴다.
      // 공급자 수정분은 어느 공급자에 대한 것인지 같이 남긴다. 저장된 내역에서
      // 공급자를 바꿔 출력할 때 엉뚱한 회사에 덮어쓰이지 않도록.
      // 어느 거래처로 찍었는지 남긴다. 엑셀 이름('가나')만으로는 다시 찾기 어렵다.
      receiverId,
      receiverOverride: receiverPatch ? { [receiverId]: receiverPatch } : undefined,
      supplierOverride: supplierPatch ? { [supplier.id]: supplierPatch } : undefined,
      items: currentItems
    });
    writeTransactionsBackup(useStore.getState().transactions).catch(err => console.error('엑셀 백업 저장 실패:', err));
    alert(`${selectedCompany} 거래명세서가 로컬에 저장되었습니다!`);
  };

  const receiverBase = receiverInfo(receiverMatch.company, selectedCompany);
  const receiver = applyOverride(receiverBase, receiverPatch);
  const printSupplier = applyOverride(supplier, supplierPatch);

  return (
    <div>
      <div className="header">
        <h1>자동 작성 (엑셀 연동)</h1>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div className="input-group" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label className="input-label" style={{ margin: 0 }}>해당 연도:</label>
            <input type="number" className="input-field" style={{ width: '80px' }} value={year} onChange={e => setYear(Number(e.target.value))} />
          </div>
          <label className="btn btn-primary" style={{ cursor: 'pointer', margin: 0 }}>
            <Upload size={18} />
            가공일지 엑셀 열기
            <input type="file" accept=".xlsx, .xls" style={{ display: 'none' }} onChange={handleFileUpload} />
          </label>
        </div>
      </div>

      {sheetNames.length > 0 && (
        <div className="card" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <strong>기준 월 선택:</strong>
          <select className="input-field" style={{ width: '150px' }} value={selectedSheet} onChange={handleSheetSelect}>
            {sheetNames.map(sheet => <option key={sheet} value={sheet}>{sheet}</option>)}
          </select>
        </div>
      )}

      {Object.keys(groupedData).length > 0 && (
        // 세로로 긴 화면 기준. 거래처를 고른 뒤에는 목록을 접어서 편집 영역만 남길 수 있다.
        <div>
          <CollapsibleCard
            title="거래처 목록"
            count={`${Object.keys(groupedData).length}곳`}
          >
            <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {Object.keys(groupedData).map(comp => (
                <li
                  key={comp}
                  onClick={() => setSelectedCompany(comp)}
                  style={{
                    padding: '0.4rem 0.75rem',
                    border: '1px solid',
                    borderColor: selectedCompany === comp ? '#93c5fd' : 'var(--border-color)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    backgroundColor: selectedCompany === comp ? '#eff6ff' : 'transparent',
                    fontWeight: selectedCompany === comp ? 'bold' : 'normal',
                    color: selectedCompany === comp ? '#2563eb' : 'inherit'
                  }}
                >
                  {comp}
                  {/* 공급받는자를 확인해야 하는 곳: 후보가 여럿이거나 못 찾은 경우 */}
                  {(matches[comp]?.ambiguous || matches[comp]?.how === 'none') && (
                    <span
                      title={matches[comp].how === 'none' ? '거래처 목록에서 찾지 못함' : '비슷한 거래처가 여러 곳'}
                      style={{
                        marginLeft: '0.375rem', fontSize: '0.6875rem', fontWeight: 600, color: '#b45309',
                        backgroundColor: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '4px', padding: '0 4px',
                      }}
                    >확인</span>
                  )}
                </li>
              ))}
            </ul>
          </CollapsibleCard>

          {selectedCompany && (
            <StatementPartiesCard
              key={selectedCompany}
              receiverBase={receiverBase}
              receiverPatch={receiverPatch}
              onReceiverPatch={setReceiverPatch}
              companies={companies}
              excelName={selectedCompany}
              receiverMatch={receiverMatch}
              onReceiverChoose={(id) => setReceiverAlias(selectedCompany, id)}
              onReceiverAuto={() => clearReceiverAlias(selectedCompany)}
              supplierBase={supplier}
              supplierPatch={supplierPatch}
              onSupplierPatch={setSupplierPatch}
              supplierId={supplier.id}
              onSupplierChange={setSupplierId}
            />
          )}

          <div className="card" style={{ overflowX: 'auto' }}>
            <div className="card-title" style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              gap: '0.75rem', flexWrap: 'wrap',
            }}>
              <span>{selectedCompany} 거래 내역 수정</span>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button className="btn" onClick={addItem}><Plus size={16} /> 줄 추가</button>
                <button className="btn" onClick={handleSave}><Save size={16} /> 이 회사만 저장</button>
                <button className="btn btn-primary" onClick={handlePrint}><Printer size={16} /> 출력/PDF</button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
              <div className="input-group" style={{ width: '150px', marginBottom: 0 }}>
                <label className="input-label">출력용 작성일자</label>
                <input className="input-field" value={currentDate} onChange={e => setCurrentDate(e.target.value)} />
              </div>
            </div>

            <TransactionItemsTable
              items={currentItems}
              onItemChange={handleItemChange}
              onItemsChange={setCurrentItems}
              onDeleteItem={deleteItem}
              dateColWidth="110px"
            />
          </div>
        </div>
      )}

      <div style={{ position: 'fixed', top: 0, left: '-10000px', opacity: 0, pointerEvents: 'none' }}>
        <TransactionPrintTemplate
          ref={printRef} 
          data={currentItems} 
          supplier={printSupplier}
          receiver={receiver} 
          date={currentDate} 
        />
      </div>
    </div>
  );
}

export default NewTransaction;
