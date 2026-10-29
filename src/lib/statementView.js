// 저장된 명세서 한 건을 "화면/인쇄물에 보이는 값"으로 바꾸는 계산들.
// 저장된 내역 조회 화면, 인쇄 양식, 엑셀 보기 파일이 모두 이 함수들을 써서 같은 값을 보인다.
import { resolveSupplier } from '../store';
import { matchReceiver, receiverInfo } from './companyLookup';
import { applyOverride, patchFor } from './partyOverride';
import { computeTotals, dailySumLabels } from './transactionItems';
import { toDateKey } from './dateRange';

// ---------- 목록 한 줄 (저장된 내역 조회 목록) ----------
// 목록 전체(수천 건)를 도는 계산이라, 이름 비교(fuzzy)는 하지 않고 id/별칭/이름 일치만 본다.
export function listContext(companies, receiverAliases = {}) {
  return { companies, aliases: receiverAliases, byId: new Map(companies.map((c) => [c.id, c])) };
}

export function summarizeForList(tx, ctx) {
  const company = ctx.byId.get(tx.receiverId) || ctx.byId.get(ctx.aliases[tx.companyName])
    || ctx.companies.find((c) => c.name === tx.companyName);
  const override = patchFor(tx.receiverOverride, company?.id ?? '');
  const named = (tx.items || []).filter((i) => String(i.name || '').trim());
  const totals = computeTotals(tx.items || []);
  // 기존 DB에는 상호 앞뒤에 공백이 붙은 것이 있다. 화면에서는 안 보이지만 정렬하면 맨 앞으로
  // 튀어나오므로, 앞뒤 공백은 떼고 정렬할 때는 공백을 모두 무시한다.
  const name = String(override?.name || company?.name || tx.companyName || '').trim();
  return {
    tx,
    dateKey: toDateKey(tx.date),
    name,
    sortName: name.replace(/\s+/g, ''),
    summary: named.length ? `${named[0].name.trim()}${named.length > 1 ? ` 외 ${named.length - 1}종` : ''}` : '',
    ...totals,
  };
}

// ---------- 인쇄되는 공급자 / 공급받는자 ----------
// 공급받는자: 저장할 때 고른 거래처(receiverId). 이 기능 전에 저장돼 엑셀 이름('가나')만
// 남아 있거나 그 거래처를 지웠으면, 자동 작성과 같은 방식으로 이름을 비교해 찾는다.
export function receiverMatchFor(tx, companies, receiverAliases = {}) {
  const auto = matchReceiver(companies, tx.companyName, receiverAliases);
  const saved = companies.find((c) => c.id === tx.receiverId);
  if (saved) return { ...auto, company: saved, how: 'saved', ambiguous: false };
  if (tx.receiverId === '') return { ...auto, company: null, how: 'saved', ambiguous: false };
  return auto;
}

export function printedReceiver(tx, companies, receiverAliases = {}, match = receiverMatchFor(tx, companies, receiverAliases)) {
  const base = receiverInfo(match.company, tx.companyName);
  return applyOverride(base, patchFor(tx.receiverOverride, match.company?.id ?? ''));
}

// 저장할 때 골랐던 공급자(없거나 지웠으면 기본 공급자) + 이 명세서에서만 고친 칸.
export function printedSupplier(state, tx) {
  const supplier = resolveSupplier(state, tx.supplierId);
  return applyOverride(supplier, tx.supplierOverride?.[supplier.id]);
}

// ---------- 인쇄되는 비고 ----------
// 출력 설정(품목 비고 메모 / 일별 합계)에 따라 각 줄의 비고 칸에 찍히는 글자.
// 거래 내역 수정에서 그 줄의 비고를 직접 고쳤으면(item.printNote, 빈 글자도 포함) 자동 값 대신 그것을 찍는다.
// 단 출력 설정을 둘 다 끄면 비고 칸은 비운다 — 끈 상태에서 고친 값만 몰래 찍히지 않게.
export function printedNotes(items, printOptions = {}) {
  const { showNote = true, showDailySum = true } = printOptions || {};
  const auto = autoNotes(items, { showNote, showDailySum });
  if (!showNote && !showDailySum) return auto;
  return items.map((item, i) => (item.printNote != null ? String(item.printNote) : auto[i]));
}

// 직접 고친 값을 빼고 출력 설정만으로 정해지는 비고. 편집표에서 "자동 값"으로 보여 줄 때도 쓴다.
export function autoNotes(items, printOptions = {}) {
  const { showNote = true, showDailySum = true } = printOptions || {};
  const daily = showDailySum ? dailySumLabels(items) : [];
  return items.map((item, i) => {
    const memo = showNote ? (item.note || '') : '';
    const d = daily[i] || '';
    return d ? (memo ? `${memo} (${d})` : d) : memo;
  });
}

// 인쇄되는 단위. 거의 모든 줄이 EA라서 EA는 찍지 않고, 다른 단위(기존 프로그램에서 온 값 등)만 찍는다.
export function printedUnit(unit) {
  const u = String(unit ?? '').trim();
  return u.toUpperCase() === 'EA' ? '' : u;
}

// 명세서가 어디서 왔는지.
export function transactionOrigin(tx) {
  if (String(tx.id).startsWith('gdb-')) return '기존 프로그램';
  if (tx.viewKey) return '필터 상태 저장';
  return '앱에서 작성';
}
