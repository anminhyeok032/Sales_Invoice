import * as XLSX from 'xlsx';

const DB_NAME = '거래명세서-자동-관리-fs';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'companyExcelHandle';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveHandle(handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadHandle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearHandle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const isFileSystemAccessSupported = () =>
  typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';

export async function pickExcelFile() {
  const [handle] = await window.showOpenFilePicker({
    types: [{
      description: 'Excel Files',
      accept: {
        'application/vnd.ms-excel': ['.xls'],
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      },
    }],
    excludeAcceptAllOption: false,
    multiple: false,
  });
  await saveHandle(handle);
  return handle;
}

export async function ensurePermission(handle, mode = 'readwrite') {
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

// Column layout matches the existing 업체목록.xls template:
// [blank, NO, 상호명, 대표, 사업자번호, 업태, 업종, 주소, 전화]
const TITLE_ROW = [null, '거래목록'];
const HEADER_ROW = [null, 'NO', '상   호    명', '대     표', '사업자번호', '업     태', '업     종', '주             소', '전   화'];
const DATA_START_ROW = 2;

export function parseWorkbookToCompanies(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const companies = [];
  for (let i = DATA_START_ROW; i < rows.length; i++) {
    const row = rows[i];
    const name = row && row[2];
    if (!name) continue;
    companies.push({
      id: `xls-row-${i}`,
      name: String(name),
      president: row[3] != null ? String(row[3]) : '',
      regNo: row[4] != null ? String(row[4]) : '',
      businessType: row[5] != null ? String(row[5]) : '',
      businessItem: row[6] != null ? String(row[6]) : '',
      address: row[7] != null ? String(row[7]) : '',
      phone: row[8] != null ? String(row[8]) : '',
    });
  }
  return companies;
}

export function companiesToWorkbookBuffer(companies) {
  const aoa = [TITLE_ROW, HEADER_ROW];
  companies.forEach((c, idx) => {
    aoa.push([null, idx + 1, c.name || '', c.president || '', c.regNo || '', c.businessType || '', c.businessItem || '', c.address || '', c.phone || '']);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '거래업체목록');
  return XLSX.write(wb, { bookType: 'xls', type: 'array' });
}

export async function readCompaniesFromHandle(handle) {
  const file = await handle.getFile();
  const buffer = await file.arrayBuffer();
  return parseWorkbookToCompanies(buffer);
}

export async function writeCompaniesToHandle(handle, companies) {
  const buffer = companiesToWorkbookBuffer(companies);
  const writable = await handle.createWritable();
  await writable.write(buffer);
  await writable.close();
}
