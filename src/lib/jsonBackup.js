// 저장된 내역의 JSON 백업 — 브라우저 저장소 밖에 남기는 1차 사본.
//
// 브라우저 저장소(IndexedDB)는 브라우저 데이터를 지우거나 PC를 바꾸면 사라진다. 엑셀 백업은 보기용이라
// 공급자/공급받는자 선택, 명세서별 수정값, 합친 줄의 원본, id 등이 빠져서 되돌릴 수 없다.
// JSON 백업은 앱이 가진 그대로를 담아서, 다른 PC나 브라우저에서도 "JSON에서 복원"으로 똑같이 되살린다.
//
//  · 파일 연결: 내 PC의 .json 파일 하나를 골라 두면, 내역·거래처·공급자가 바뀔 때마다 자동으로 덮어쓴다.
//  · 내려받기: 지금 상태를 .json 파일로 한 번 내려받는다(연결 없이도 됨).
//  · 복원: .json 파일을 골라 앱에 합친다(같은 명세서는 백업 내용으로 덮어씀, 무엇이 바뀌는지 먼저 보여 줌).
import useStore from '../store';
import { createFileBackup } from './fileBackup';

export const BACKUP_FORMAT = 'sales-invoice-backup';
export const BACKUP_VERSION = 1;
const HANDLE_KEY = 'transactionJsonHandle';
const WRITE_DELAY_MS = 1500;

// ---------- 내용 만들기 / 읽기 (순수 함수) ----------

export function buildBackup(state, now = new Date()) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    counts: { transactions: state.transactions.length, companies: state.companies.length, suppliers: state.suppliers.length },
    transactions: state.transactions,
    companies: state.companies,
    suppliers: state.suppliers,
    defaultSupplierId: state.defaultSupplierId,
    receiverAliases: state.receiverAliases || {},
  };
}

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON 형식이 아닙니다.');
  }
  if (!data || data.format !== BACKUP_FORMAT) {
    throw new Error('이 앱의 JSON 백업 파일이 아닙니다. (기존 프로그램 데이터는 "기존 프로그램 데이터 가져오기"를 쓰세요.)');
  }
  if (data.version > BACKUP_VERSION) {
    throw new Error(`더 새 버전(${data.version})의 앱에서 만든 백업입니다. 앱을 최신으로 받은 뒤 복원하세요.`);
  }
  if (!Array.isArray(data.transactions)) throw new Error('백업에 저장된 내역이 없습니다.');
  return {
    transactions: data.transactions.filter((t) => t && t.id != null),
    companies: Array.isArray(data.companies) ? data.companies : [],
    suppliers: Array.isArray(data.suppliers) ? data.suppliers : [],
    defaultSupplierId: data.defaultSupplierId,
    receiverAliases: data.receiverAliases && typeof data.receiverAliases === 'object' ? data.receiverAliases : {},
    exportedAt: data.exportedAt || '',
  };
}

// 복원하면 무엇이 바뀌는지. 같은 id인데 내용이 다르면 "덮어씀", 같으면 "그대로".
export function summarizeRestore(backup, state) {
  const byId = new Map(state.transactions.map((t) => [String(t.id), t]));
  let added = 0, overwritten = 0, unchanged = 0;
  backup.transactions.forEach((t) => {
    const cur = byId.get(String(t.id));
    if (!cur) added += 1;
    else if (JSON.stringify(cur) === JSON.stringify(t)) unchanged += 1;
    else overwritten += 1;
  });
  const names = new Set(state.companies.map((c) => c.name));
  const supplierIds = new Set(state.suppliers.map((s) => s.id));
  return {
    added, overwritten, unchanged,
    keptOnlyInApp: state.transactions.length - overwritten - unchanged,
    newCompanies: backup.companies.filter((c) => !names.has(c.name)).length,
    newSuppliers: backup.suppliers.filter((s) => !supplierIds.has(s.id)).length,
  };
}

// 복원 적용. 명세서는 id 기준으로 백업 내용으로 덮어쓰고 없는 것은 더한다(앱에만 있는 것은 그대로 둔다).
// 거래처는 같은 상호가 없을 때만, 공급자는 같은 id가 없을 때만 더한다 — 앱에서 고쳐 둔 내용을 옛 백업으로 덮지 않는다.
export function applyRestore(backup) {
  const state = useStore.getState();
  const byId = new Map(state.transactions.map((t) => [String(t.id), t]));
  backup.transactions.forEach((t) => byId.set(String(t.id), t));
  const names = new Set(state.companies.map((c) => c.name));
  const supplierIds = new Set(state.suppliers.map((s) => s.id));
  useStore.setState({
    transactions: [...byId.values()],
    companies: [...state.companies, ...backup.companies.filter((c) => !names.has(c.name))],
    suppliers: [...state.suppliers, ...backup.suppliers.filter((s) => !supplierIds.has(s.id))],
    receiverAliases: { ...backup.receiverAliases, ...state.receiverAliases },
  });
}

export function backupFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `거래명세서-백업-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

export function downloadBackup() {
  const json = JSON.stringify(buildBackup(useStore.getState()));
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- 연결한 파일에 자동 저장 (fileBackup.js) ----------
const backup = createFileBackup({
  handleKey: HANDLE_KEY,
  picker: {
    suggestedName: '거래명세서-저장내역.json',
    types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
  },
  makeContent: (state) => JSON.stringify(buildBackup(state)),
  delayMs: WRITE_DELAY_MS,
  watch: ['transactions', 'companies', 'suppliers', 'defaultSupplierId', 'receiverAliases'],
});

export const useJsonBackupStatus = backup.useStatus;
export const initJsonBackup = () => backup.init();
export const connectJsonBackup = () => backup.connect();
export const reconnectJsonBackup = () => backup.reconnect();
export const disconnectJsonBackup = () => backup.disconnect();
