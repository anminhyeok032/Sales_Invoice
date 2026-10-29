import { toDateKey } from './dateRange';

export function createEmptyItem() {
  return { date: '', name: '', spec: '', unit: 'EA', qty: 0, price: 0, supply: 0, tax: 0, note: '', newOrMod: '', processingTime: '' };
}

// 인쇄 양식은 한 장에 12줄씩 찍는다(기존 프로그램 양식과 같은 줄 수). 넘치면 여러 장이 되고
// 장마다 명세서 전체의 합계가 찍힌다(장별 합계는 거래 내역 수정 화면에만 보인다).
export const PRINT_ROWS_PER_PAGE = 12;

// 인쇄 양식과 같은 계산: 금액 = Σ공급가액, 세액 = Σ세액, 합계 = 금액 + 세액.
// 합쳐진 항목은 대표 행(원본 합계)만 세므로 인쇄되는 줄과 같다.
export function computeTotals(items) {
  const supply = items.reduce((sum, item) => sum + (Number(item.supply) || 0), 0);
  const tax = items.reduce((sum, item) => sum + (Number(item.tax) || 0), 0);
  return { supply, tax, total: supply + tax };
}

// 일별 합계(비고 칸에 찍는 값). 같은 날짜의 줄들을 한 묶음으로 보고, 묶음의 마지막 줄에만 그날 공급가액
// 합계를 돌려준다. 묶음은 날짜가 적힌 줄에서 시작해서, 날짜가 빈 줄들(같은 날짜가 이어지는 줄)을 지나
// 다른 날짜가 나오기 직전까지다. 같은 날짜가 바로 다음 줄에 또 적혀 있어도 같은 묶음이다.
//   예) 09/01, (빈칸), (빈칸), 09/02, (빈칸)  ->  세 번째 줄과 다섯 번째 줄에만 합계
// 합계는 끝자리의 0을 모두 뗀 값이다: 50000 -> '5', 1670 -> '167', 1234 -> '1234'.
// 반환: items와 같은 길이의 배열. 합계를 찍을 줄에만 글자, 나머지는 ''.
// 맨 앞에 날짜 없는 줄이 있으면(어느 날짜에도 속하지 않음) 합계에 넣지 않는다. 합계가 0 이하면 찍지 않는다.
export function dailySumLabels(items) {
  const labels = items.map(() => '');
  let currentDate = null;   // 지금 묶음의 날짜 (묶음이 아직 없으면 null)
  let sum = 0;
  const close = (lastIndex) => {
    if (currentDate !== null && sum > 0) labels[lastIndex] = formatDailySum(sum);
  };
  items.forEach((item, index) => {
    const date = String(item.date ?? '').trim();
    if (date && date !== currentDate) {
      close(index - 1);
      currentDate = date;
      sum = 0;
    }
    if (currentDate !== null) sum += Number(item.supply) || 0;
  });
  close(items.length - 1);
  return labels;
}

function formatDailySum(sum) {
  return Number.isInteger(sum) ? String(sum).replace(/0+$/, '') : String(sum);
}

// 품목 날짜에서 연도 빼고 보이기. 가공일지에서 읽은 날짜는 'yy/mm/dd'로 연도까지 저장한다 — 합칠 때
// '가장 최근 날짜'를 고르거나 기간을 비교하려면 연도가 필요해서 저장은 그대로 두고, 화면과 인쇄에서만 'mm/dd'로 보인다.
// 연도가 없는 값(기존 프로그램의 '10.01', 같은 날 표시 '"' 등)은 그대로.
const ITEM_DATE_WITH_YEAR = /^(\d{2}|\d{4})[/.-](\d{1,2}[/.-].*)$/;
export function itemDateLabel(date) {
  const text = String(date ?? '');
  const m = text.match(ITEM_DATE_WITH_YEAR);
  return m ? m[2] : text;
}

export function itemDateYear(date) {
  const m = String(date ?? '').match(ITEM_DATE_WITH_YEAR);
  return m ? m[1] : '';
}

