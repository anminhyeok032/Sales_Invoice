import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import useStore from '../store';
import { Upload, Save, Printer, Plus } from 'lucide-react';
import TransactionPrintTemplate from './TransactionPrintTemplate';
import { useReactToPrint } from 'react-to-print';
import { writeTransactionsBackup } from '../lib/transactionExcelSync';
import { resolveColumnMapping } from '../lib/excelSchema';
import { applyItemChange, createEmptyItem } from '../lib/transactionItems';
import { findReceiverInfo } from '../lib/companyLookup';
import TransactionItemsTable from './TransactionItemsTable';

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
    myCompany, companies, saveTransaction,
    excelRawData, excelSheetNames, excelSelectedSheet, excelGroupedData, excelSelectedCompany,
    setExcelState
  } = useStore();

  const groupedData = excelGroupedData || {};
  const sheetNames = excelSheetNames || [];
  const selectedSheet = excelSelectedSheet || '';
  const selectedCompany = excelSelectedCompany || '';

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

    setGroupedData(newGroupedData);
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
      items: currentItems
    });
    writeTransactionsBackup(useStore.getState().transactions).catch(err => console.error('엑셀 백업 저장 실패:', err));
    alert(`${selectedCompany} 거래명세서가 로컬에 저장되었습니다!`);
  };

  const getReceiverInfo = () => findReceiverInfo(companies, selectedCompany);

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
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
          <div className="card" style={{ minWidth: '220px', flexShrink: 0 }}>
            <div className="card-title">거래처 목록</div>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {Object.keys(groupedData).map(comp => (
                <li 
                  key={comp} 
                  onClick={() => setSelectedCompany(comp)}
                  style={{
                    padding: '10px 15px',
                    borderBottom: '1px solid #eee',
                    cursor: 'pointer',
                    backgroundColor: selectedCompany === comp ? '#eff6ff' : 'transparent',
                    fontWeight: selectedCompany === comp ? 'bold' : 'normal',
                    color: selectedCompany === comp ? '#2563eb' : 'inherit'
                  }}
                >
                  {comp}
                </li>
              ))}
            </ul>
          </div>

          <div className="card" style={{ flexGrow: 1, overflowX: 'auto' }}>
            <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{selectedCompany} 거래 내역 수정</span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn" onClick={addItem}><Plus size={16} /> 줄 추가</button>
                <button className="btn" onClick={handleSave}><Save size={16} /> 이 회사만 저장</button>
                <button className="btn btn-primary" onClick={handlePrint}><Printer size={16} /> 출력/PDF</button>
              </div>
            </div>

            <div className="input-group" style={{ width: '150px', marginBottom: '1rem' }}>
              <label className="input-label">출력용 작성일자</label>
              <input className="input-field" value={currentDate} onChange={e => setCurrentDate(e.target.value)} />
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
          supplier={myCompany} 
          receiver={getReceiverInfo()} 
          date={currentDate} 
        />
      </div>
    </div>
  );
}

export default NewTransaction;
