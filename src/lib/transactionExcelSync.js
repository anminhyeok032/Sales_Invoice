import * as XLSX from 'xlsx';
import { saveHandle, loadHandle, clearHandle, isFileSystemAccessSupported, ensurePermission } from './fileHandleStore';

const HANDLE_KEY = 'transactionExcelHandle';

// Cached in-memory so any component can trigger a backup write without re-reading IndexedDB every time.
let cachedHandle = null;

export { isFileSystemAccessSupported };

export async function getConnectedHandle() {
  if (cachedHandle) return cachedHandle;
  const handle = await loadHandle(HANDLE_KEY);
  if (handle) cachedHandle = handle;
  return handle;
}

export async function connectBackupFile() {
  const handle = await window.showSaveFilePicker({
    suggestedName: '거래명세서-저장내역-백업.xlsx',
    types: [{
      description: 'Excel Workbook',
      accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
    }],
  });
  await saveHandle(HANDLE_KEY, handle);
  cachedHandle = handle;
  return handle;
}

export async function disconnectBackupFile() {
  await clearHandle(HANDLE_KEY);
  cachedHandle = null;
}

const HEADER_ROW = ['연도', '월', '거래처명', '작성일자', '항목날짜', '품목', '규격', '단위', '수량', '단가', '공급가액', '세액', '비고'];

function transactionsToWorkbookBuffer(transactions) {
  const aoa = [HEADER_ROW];
  transactions.forEach((tx) => {
    (tx.items || []).forEach((item) => {
      aoa.push([
        tx.year, tx.month, tx.companyName, tx.date,
        item.date || '', item.name || '', item.spec || '', item.unit || '',
        item.qty || 0, item.price || 0, item.supply || 0, item.tax || 0, item.note || '',
      ]);
    });
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '저장내역백업');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
}

// Best-effort backup write: no-ops silently if no file is connected, throws on real write errors.
export async function writeTransactionsBackup(transactions) {
  const handle = await getConnectedHandle();
  if (!handle) return false;
  const granted = await ensurePermission(handle, 'readwrite');
  if (!granted) return false;

  const buffer = transactionsToWorkbookBuffer(transactions);
  const writable = await handle.createWritable();
  await writable.write(buffer);
  await writable.close();
  return true;
}
