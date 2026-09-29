// 거래 내역 편집표의 컬럼별 정렬/필터 로직.
//
// 정렬과 필터는 성격이 다르다.
//   · 정렬 — 실제 항목 순서를 바꾼다. 출력(PDF)에 나가는 순서가 곧 항목 순서이므로,
//            보기만 바꾸면 정렬한 대로 인쇄되지 않아 쓸모가 없다.
//   · 필터 — 보기에서 숨기기만 한다. 엑셀과 같고, 숨긴 항목도 저장/출력에는 그대로 나간다.

// 세로 화면에서 가로 스크롤 없이 다 보이도록 제목은 짧게, 긴 설명은 hint(툴팁)로.
// 단위는 편집표에서 뺐다(항상 EA라 자리만 차지했다). 값은 그대로 두고 인쇄에는 나간다.
// 순서는 기존 프로그램 화면처럼 품목 바로 옆에 규격.
// 세액(optional)은 거의 쓰지 않아서 평소에는 숨기고, 입력할 때나 값이 있을 때만 보인다.
export const ITEM_COLUMNS = [
  { key: 'date', label: ['날짜'] },
  { key: 'name', label: ['품목'], hint: '품목 (조합됨)' },
  { key: 'spec', label: ['규격'], hint: '규격 (비고)' },
  { key: 'newOrMod', label: ['구분'], hint: '구분 (신작/수정/자사불량) — 확인용, 인쇄 안 됨' },
  { key: 'qty', label: ['수량'], numeric: true },
  { key: 'processingTime', label: ['가공', '시간'], hint: '가공시간 — 확인용, 인쇄 안 됨' },
  { key: 'price', label: ['단가'], numeric: true, hint: '단가 (입력)' },
  { key: 'supply', label: ['공급', '가액'], numeric: true, hint: '공급가액' },
  { key: 'tax', label: ['세액'], numeric: true, hint: '세액 (직접 입력)', optional: true },
];

export const EMPTY_LABEL = '(비어 있음)';

// 필터/정렬에서 한 칸을 대표하는 문자열. 빈 값은 모두 ''로 모은다.
export function valueKey(item, key) {
  const v = item?.[key];
  return v === null || v === undefined ? '' : String(v);
}

export function valueLabel(item, key, numeric) {
  const k = valueKey(item, key);
  if (k === '') return EMPTY_LABEL;
  if (numeric) {
    const n = Number(k);
    return Number.isFinite(n) ? n.toLocaleString() : k;
  }
  return k;
}

// 그 칸에 실제로 들어있는 값들. 엑셀 필터 목록처럼 오름차순으로 준다.
export function distinctValues(items, key, numeric) {
  const seen = new Map();
  items.forEach((item) => {
    const k = valueKey(item, key);
    if (!seen.has(k)) seen.set(k, { key: k, label: valueLabel(item, key, numeric), count: 0 });
    seen.get(k).count += 1;
  });
  return [...seen.values()].sort((a, b) => compare(a.key, b.key, numeric));
}

function compare(a, b, numeric) {
  if (numeric) {
    const na = Number(a), nb = Number(b);
    const va = Number.isFinite(na) ? na : Number.NEGATIVE_INFINITY;
    const vb = Number.isFinite(nb) ? nb : Number.NEGATIVE_INFINITY;
    if (va !== vb) return va - vb;
    return 0;
  }
  // 빈 값은 항상 뒤로 보낸다 — 비어 있는 줄이 위로 몰리면 보기 나쁘다.
  if (a === '' && b !== '') return 1;
  if (b === '' && a !== '') return -1;
  return a.localeCompare(b, 'ko');
}

// 항목 순서를 실제로 바꾼 새 배열. Array.sort는 안정 정렬이라 같은 값끼리는
// 원래 순서(사용자가 드래그로 맞춰둔 순서)가 유지된다.
export function sortItemsBy(items, key, direction = 'asc') {
  const numeric = ITEM_COLUMNS.find((c) => c.key === key)?.numeric;
  const sorted = [...items].sort((x, y) =>
    compare(valueKey(x, key), valueKey(y, key), numeric));
  return direction === 'desc' ? sorted.reverse() : sorted;
}

// filters: { [columnKey]: string[] }  — 그 칸에서 체크된 값들.
// 반환값은 원래 인덱스를 달고 있는 목록. 편집/삭제가 원본 배열을 가리켜야 하기 때문.
export function filterItems(items, filters) {
  const active = Object.entries(filters).filter(([, v]) => Array.isArray(v));
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) =>
      active.every(([key, allowed]) => allowed.includes(valueKey(item, key))));
}

export function isFilterActive(filters) {
  return Object.values(filters).some((v) => Array.isArray(v));
}

// 필터로 보이는 줄에만 변경(순서변경/합치기/빼내기/정렬)을 적용하고, 숨긴 줄은 제자리에 둔다.
//   visibleIndexes: 보이는 줄의 원래 인덱스(오름차순)  — filterItems()의 index들
//   transform: 보이는 줄만 모은 배열을 받아 바뀐 배열을 돌려주는 함수
// 보이는 줄이 차지하던 "자리"에 바뀐 줄을 차례로 다시 채워 넣는다. 합쳐서 줄이 줄면 뒤쪽 자리는
// 비고, 빼내기처럼 줄이 늘면 남는 줄은 마지막 자리 바로 뒤에 들어간다. 필터가 없으면
// (모든 줄이 보임) transform 결과 그대로다.
export function applyToVisible(items, visibleIndexes, transform) {
  const next = transform(visibleIndexes.map((i) => items[i]));
  const slots = new Set(visibleIndexes);
  const out = [];
  let taken = 0;
  let lastSlot = -1;
  items.forEach((item, i) => {
    if (!slots.has(i)) { out.push(item); return; }
    if (taken < next.length) {
      out.push(next[taken]);
      taken += 1;
      lastSlot = out.length - 1;
    }
  });
  if (taken < next.length) out.splice(lastSlot + 1, 0, ...next.slice(taken));
  return out;
}

// 이 필터 상태를 나타내는 안정적인 글자. 같은 조건이면 항상 같은 글자라서, 필터로 저장한 명세서를
// 다시 저장할 때 "같은 화면"인지 알아보는 데 쓴다. 필터가 없으면 ''.
export function filtersKey(filters) {
  return Object.keys(filters)
    .filter((k) => Array.isArray(filters[k]))
    .sort()
    .map((k) => `${k}=${[...filters[k]].sort().join('|')}`)
    .join(';');
}
