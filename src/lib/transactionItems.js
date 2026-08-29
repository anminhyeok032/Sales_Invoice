export function createEmptyItem() {
  return { date: '', name: '', spec: '', unit: 'EA', qty: 0, price: 0, supply: 0, tax: 0, note: '', newOrMod: '', processingTime: '' };
}

export function applyItemChange(items, index, field, value) {
  const newItems = [...items];
  newItems[index] = { ...newItems[index], [field]: value };

  if (field === 'price' || field === 'qty') {
    const q = Number(newItems[index].qty) || 0;
    const p = Number(newItems[index].price) || 0;
    newItems[index].supply = q * p;
    newItems[index].tax = Math.floor(newItems[index].supply * 0.1);
  }
  return newItems;
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
function dateSortKey(date) {
  const digits = String(date ?? '').replace(/\D/g, '');
  if (digits.length === 6) return `20${digits}`;
  if (digits.length === 8) return digits;
  return '';
}

let mergeSeq = 0;
// 펼침 상태를 인덱스가 아니라 그룹 자체에 묶어두기 위한 식별자.
// 인덱스는 순서변경/빼내기로 계속 바뀌기 때문에 키로 쓸 수 없다.
const nextMergeId = () => `m${Date.now().toString(36)}-${(mergeSeq++).toString(36)}`;

function stripMergeMeta(item) {
  const copy = { ...item };
  delete copy.mergedFrom;
  delete copy.mergeId;
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

// 대표 항목은 언제나 현재 원본 목록에서 파생된다. 원본이 바뀌면(순서변경/빼내기/추가)
// 반드시 다시 계산해야 '날짜=최신, 돈=합계, 수량=최대, 나머지=최상단' 기준이 유지된다.
function buildRepresentative(sources, mergeId) {
  const head = sources[0];
  const latest = sources.reduce((best, item) =>
    dateSortKey(item.date) > dateSortKey(best.date) ? item : best
  , head);

  return {
    ...stripMergeMeta(head),
    date: latest.date,
    qty: sources.reduce((max, item) => Math.max(max, Number(item.qty) || 0), 0),
    supply: sources.reduce((sum, item) => sum + (Number(item.supply) || 0), 0),
    tax: sources.reduce((sum, item) => sum + (Number(item.tax) || 0), 0),
    spec: mergeSpecs(sources),
    mergeId: mergeId || nextMergeId(),
    mergedFrom: sources.map((s) => ({ ...s })),
  };
}

// 원본이 1개만 남으면 병합이 풀려 원래의 일반 항목으로 되돌아간다.
function rebuildGroup(sources, mergeId) {
  if (sources.length === 0) return null;
  if (sources.length === 1) return stripMergeMeta(sources[0]);
  return buildRepresentative(sources, mergeId);
}

// 항목을 '원본 목록' 관점으로 편다. 합쳐진 항목이면 그 원본들, 아니면 자기 자신 1개.
function toSources(item) {
  return isMergedItem(item) ? item.mergedFrom.map((s) => ({ ...s })) : [stripMergeMeta(item)];
}

// 그룹의 원본 목록을 교체하고 대표 항목을 다시 계산한다.
// 남는 원본이 1개 이상이면 배열 길이가 유지되므로 다른 인덱스가 밀리지 않는다.
function withSources(items, parentIndex, nextSources) {
  const rebuilt = rebuildGroup(nextSources, items[parentIndex]?.mergeId);
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
  const merged = buildRepresentative(sources, keptId);

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
