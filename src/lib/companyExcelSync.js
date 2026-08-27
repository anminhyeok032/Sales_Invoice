import * as XLSX from 'xlsx';
import { saveHandle, loadHandle, clearHandle, isFileSystemAccessSupported, ensurePermission } from './fileHandleStore';
import { resolveColumnMapping } from './excelSchema';

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

// Column layout can vary between exported 업체목록 files; header text is matched
// against these aliases so reordered/renamed columns still resolve correctly.
const COMPANY_FIELD_DEFS = [
  { key: 'name', aliases: ['상호명', '상호', '업체명', '거래처명', '회사명'], fallbackIndex: 2, required: true },
  { key: 'president', aliases: ['대표', '대표자', '대표자명', '성명'], fallbackIndex: 3 },
  { key: 'regNo', aliases: ['사업자번호', '사업자등록번호'], fallbackIndex: 4 },
  { key: 'businessType', aliases: ['업태'], fallbackIndex: 5 },
  { key: 'businessItem', aliases: ['업종'], fallbackIndex: 6 },
  { key: 'address', aliases: ['주소', '소재지'], fallbackIndex: 7 },
  { key: 'phone', aliases: ['전화', '전화번호', '연락처'], fallbackIndex: 8 },
];

export function parseWorkbookToCompanies(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const { columnMap, dataStartRow } = resolveColumnMapping(rows, COMPANY_FIELD_DEFS, {
    maxScanRows: 5,
    fallbackDataStartRow: DATA_START_ROW,
  });

  const get = (row, idx) => (idx != null && row[idx] != null ? String(row[idx]) : '');

  const companies = [];
  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    const name = row && columnMap.name != null ? row[columnMap.name] : undefined;
    if (!name) continue;
    companies.push({
      id: `xls-row-${i}`,
      name: String(name),
      president: get(row, columnMap.president),
      regNo: get(row, columnMap.regNo),
      businessType: get(row, columnMap.businessType),
      businessItem: get(row, columnMap.businessItem),
      address: get(row, columnMap.address),
      phone: get(row, columnMap.phone),
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