// 연도 없이 입력한 날짜('10/05')에 연도를 다시 붙여 저장할 값. 연도는 그 줄이 원래 갖던 연도, 없으면 year.
// 'mm/'처럼 월로 시작하는 입력에만 붙인다(빈 칸, '"' 같은 표시, 연도까지 친 값은 그대로).
export function itemDateFromInput(typed, prevDate, year) {
  const y = itemDateYear(prevDate) || year;
  if (!y || ITEM_DATE_WITH_YEAR.test(typed) || !/^\d{1,2}[/.-]/.test(typed)) return typed;
  return `${y}/${typed}`;
}

// index 자리에 빈 줄을 하나 끼워 넣은 새 배열. index가 0이면 맨 위, items.length면 맨 끝.
// 합쳐진 항목이 있어도 최상위 목록 기준이라 그룹 통째로 앞/뒤에 들어간다(그룹 안으로는 안 들어감).
export function insertItemAt(items, index, newItem = createEmptyItem()) {
  const at = Math.max(0, Math.min(index, items.length));
  const next = [...items];
  next.splice(at, 0, newItem);
  return next;
}

export function applyItemChange(items, index, field, value) {
  const newItems = [...items];
  newItems[index] = { ...newItems[index], [field]: value };

  // 공급가액은 직접 입력할 수 있지만 단가가 우선이다: 단가가 있으면(0보다 크면) 공급가액은
  // 항상 수량 x 단가이고, 그때 공급가액을 직접 넣으려는 입력은 무시한다. 단가가 없을 때만
  // 직접 입력한 값이 남는다. 단가를 지워도 공급가액은 그대로 두어(직접 입력 값이 된다) 고칠 수 있다.
  // 세액은 건드리지 않는다 — 기존 명세서 중 세액이 있었던 건 0.5%도 안 돼서, 사용자가 직접 넣을 때만 들어간다.
  const price = Number(newItems[index].price) || 0;
  if (field === 'supply' && price > 0) return items;
  if ((field === 'price' || field === 'qty') && price > 0) {
    newItems[index].supply = (Number(newItems[index].qty) || 0) * price;
  }
  return newItems;
}

// 모든 줄의 세액을 0으로. (예전 버전이 자동으로 넣어 둔 10% 세액을 한 번에 지울 때)
export function clearTaxes(items) {
  return items.map((item) => (Number(item.tax) ? { ...item, tax: 0 } : item));
}

// 여러 줄 복사: positions(배열 안 자리들)의 줄을 복제해서, 고른 줄 중 마지막 줄 바로 아래에 같은 순서로 넣는다.
// 합쳐진 줄은 원본까지 통째로 복제하고 새 mergeId를 준다(같은 id가 둘이면 펼치기·끌기가 섞인다).
// 반환: { items: 새 배열, copies: 넣은 복제본들 }
export function copyItems(items, positions) {
  const sorted = [...new Set(positions)].filter((p) => p >= 0 && p < items.length).sort((a, b) => a - b);
  if (sorted.length === 0) return { items, copies: [] };
  const copies = sorted.map((p) => {
    const item = items[p];
    if (!isMergedItem(item)) return { ...item };
    return { ...item, mergeId: nextMergeId(), mergedFrom: item.mergedFrom.map((s) => ({ ...s })) };
  });
  const next = [...items];
  next.splice(sorted[sorted.length - 1] + 1, 0, ...copies);
  return { items: next, copies };
}

// 여러 줄 한꺼번에 옮기기: positions의 줄들을 (원래 순서대로 붙여서) target 줄 자리로 옮긴다.
// target이 고른 줄들보다 아래면 target 줄 아래에, 위면 target 줄 위에 들어간다 — 한 줄 옮기기(reorderItems)와 같은 느낌.
// target이 고른 줄 중 하나면 그대로.
export function moveItemsTo(items, positions, target) {
  const chosen = new Set(positions);
  if (chosen.size === 0 || chosen.has(target) || target < 0 || target >= items.length) return items;
  const block = items.filter((_, i) => chosen.has(i));
  const rest = items.filter((_, i) => !chosen.has(i));
  const anchor = rest.indexOf(items[target]);
  const at = target > Math.min(...chosen) ? anchor + 1 : anchor;
  rest.splice(at, 0, ...block);
  return rest;
}

