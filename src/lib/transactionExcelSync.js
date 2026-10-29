// 저장된 내역의 엑셀 "보기 파일" — 연결해 두면 바뀔 때마다 자동으로 새로 쓴다(fileBackup.js).
//
// 예전에는 품목 한 줄씩 13칸짜리 시트 하나(연도·월·엑셀 업체 이름…)였다. 이제는 앱 화면과 같은 값으로
// 목록 / 품목 / 합친 원본 / 거래처 / 공급자 시트를 만든다(excelViewWriter.js). 보기 전용 사본이라
// 엑셀에서 고쳐도 앱으로 돌아오지 않는다 — 되살리는 것은 JSON 백업으로 한다.
// 연결 정보 키는 예전과 같아서, 이미 연결해 둔 파일은 다음 저장부터 새 형식으로 바뀐다.
import { createFileBackup } from './fileBackup';
import { buildViewWorkbook, workbookBuffer } from './excelViewWriter';

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
});

export const useExcelBackupStatus = excelBackup.useStatus;
export const initExcelBackup = () => excelBackup.init();
export const connectExcelBackup = () => excelBackup.connect();
export const reconnectExcelBackup = () => excelBackup.reconnect();
export const disconnectExcelBackup = () => excelBackup.disconnect();
