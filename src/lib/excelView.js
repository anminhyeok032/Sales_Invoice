// 엑셀 "보기 파일"에 들어갈 값 계산 (순수 함수). 엑셀 쓰기는 excelViewWriter.js가 한다.
//
// 엑셀은 보기 전용 사본이다 — 원본은 앱(과 JSON 백업)이고, 엑셀에서 고친 내용은 앱으로 돌아오지 않는다.
// 값은 모두 앱 화면과 같은 함수(statementView.js)로 계산해서, 저장된 내역 조회 목록·인쇄물과 같게 한다.
import { PRINT_ROWS_PER_PAGE, isMergedItem } from './transactionItems';
import { listContext, summarizeForList, printedSupplier, printedNotes, transactionOrigin } from './statementView';

// 'YYYYMMDD' -> 엑셀 날짜로 쓸 Date (UTC 자정 — 시간대 때문에 하루가 밀리지 않게). 모르면 null.
export function dateFromKey(key) {
  if (!key) return null;
  const d = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8))));
  return Number.isNaN(d.getTime()) ? null : d;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// 목록 순서: 앱 목록 기본값과 같게 작성일자 내림차순(같은 날은 입력 순서).
function sortedForList(rows) {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.dateKey.localeCompare(a.r.dateKey) || a.i - b.i)
    .map(({ r }) => r);
}

export function buildExcelView(state) {
  const { transactions = [], companies = [], suppliers = [], receiverAliases = {}, printOptions } = state;
  const ctx = listContext(companies, receiverAliases);
  const list = sortedForList(transactions.map((tx) => summarizeForList(tx, ctx)));

  const listRows = [];
  const itemRows = [];
  const mergedRows = [];
  list.forEach((row) => {
    const { tx } = row;
    const items = tx.items || [];
    const supplier = printedSupplier(state, tx);
    listRows.push({
      date: dateFromKey(row.dateKey),
      dateText: row.dateKey ? '' : String(tx.date || ''),   // 날짜로 못 읽는 값은 글자 그대로
      summary: row.summary,
      name: row.name,
      supply: row.supply,
      tax: row.tax,
      total: row.total,
      lines: items.length,
      pages: Math.max(1, Math.ceil(items.length / PRINT_ROWS_PER_PAGE)),
      supplier: supplier.name || '',
      origin: transactionOrigin(tx),
      id: String(tx.id),
    });

    const notes = printedNotes(items, printOptions);
    items.forEach((item, i) => {
      itemRows.push({
        id: String(tx.id),
        txDate: dateFromKey(row.dateKey),
        name: row.name,
        no: i + 1,
        date: item.date || '',
        itemName: item.name || '',
        spec: item.spec || '',
        unit: item.unit || '',
        qty: num(item.qty),
        price: num(item.price),
        supply: num(item.supply),
        tax: num(item.tax),
        printedNote: notes[i],
        memo: item.note || '',
        kind: item.newOrMod || '',
        time: item.processingTime || '',
        mergedCount: isMergedItem(item) ? item.mergedFrom.length : 0,
      });
      if (isMergedItem(item)) {
        const opts = { qty: 'max', time: 'max', ...item.mergeOptions };
        item.mergedFrom.forEach((src, k) => {
          mergedRows.push({
            id: String(tx.id),
            name: row.name,
            no: i + 1,
            order: k + 1,
            date: src.date || '',
            itemName: src.name || '',
            spec: src.spec || '',
            qty: num(src.qty),
            price: num(src.price),
            supply: num(src.supply),
            kind: src.newOrMod || '',
            time: src.processingTime || '',
            qtyMode: opts.qty,
            timeMode: opts.time,
          });
        });
      }
    });
  });

  return {
    list: listRows,
    items: itemRows,
    merged: mergedRows,
    companies: companies.map((c) => ({
      name: c.name || '', regNo: c.regNo || '', president: c.president || '', businessType: c.businessType || '',
      businessItem: c.businessItem || '', address: c.address || '', phone: c.phone || '',
    })),
    suppliers: suppliers.map((s) => ({
      name: s.name || '', regNo: s.regNo || '', president: s.president || '', businessType: s.businessType || '',
      businessItem: s.businessItem || '', address: s.address || '', account: s.account || '',
      isDefault: s.id === state.defaultSupplierId,
    })),
    totals: listRows.reduce((acc, r) => ({ supply: acc.supply + r.supply, tax: acc.tax + r.tax, total: acc.total + r.total }), { supply: 0, tax: 0, total: 0 }),
  };
}

export const MERGE_MODE_LABEL = { sum: '합산', max: '큰 값', min: '작은 값' };
