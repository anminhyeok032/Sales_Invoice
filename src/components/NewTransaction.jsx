import React, { useState, useRef, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import useStore, { resolveSupplier } from '../store';
import { Upload, Save, Printer, Plus } from 'lucide-react';
import TransactionPrintTemplate from './TransactionPrintTemplate';
import { openPrintPreview } from '../lib/printPreview';
import { useItemFilters } from '../hooks/useItemFilters';
import { filterItems, isFilterActive, filtersKey } from '../lib/itemTableView';
import { writeTransactionsBackup } from '../lib/transactionExcelSync';
import { resolveColumnMapping } from '../lib/excelSchema';
import PrintOptions from './PrintOptions';
import { applyItemChange } from '../lib/transactionItems';
import { createItemForFilters } from '../lib/itemTableView';
import { matchReceiver, receiverInfo } from '../lib/companyLookup';
import TransactionItemsTable from './TransactionItemsTable';
import CollapsibleCard from './CollapsibleCard';
import StatementPartiesCard from './StatementPartiesCard';
import { applyOverride, patchFor, withPatch } from '../lib/partyOverride';

// Column layout can vary between NC가공일지 workbooks; header text is matched
// against these aliases so reordered/renamed columns still resolve correctly.
// Only fields actually consumed below are listed (장비/제품No/외주 are unused today).
// 헤더는 공백/줄바꿈/기호를 지운 뒤 비교한다. 실제 파일의 헤더는 '코어' 줄바꿈 '및 전극'이라
// 지우고 나면 '코어및전극'이 되는데, 예전에는 별칭에 '코어'만 있어서 이 칸이 통째로 무시되고 있었다.
const NC_LOG_FIELD_DEFS = [
  { key: 'date', aliases: ['날짜', '일자', '작업일자', '작업일'], fallbackIndex: 1 },
  { key: 'company', aliases: ['업체', '거래처', '업체명', '거래처명'], fallbackIndex: 2, required: true },
  { key: 'moldNo', aliases: ['금형No', '금형번호', '금형'], fallbackIndex: 3 },
  { key: 'newOrMod', aliases: ['신작or수정', '신작or수정or자사불량', '신작/수정', '신작수정', '구분'], fallbackIndex: 4 },
  { key: 'core', aliases: ['코어및전극', '코어/전극', '코어', '전극'], contains: ['코어', '전극'], fallbackIndex: 6 },
  { key: 'qty', aliases: ['수량', '수량(EA)'], fallbackIndex: 8 },
  { key: 'processingTime', aliases: ['가공시간', '가공 시간'], fallbackIndex: 9 },
  { key: 'note', aliases: ['비고', '메모', '특이사항'], fallbackIndex: 11 },
];

// 엑셀을 읽어서 항목을 만드는 방식의 버전. 방식을 바꿀 때마다 올린다.
// 읽은 결과는 브라우저에 저장돼 남아 있어서, 코드를 고쳐도 파일을 다시 읽기 전에는 옛 결과가 그대로
// 보인다. 저장된 결과의 버전(excelParserVersion)이 이 값보다 낮으면 옛 방식으로 읽은 것이다.
//   2: 품목에 '코어 및 전극'과 구분을 붙임 / 업로드하면 '데이터시트'가 아니라 월 시트를 연다
const NC_PARSER_VERSION = 2;

// 업로드한 통합문서에서 처음에 열 시트. 가공일지에는 월 시트(1월~12월) 앞에 입력 선택지를 적어 둔
// '데이터시트' 같은 보조 시트가 있을 수 있다. 맨 첫 시트를 그냥 열면 그 보조 시트가 가공일지 데이터로
// 읽혀서 가짜 항목이 만들어진다. 데이터가 든 월 시트를 우선 고른다: 데이터가 있는 첫 '~월' 시트,
// 없으면 첫 '~월' 시트, 그것도 없으면 맨 첫 시트.
function pickInitialSheet(rawData, sheetNames) {
  const months = sheetNames.filter((name) => /월$/.test(String(name).trim()));
  const hasRows = (name) => {
    const { columnMap, dataStartRow } = resolveColumnMapping(rawData[name] || [], NC_LOG_FIELD_DEFS, {
      maxScanRows: 10, fallbackDataStartRow: 2,
    });
    return (rawData[name] || []).slice(dataStartRow).some((row) => row && columnMap.company != null && row[columnMap.company]);
  };
  return months.find(hasRows) || months[0] || sheetNames[0] || '';
}

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

// 오늘 날짜(내 컴퓨터 시간대) 'YYYY/MM/DD'. toISOString()은 UTC 기준이라 한국에서 오전 9시 전에는 어제 날짜가 된다.
function todaySlash() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function NewTransaction() {
  const {
    companies, saveTransaction,
    excelRawData, excelSheetNames, excelSelectedSheet, excelGroupedData, excelSelectedCompany,
    excelSupplierId, excelOverrides, excelParserVersion, setExcelState,
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
  const [currentDate, setCurrentDate] = useState(todaySlash());

  const printRef = useRef();

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
      const firstSheet = pickInitialSheet(rawData, months);
      setExcelState({
        excelRawData: rawData,
        excelSheetNames: months,
        excelSelectedSheet: firstSheet,
      });

      if (firstSheet) {
        parseSheet(rawData, firstSheet);
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

  const parseSheet = (rawData, sheetName, { keepSelection = false } = {}) => {
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

      // 품목 = 금형No 코어 및 전극 구분(신작·수정…) — 띄어쓰기 한 칸으로 잇는다. 빈 칸은 건너뛴다.
      // 구분은 화면 확인용 칸(newOrMod)에도 따로 남기지만, 품목에도 붙어서 명세서에 인쇄된다.
      const itemName = [moldNo, core, newOrMod]
        .map((part) => String(part).trim())
        .filter(Boolean)
        .join(' ');

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

    setExcelState({ excelGroupedData: newGroupedData, excelOverrides: {}, excelParserVersion: NC_PARSER_VERSION });
    const comps = Object.keys(newGroupedData);
    if (keepSelection && comps.includes(selectedCompany)) {
      // 옛 결과를 새 방식으로 다시 읽는 경우: 보고 있던 거래처를 그대로 둔다
    } else if (comps.length > 0) {
      setSelectedCompany(comps[0]);
    } else {
      setSelectedCompany('');
    }
  };

  // 읽은 결과는 브라우저에 저장돼 남는다. 그래서 읽는 방식을 고친 뒤에도 옛 결과가 그대로 보일 수 있다.
  // (실제로 '코어 및 전극'을 고친 뒤에도 옛 화면에는 그 값이 없어서 "안 고쳐졌다"로 보였다.)
  const parserStale = Object.keys(groupedData).length > 0
    && Object.keys(excelRawData || {}).length > 0
    && (excelParserVersion || 0) < NC_PARSER_VERSION;
  // 옛 결과 위에 직접 입력한 내용이 없으면(단가·금액·세액이 모두 0이고 합친 줄이 없으면) 다시 읽어도
  // 잃을 것이 없다. 하나라도 있으면 자동으로 지우지 않는다.
  const parserUntouched = Object.values(groupedData).flat().every((item) =>
    !Number(item.price) && !Number(item.supply) && !Number(item.tax) && !item.mergedFrom);

  useEffect(() => {
    if (!parserStale || !parserUntouched) return;
    parseSheet(excelRawData, selectedSheet, { keepSelection: true });
    // 화면이 열릴 때(또는 저장된 결과의 버전이 바뀔 때) 한 번만 — parseSheet는 매 렌더 새로 만들어진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parserStale, parserUntouched]);

  const currentItems = groupedData[selectedCompany] || [];

  // 컬럼 필터는 여기서 들고 있다 — 출력은 화면에 보이는 줄(필터 결과)만 찍는다.
  // 거래처를 바꾸면 필터는 저절로 비워진다.
  const [itemFilters, setItemFilters] = useItemFilters(selectedCompany);
  const itemsFiltered = isFilterActive(itemFilters);
  const printItems = itemsFiltered
    ? filterItems(currentItems, itemFilters).map((r) => r.item)
    : currentItems;

  const handlePrint = () => {
    const opened = openPrintPreview(printRef.current, {
      title: `거래명세서_${selectedCompany}_${currentDate.replace(/\//g, '')}`,
      note: itemsFiltered ? `필터 적용 — ${currentItems.length}줄 중 ${printItems.length}줄만 출력` : '',
    });
    if (!opened) alert('미리보기 창이 브라우저에 의해 차단되었습니다. 주소창의 팝업 차단을 허용한 뒤 다시 눌러주세요.');
  };


  const setCurrentItems = (items) => {
    setGroupedData({ ...groupedData, [selectedCompany]: items });
  };

  const handleItemChange = (index, field, value) => {
    setCurrentItems(applyItemChange(groupedData[selectedCompany], index, field, value));
  };

  const addItem = () => {
    // 필터가 걸려 있어도 넣을 수 있다: 필터 조건에 맞는 값으로 채워서 보이는 목록 맨 아래에 들어간다.
    setCurrentItems([...groupedData[selectedCompany], createItemForFilters(itemFilters)]);
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
      // 저장하는 것은 회사 전체 내역이 아니라 "지금 출력을 누르면 나오는 그 상태"다:
      // 필터로 남긴 줄을, 정렬·이동·합치기를 한 그 순서 그대로. 숨긴 줄은 이 명세서에 포함되지 않는다.
      items: printItems,
      // 어떤 필터 상태로 저장했는지. 필터 조건이 다르면 같은 달·같은 거래처여도 별개 명세서로 남고,
      // 같은 조건으로 다시 저장하면 그 명세서를 갱신한다(store.saveTransaction).
      viewKey: filtersKey(itemFilters),
    });
    writeTransactionsBackup(useStore.getState().transactions).catch(err => console.error('엑셀 백업 저장 실패:', err));
    alert(itemsFiltered
      ? `${selectedCompany} 명세서를 저장했습니다. (필터 상태 그대로 ${printItems.length}줄, 숨긴 ${currentItems.length - printItems.length}줄은 제외)`
      : `${selectedCompany} 거래명세서가 로컬에 저장되었습니다!`);
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
        <div className="card" style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>기준 월 선택:</strong>
          <select className="input-field" style={{ width: '150px' }} value={selectedSheet} onChange={handleSheetSelect}>
            {sheetNames.map(sheet => <option key={sheet} value={sheet}>{sheet}</option>)}
          </select>
        </div>
      )}

      {/* 옛 방식으로 읽어 둔 결과가 화면에 남아 있고, 그 위에 직접 입력한 내용(단가 등)이 있어서 자동으로
          다시 읽지 못한 경우. 안내 없이 두면 '코어 및 전극'이 빠진 옛 내용이 계속 보인다. */}
      {parserStale && !parserUntouched && (
        <div className="card" style={{
          display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap',
          backgroundColor: '#fffbeb', border: '1px solid #fcd34d',
        }}>
          <span style={{ fontSize: '0.875rem', color: '#92400e', flex: '1 1 20rem' }}>
            <strong>이 화면의 내용은 예전 방식으로 읽은 것</strong>이라 <strong>코어 및 전극</strong>이 품목에 빠져 있습니다.
            다시 읽으면 새 방식으로 바뀌지만, <strong>이 화면에서 입력한 단가·수정 내용은 사라집니다</strong>.
            (이미 저장한 명세서는 영향이 없습니다)
          </span>
          <button className="btn btn-primary" onClick={() => {
            if (window.confirm('엑셀을 새 방식으로 다시 읽습니다.\n이 화면에서 입력한 단가·수정 내용은 사라집니다. 계속할까요?')) {
              parseSheet(excelRawData, selectedSheet, { keepSelection: true });
            }
          }}>
            다시 읽기
          </button>
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
                <button className="btn" onClick={addItem}
                  title={itemsFiltered ? '필터 조건에 맞는 값으로 채운 새 줄을 맨 아래에 추가합니다' : undefined}>
                  <Plus size={16} /> 줄 추가
                </button>
                <button className="btn" onClick={handleSave}
                  title={itemsFiltered
                    ? '지금 보이는(필터·정렬한) 줄만, 출력할 때와 같은 상태로 저장합니다'
                    : '이 회사의 명세서를 저장합니다'}>
                  <Save size={16} /> 현재 상태 저장{itemsFiltered ? ` (${printItems.length}줄)` : ''}
                </button>
                <button className="btn btn-primary" onClick={handlePrint}
                  title="새 창에서 미리보기 (필터가 걸려 있으면 보이는 줄만 출력)">
                  <Printer size={16} /> 출력/PDF{itemsFiltered ? ` (${printItems.length}줄)` : ''}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
              <div className="input-group" style={{ width: '150px', marginBottom: 0 }}>
                <label className="input-label">출력용 작성일자</label>
                <input className="input-field" value={currentDate} onChange={e => setCurrentDate(e.target.value)} />
              </div>
              <PrintOptions />
            </div>

            <TransactionItemsTable
              items={currentItems}
              onItemChange={handleItemChange}
              onItemsChange={setCurrentItems}
              onDeleteItem={deleteItem}
              dateColWidth="76px"
              filters={itemFilters}
              onFiltersChange={setItemFilters}
            />
          </div>
        </div>
      )}

      <div style={{ position: 'fixed', top: 0, left: '-10000px', opacity: 0, pointerEvents: 'none' }}>
        <TransactionPrintTemplate
          ref={printRef} 
          data={printItems} 
          supplier={printSupplier}
          receiver={receiver} 
          date={currentDate} 
        />
      </div>
    </div>
  );
}

export default NewTransaction;
