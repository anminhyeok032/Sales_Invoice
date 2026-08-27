import * as XLSX from 'xlsx';
import { saveHandle, loadHandle, clearHandle, isFileSystemAccessSupported, ensurePermission } from './fileHandleStore';

const HANDLE_KEY = 'companyExcelHandle';

export { isFileSystemAccessSupported, ensurePermission };

export async function saveCompanyHandle(handle) {
  return saveHandle(HANDLE_KEY, handle);
}

export async function loadCompanyHandle() {
  return loadHandle(HANDLE_KEY);
}

export async function clearCompanyHandle() {
  return clearHandle(HANDLE_KEY);
}

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
  await saveCompanyHandle(handle);
  return handle;
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
