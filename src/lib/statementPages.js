// 명세서를 장(PRINT_ROWS_PER_PAGE줄) 단위로 나눠 저장하기.
//
// 한 번 저장할 때 12줄이 넘으면 장마다 따로 된 명세서(저장 기록)로 남긴다 — 저장된 내역 목록에서 장 하나하나를
// 찾을 수 있게. 같은 명세서에서 나온 장들은 groupId가 같고, page(1부터)로 순서를 안다.
//   { ...공통 칸(연도·월·거래처·작성일자·공급자…), id, groupId, page, title, items(12줄 이하) }
// title은 그 장에 직접 쓴 제목이다. 비어 있으면 1장 제목을 따라간다(effectiveTitle).
//
// groupId가 없는 예전 기록(기존 프로그램에서 가져온 것, 이 기능 전에 저장한 것)은 그 하나가 한 묶음이고,
// 묶음 열쇠는 자기 id다(groupKeyOf). 그런 기록을 다시 저장하면 그때 장으로 나뉘고, 1장이 원래 id를 이어 쓴다.
import { PRINT_ROWS_PER_PAGE } from './transactionItems';

export const groupKeyOf = (tx) => String(tx.groupId || tx.id);

// 같은 묶음의 장들(장 순서대로).
export function groupMembers(transactions, key) {
  return transactions
    .filter((t) => groupKeyOf(t) === key)
    .sort((a, b) => (a.page || 1) - (b.page || 1));
}

export function splitIntoPages(items) {
  const pages = [];
  for (let i = 0; i < items.length; i += PRINT_ROWS_PER_PAGE) pages.push(items.slice(i, i + PRINT_ROWS_PER_PAGE));
  return pages.length ? pages : [[]];
}

// n장의 제목: 그 장에 쓴 제목, 없으면 1장 제목.
export function effectiveTitle(titles, n) {
  return String(titles[n] || titles[0] || '').trim();
}

// 묶음 전체를 한 명세서처럼 보는 값(저장된 내역에서 묶음 줄을 눌렀을 때). id는 'group:<열쇠>'.
export const GROUP_VIEW_PREFIX = 'group:';
export function buildGroupView(members) {
  const first = members[0];
  return {
    ...first,
    id: `${GROUP_VIEW_PREFIX}${groupKeyOf(first)}`,
    groupView: groupKeyOf(first),
    items: members.flatMap((m) => m.items || []),
    pageTitles: members.map((m) => m.title || ''),
  };
}

const pick = (statement) => {
  const base = { ...statement };
  delete base.id;
  delete base.items;
  delete base.pageTitles;
  delete base.groupView;
  delete base.title;
  delete base.page;
  delete base.pageCount;
  return base;
};

// 저장할 내용을 장 기록들로 바꾼다. 실제로 바꾸는 것은 store.saveStatementPages가 한다.
//   statement: 공통 칸 + items(이번에 저장할 줄 전부) + pageTitles(장마다 쓴 제목)
//   target:
//     { kind: 'new' }              — 새로 저장. (연도, 월, 거래처, viewKey)가 같은 묶음이 있으면 그 묶음을 갈아 끼운다
//     { kind: 'group', key }       — 그 묶음 전체를 갈아 끼운다(묶음을 열어 고친 경우, 예전 기록 하나 포함)
//     { kind: 'page', id }         — 묶음 안의 한 장만 갈아 끼운다(그 장이 12줄을 넘으면 그 자리에 장이 늘어난다)
//     { kind: 'copy' }             — 언제나 새 묶음(사본). viewKey를 'copy:<묶음 id>'로 둬서 나중의 'new' 저장이
//                                    (같은 달·거래처라는 이유로) 이 사본을 짝지어 덮어쓰지 않게 한다
//   newId: 새 id를 만드는 함수
// 반환: { pages: 저장할 기록들(장 순서), removeIds: 지울 기록 id들, savedIds: 이번에 내용이 바뀐 장들의 id }
export function planStatementSave(transactions, statement, target, newId) {
  const base = pick(statement);
  const titles = statement.pageTitles || [];
  const chunks = splitIntoPages(statement.items || []);

  let key = null;
  if (target.kind === 'group') key = target.key;
  if (target.kind === 'new') {
    const viewKey = statement.viewKey || '';
    // 기존 프로그램 명세서(묶음 열쇠가 'gdb-…')는 짝짓지 않는다. 장으로 나눈 기존 명세서의 2장부터는 id가 새것이라
    // id만 보면 걸러지지 않는다 — 그러면 새로 쓴 명세서가 기존 명세서 자리(gdb- id)에 들어가 기존 내용을 지우고,
    // 다음에 gdb를 다시 가져올 때 이 새 명세서까지 지워진다.
    const match = transactions.find((t) => !groupKeyOf(t).startsWith('gdb-')
      && t.year === statement.year && t.month === statement.month
      && t.companyName === statement.companyName
      && (t.viewKey || '') === viewKey);
    if (match) key = groupKeyOf(match);
  }

  if (target.kind === 'page') {
    const page = transactions.find((t) => t.id === target.id);
    if (!page) return planStatementSave(transactions, statement, { kind: 'new' }, newId);
    const groupId = groupKeyOf(page);
    const members = groupMembers(transactions, groupId);
    const at = members.findIndex((m) => m.id === page.id);
    const edited = chunks.map((items, i) => ({
      ...page, ...base, id: i === 0 ? page.id : newId(), groupId, title: titles[i] || '', items,
    }));
    const all = [...members.slice(0, at), ...edited, ...members.slice(at + 1)]
      .map((t, i) => ({ ...t, page: i + 1 }));
    return { pages: all, removeIds: [], savedIds: edited.map((p) => p.id) };
  }

  const members = key ? groupMembers(transactions, key) : [];
  const groupId = key || newId();
  if (target.kind === 'copy') base.viewKey = `copy:${groupId}`;
  const pages = chunks.map((items, i) => ({
    ...base,
    id: members[i]?.id || (i === 0 && !key ? groupId : newId()),
    groupId,
    page: i + 1,
    title: titles[i] || '',
    items,
  }));
  return {
    pages,
    removeIds: members.slice(chunks.length).map((m) => m.id),
    savedIds: pages.map((p) => p.id),
  };
}