export function reorderItems(items, fromIndex, toIndex) {
  const newItems = [...items];
  const [moved] = newItems.splice(fromIndex, 1);
  newItems.splice(toIndex, 0, moved);
  return newItems;
}

const HEAT_BEFORE = '열처리 전';
const HEAT_AFTER = '열처리 후';
const HEAT_BOTH = '열처리 전, 후';

// 규격(비고) 셀의 열처리 표기가 '열전' / '열 처리 전' / '열처리전'처럼 제각각이라,
// 공백을 지운 뒤 정해진 표기로 맞춘다. 열처리 관련 표기가 아니면 원문을 그대로 둔다.
export function normalizeSpec(spec) {
  const text = String(spec ?? '');
  const compact = text.replace(/\s/g, '');
  if (compact === '열전' || compact === '열처리전') return HEAT_BEFORE;
  if (compact === '열후' || compact === '열처리후') return HEAT_AFTER;
  return text;
}

// 날짜는 'YY/MM/DD'(엑셀 파싱 결과)와 직접 입력한 다른 형식이 섞일 수 있어서,
// 숫자만 뽑아 8자리로 맞춘 뒤 비교한다. 비교 불가한 값은 가장 낮은 순위.
const dateSortKey = toDateKey;

let mergeSeq = 0;
// 펼침 상태를 인덱스가 아니라 그룹 자체에 묶어두기 위한 식별자.
// 인덱스는 순서변경/빼내기로 계속 바뀌기 때문에 키로 쓸 수 없다.
const nextMergeId = () => `m${Date.now().toString(36)}-${(mergeSeq++).toString(36)}`;

function stripMergeMeta(item) {
  const copy = { ...item };
  delete copy.mergedFrom;
  delete copy.mergeId;
  delete copy.mergeOptions;
  return copy;
}

export function isMergedItem(item) {
  return Array.isArray(item?.mergedFrom) && item.mergedFrom.length > 0;
}

function mergeSpecs(sources) {
  const normalized = sources.map((item) => normalizeSpec(item.spec));
  if (normalized.includes(HEAT_BEFORE) && normalized.includes(HEAT_AFTER)) return HEAT_BOTH;
  return normalized[0];
}

// 여러 줄을 합칠 때 수량과 가공시간을 어떻게 정할지. 합친 줄마다 따로 정한다(대표 항목의 mergeOptions) —
// 펼친 줄에서 고른다. 새로 합칠 때의 기본값은 표 위에서 고르는 값(store.mergeOptions)이고, 이 파일의
// mergeOptions 변수가 그 기본값이다. 이미 합쳐 둔 줄은 기본값을 바꿔도 그대로다.
//   sum: 합산 / max: 가장 큰 값 / min: 가장 작은 값
// 방식이 기록되지 않은 예전 합침은 둘 다 max로 본다.
const LEGACY_MERGE_OPTIONS = { qty: 'max', time: 'max' };
export const MERGE_MODES = [
  { value: 'sum', label: '합산' },
  { value: 'max', label: '큰 값' },
  { value: 'min', label: '작은 값' },
];
let mergeOptions = { qty: 'sum', time: 'sum' };
export function setMergeOptions(options) {
  mergeOptions = { ...mergeOptions, ...options };
}

// 'H:MM' 글자 -> 분. 한 칸에 여러 개('1면 1:10 / 2면 6:20'처럼)가 들어 있으면 그 시간들의 합. 시간이 없으면 null.
function timeToMinutes(text) {
  const tokens = String(text ?? '').match(/\d+:\d{1,2}/g);
  if (!tokens) return null;
  return tokens.reduce((sum, t) => {
    const [h, m] = t.split(':');
    return sum + Number(h) * 60 + Number(m);
  }, 0);
}

