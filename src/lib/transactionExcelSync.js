// 저장된 내역의 엑셀 "보기 파일" — 연결해 두면 바뀔 때마다 자동으로 새로 쓴다(fileBackup.js).
//
// 예전에는 품목 한 줄씩 13칸짜리 시트 하나(연도·월·엑셀 업체 이름…)였다. 이제는 앱 화면과 같은 값으로
// 목록 / 품목 / 합친 원본 / 거래처 / 공급자 시트를 만든다(excelViewWriter.js). 보기 전용 사본이라
// 엑셀에서 고쳐도 앱으로 돌아오지 않는다 — 되살리는 것은 JSON 백업으로 한다.
// 연결 정보 키는 예전과 같아서, 이미 연결해 둔 파일은 다음 저장부터 새 형식으로 바뀐다.
import { createFileBackup } from './fileBackup';
import * as XLSX from 'xlsx';
import { buildViewWorkbook, workbookBuffer } from './excelViewWriter';

// 연결하려고 고른 엑셀 파일이 덮어써도 되는 파일인지: 이 앱의 엑셀 보기 파일(목록·품목 시트)이나 예전 형식의
// 엑셀 백업(첫 줄이 연도·월·거래처명 … 공급가액)이면 괜찮다. 빈 파일도 괜찮다. 그 밖(가공일지 등)은 경고한다.
async function checkExisting(file) {
  if (!file.size) return null;
  let wb;
  try {
    wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', sheetRows: 2 });
  } catch {
    return `${file.name}은(는) 엑셀로 읽을 수 없는 파일입니다.`;
  }
  const names = wb.SheetNames;
  if (names.includes('목록') && names.includes('품목')) return null;
  const head = (XLSX.utils.sheet_to_json(wb.Sheets[names[0]], { header: 1 })[0] || []).map(String);
  if (head.includes('거래처명') && head.includes('공급가액')) return null;
  return `${file.name}은(는) 이 앱이 만든 엑셀 파일이 아닙니다 (시트: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ' …' : ''}).`;
}

const excelBackup = createFileBackup({
  handleKey: 'transactionExcelHandle',
  picker: {
    suggestedName: '거래명세서-저장내역.xlsx',
    types: [{
      description: 'Excel Workbook',
      accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
    }],
  },
  makeContent: (state) => workbookBuffer(buildViewWorkbook(state)),
  // 내역이 수천 건이면 만드는 데 몇 초 걸린다. 마지막 변경 뒤 잠깐 모았다가 한 번에 쓴다.
  delayMs: 5000,
  watch: ['transactions', 'companies', 'suppliers', 'defaultSupplierId', 'receiverAliases', 'printOptions'],
  // 엑셀 연결은 화면의 주 단추라, 크롬이 쓰기 허락을 거뒀으면 앱 안을 처음 누를 때 다시 묻는다(fileBackup.js).
  reaskOnClick: true,
  checkExisting,
});

export const useExcelBackupStatus = excelBackup.useStatus;
export const initExcelBackup = () => excelBackup.init();
export const connectExcelBackup = () => excelBackup.connect();               // 새 파일 만들어 연결
export const connectExistingExcel = () => excelBackup.connectExisting();     // 이미 있는 파일 연결
export const reconnectExcelBackup = () => excelBackup.reconnect();
export const disconnectExcelBackup = () => excelBackup.disconnect();
export const writeExcelNow = () => excelBackup.writeNow();
