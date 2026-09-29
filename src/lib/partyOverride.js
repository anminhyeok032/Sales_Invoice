// 명세서 한 장에서만 쓰는 공급자/공급받는자 정보 수정.
//
// 거래처 목록이나 공급자 목록(원본)은 건드리지 않고, 원본과 달라진 칸만 따로 들고 있는다.
// 바꾼 칸만 들고 있어야, 나중에 원본의 다른 칸(예: 주소)을 고쳤을 때 그 명세서에도
// 반영된다. 전체를 복사해 두면 원본을 고쳐도 옛날 값에 묶여 버린다.

export function applyOverride(base, patch) {
  return patch && Object.keys(patch).length ? { ...base, ...patch } : base;
}

// 한 칸을 바꾼 결과. 원본과 같아지면 그 칸은 patch에서 빠진다(= 원본을 따른다).
export function setOverrideField(base, patch, key, value) {
  const next = { ...(patch || {}) };
  if ((base?.[key] ?? '') === value) delete next[key];
  else next[key] = value;
  return Object.keys(next).length ? next : undefined;
}

// 저장된 수정분 중 지금 출력하는 회사에 해당하는 것. 수정분은 회사 id별로 묶어 둔다
// ({ [id]: patch }) — 다른 회사로 바꿔 출력할 때 엉뚱한 회사 정보에 덮어쓰이지 않도록.
// 예전 형식(회사 구분 없이 patch 하나)도 그대로 읽는다.
const isLegacyPatch = (stored) => {
  const values = Object.values(stored || {});
  return values.length > 0 && values.every((v) => typeof v === 'string');
};

export function patchFor(stored, id) {
  if (!stored) return undefined;
  return isLegacyPatch(stored) ? stored : stored[id || ''];
}

// 회사 하나의 수정분을 바꾼 새 묶음. 예전 형식이 남아 있으면 버리고 새 형식으로 시작한다.
export function withPatch(stored, id, patch) {
  const base = stored && !isLegacyPatch(stored) ? stored : {};
  return { ...base, [id || '']: patch };
}