export function minutesToHM(minutes) {
  const total = Math.round(minutes);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function mergeQty(sources, mode) {
  const values = sources.map((item) => Number(item.qty) || 0);
  if (mode === 'sum') return values.reduce((a, b) => a + b, 0);
  if (mode === 'min') {
    // 수량이 비어 있는(0) 줄은 "가장 작은 값"으로 치지 않는다. 다 비어 있으면 0.
    const positive = values.filter((v) => v > 0);
    return positive.length ? Math.min(...positive) : 0;
  }
  return Math.max(...values);
}

// 시간을 읽을 수 있는 줄만 대상으로 한다. 하나도 없으면 맨 위 줄 값을 그대로 둔다.
// 큰 값/작은 값은 그 줄의 원래 표기를 그대로 쓰고, 합산은 H:MM으로 다시 만든다.
function mergeProcessingTime(sources, mode) {
  const timed = sources
    .map((item) => ({ raw: item.processingTime, minutes: timeToMinutes(item.processingTime) }))
    .filter((t) => t.minutes !== null);
  if (timed.length === 0) return sources[0].processingTime;
  if (mode === 'sum') return minutesToHM(timed.reduce((sum, t) => sum + t.minutes, 0));
  const pick = mode === 'min'
    ? timed.reduce((best, t) => (t.minutes < best.minutes ? t : best))
    : timed.reduce((best, t) => (t.minutes > best.minutes ? t : best));
  return pick.raw;
}

// 합친 줄 하나의 수량/가공시간 방식을 바꾸고 그 줄만 다시 계산한다. index는 items 안의 자리.
export function setGroupMergeOptions(items, index, patch) {
  const item = items[index];
  if (!isMergedItem(item)) return items;
  const options = { ...LEGACY_MERGE_OPTIONS, ...item.mergeOptions, ...patch };
  const result = [...items];
  result[index] = buildRepresentative(item.mergedFrom, item.mergeId, options);
  return result;
}

// 대표 항목은 언제나 현재 원본 목록에서 파생된다. 원본이 바뀌면(순서변경/빼내기/추가)
// 반드시 다시 계산해야 '날짜=최신, 돈=합계, 수량·가공시간=고른 방식, 나머지=최상단' 기준이 유지된다.
function buildRepresentative(sources, mergeId, options) {
  const head = sources[0];
  const latest = sources.reduce((best, item) =>
    dateSortKey(item.date) > dateSortKey(best.date) ? item : best
  , head);

  return {
    ...stripMergeMeta(head),
    date: latest.date,
    qty: mergeQty(sources, options.qty),
    processingTime: mergeProcessingTime(sources, options.time),
    supply: sources.reduce((sum, item) => sum + (Number(item.supply) || 0), 0),
    tax: sources.reduce((sum, item) => sum + (Number(item.tax) || 0), 0),
    spec: mergeSpecs(sources),
    mergeId: mergeId || nextMergeId(),
    mergeOptions: { qty: options.qty, time: options.time },
    mergedFrom: sources.map((s) => ({ ...s })),
  };
}

// 원본이 1개만 남으면 병합이 풀려 원래의 일반 항목으로 되돌아간다.
function rebuildGroup(sources, mergeId, options) {
  if (sources.length === 0) return null;
  if (sources.length === 1) return stripMergeMeta(sources[0]);
  return buildRepresentative(sources, mergeId, options);
}

// 항목을 '원본 목록' 관점으로 편다. 합쳐진 항목이면 그 원본들, 아니면 자기 자신 1개.
function toSources(item) {
  return isMergedItem(item) ? item.mergedFrom.map((s) => ({ ...s })) : [stripMergeMeta(item)];
}

// 그룹의 원본 목록을 교체하고 대표 항목을 다시 계산한다.
// 남는 원본이 1개 이상이면 배열 길이가 유지되므로 다른 인덱스가 밀리지 않는다.
function withSources(items, parentIndex, nextSources) {
  const rebuilt = rebuildGroup(nextSources, items[parentIndex]?.mergeId, items[parentIndex]?.mergeOptions || LEGACY_MERGE_OPTIONS);
  const result = [...items];
  if (rebuilt === null) result.splice(parentIndex, 1);
  else result[parentIndex] = rebuilt;
  return result;
}

// 여러 항목을 하나의 대표 항목으로 합친다. 원본은 mergedFrom에 보관되어 화면에서만
// 펼쳐 볼 수 있고, 출력(PDF)/엑셀 백업에는 대표 항목 한 줄만 나간다.
export function mergeItems(items, indices) {
  const targets = [...new Set(indices)].filter((i) => items[i]).sort((a, b) => a - b);
  if (targets.length < 2) return items;

  const targetSet = new Set(targets);
  // 이미 합쳐진 항목을 다시 합칠 때 중첩되지 않도록 원본 단위로 펼쳐서 보관한다.
  const sources = targets.flatMap((i) => toSources(items[i]));
  const keptId = targets.map((i) => items[i].mergeId).find(Boolean);
  // 이미 합쳐진 줄이 끼어 있으면 그 줄의 방식을 이어받고, 전부 새로 합치는 것이면 기본값을 쓴다.
  const inherited = targets.map((i) => items[i].mergeOptions).find(Boolean);
  const merged = buildRepresentative(sources, keptId, inherited || mergeOptions);

  const result = [];
  items.forEach((item, i) => {
    if (i === targets[0]) result.push(merged);
    else if (!targetSet.has(i)) result.push(item);
  });
  return result;
}

// 합쳐진 항목을 원본 여러 줄로 되돌린다.
export function unmergeItem(items, index) {
  const item = items[index];
  if (!isMergedItem(item)) return items;

  const restored = item.mergedFrom.map((source) => ({ ...source }));
  const result = [...items];
  result.splice(index, 1, ...restored);
  return result;
}

// 병합 안에서 원본 순서를 바꾼다. 맨 위가 바뀌면 대표 항목의 품목/단가/규격도 따라 바뀐다.
export function reorderGroupSource(items, parentIndex, fromSub, toSub) {
  const parent = items[parentIndex];
  if (!isMergedItem(parent)) return items;
  const sources = parent.mergedFrom.map((s) => ({ ...s }));
  if (!sources[fromSub] || !sources[toSub] || fromSub === toSub) return items;

  const [moved] = sources.splice(fromSub, 1);
  sources.splice(toSub, 0, moved);
  return withSources(items, parentIndex, sources);
}

// 병합에서 원본 하나를 빼내 최상위 목록의 targetIndex 자리에 놓는다.
// 남은 원본이 1개면 그 그룹은 병합이 풀린다.
export function extractGroupSource(items, parentIndex, subIndex, targetIndex) {
  const parent = items[parentIndex];
  if (!isMergedItem(parent) || !parent.mergedFrom[subIndex]) return items;

  const removed = { ...parent.mergedFrom[subIndex] };
  const remaining = parent.mergedFrom.filter((_, i) => i !== subIndex).map((s) => ({ ...s }));
  const result = withSources(items, parentIndex, remaining);
  const at = Math.max(0, Math.min(targetIndex, result.length));
  result.splice(at, 0, removed);
  return result;
}

// 원본을 다른 그룹(또는 일반 항목)으로 옮긴다. 원래 그룹은 1개만 남으면 병합이 풀린다.
export function moveSourceToGroup(items, fromParent, subIndex, toParent, toSub) {
  const parent = items[fromParent];
  if (!isMergedItem(parent) || !parent.mergedFrom[subIndex]) return items;
  if (fromParent === toParent || !items[toParent]) return items;

  const removed = { ...parent.mergedFrom[subIndex] };
  const remaining = parent.mergedFrom.filter((_, i) => i !== subIndex).map((s) => ({ ...s }));
  const afterRemove = withSources(items, fromParent, remaining);

  const targetSources = toSources(afterRemove[toParent]);
  const at = toSub == null ? targetSources.length : Math.max(0, Math.min(toSub, targetSources.length));
  targetSources.splice(at, 0, removed);
  return withSources(afterRemove, toParent, targetSources);
}

// 최상위 항목을 그룹 안으로 넣는다.
export function moveItemIntoGroup(items, fromIndex, toParent, toSub) {
  if (fromIndex === toParent || !items[fromIndex] || !items[toParent]) return items;

  const targetSources = toSources(items[toParent]);
  const movedSources = toSources(items[fromIndex]);
  const at = toSub == null ? targetSources.length : Math.max(0, Math.min(toSub, targetSources.length));
  targetSources.splice(at, 0, ...movedSources);

  const result = withSources(items, toParent, targetSources);
  result.splice(fromIndex, 1);
  return result;
}
