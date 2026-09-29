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
