// 기존 거래명세서 프로그램(Tradetax.gdb)에서 뽑아낸 JSON을 앱 형식으로 읽어들인다.
//
// 파일은 tools/gdb/export_tradetax.py --app 이 만든다. 자세한 건 tools/gdb/README.md.
// 사용자가 고른 파일을 그대로 믿지 않고, 필요한 모양인지 확인한 뒤 값을 정규화한다.

import { createEmptyItem } from './transactionItems';

const FORMAT = 'tradetax-gdb-import';

const str = (v) => (v == null ? '' : String(v));
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function normalizeItem(raw) {
  const base = createEmptyItem();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    date: str(raw.date),
    name: str(raw.name),
    spec: str(raw.spec),
    unit: str(raw.unit) || base.unit,
    qty: num(raw.qty),
    price: num(raw.price),
    supply: num(raw.supply),
    tax: num(raw.tax),
    note: str(raw.note),
  };
}

function normalizeTransaction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id);
  const companyName = str(raw.companyName);
  if (!id || !companyName) return null;
  return {
    id,
    year: num(raw.year),
    month: num(raw.month),
    companyName,
    date: str(raw.date),
    items: Array.isArray(raw.items) ? raw.items.map(normalizeItem) : [],
  };
}

function normalizeCompany(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = str(raw.name);
  if (!name) return null;
  return {
    id: str(raw.id) || name,
    name,
    president: str(raw.president),
    regNo: str(raw.regNo),
    businessType: str(raw.businessType),
    businessItem: str(raw.businessItem),
    address: str(raw.address),
    phone: str(raw.phone),
  };
}

// 파일 내용 -> { transactions, companies, generatedAt }. 형식이 아니면 에러를 던진다.
export function parseLegacyImportFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON 파일이 아닙니다.');
  }
  if (!data || data.format !== FORMAT) {
    throw new Error(
      '이 앱이 아는 형식이 아닙니다. tools/gdb/export_tradetax.py --app 으로 만든 파일을 골라주세요.'
    );
  }
  if (!Array.isArray(data.transactions)) {
    throw new Error('파일에 거래명세서 목록(transactions)이 없습니다.');
  }

  const transactions = data.transactions.map(normalizeTransaction).filter(Boolean);
  if (transactions.length === 0) {
    throw new Error('가져올 거래명세서가 없습니다.');
  }
  const companies = Array.isArray(data.companies)
    ? data.companies.map(normalizeCompany).filter(Boolean)
    : [];

  return { transactions, companies, generatedAt: str(data.generatedAt) };
}

// 가져오기 전에 사용자에게 보여줄 요약.
export function summarizeImport(parsed, existingTransactions, existingCompanies) {
  const existingIds = new Set(existingTransactions.map((t) => t.id));
  const overwritten = parsed.transactions.filter((t) => existingIds.has(t.id)).length;
  const years = parsed.transactions.map((t) => t.year).filter((y) => y > 0);
  const existingNames = new Set(existingCompanies.map((c) => c.name));
  return {
    total: parsed.transactions.length,
    added: parsed.transactions.length - overwritten,
    overwritten,
    items: parsed.transactions.reduce((sum, t) => sum + t.items.length, 0),
    minYear: years.length ? Math.min(...years) : 0,
    maxYear: years.length ? Math.max(...years) : 0,
    newCompanies: parsed.companies.filter((c) => !existingNames.has(c.name)).length,
  };
}

// 거래처는 더하기만 한다. 이미 있는 상호는 손대지 않는다 — 사용자가 앱에서 고쳐둔
// 내용이나 업체목록.xls와 맞춰둔 내용을 예전 데이터로 덮어쓰면 안 된다.
export function mergeCompanies(existing, incoming) {
  const names = new Set(existing.map((c) => c.name));
  const added = incoming.filter((c) => !names.has(c.name));
  return [...existing, ...added];
}
