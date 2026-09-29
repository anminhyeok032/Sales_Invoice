/**
 * Manual QA checklist (no automated test runner in this repo):
 * 1. Load an unmodified 업체목록.xls and confirm companies list identically to before this change.
 * 2. Load an unmodified NC가공일지 workbook and confirm items/grouping identical to before.
 * 3. Reorder columns and/or rename headers to an accepted alias in each file type,
 *    re-import, and confirm the same rows/values now still parse correctly.
 * 4. Delete/blank the header row entirely (or push it past maxScanRows) and confirm
 *    both files fall back to today's hardcoded positions without crashing.
 */

function normalizeHeader(value) {
  if (value == null) return '';
  return String(value)
    .replace(/[\s.,/\\()-]+/g, '')
    .trim()
    .toUpperCase();
}

function mapColumns(headerRow, fieldDefs) {
  const map = {};
  (headerRow || []).forEach((cell, idx) => {
    const norm = normalizeHeader(cell);
    if (!norm) return;
    for (const field of fieldDefs) {
      if (map[field.key] !== undefined) continue;
      // aliases: 정리한 헤더가 정확히 같을 때. contains: 정리한 헤더에 이 글자가 들어 있을 때.
      // (정확히 같은 별칭만 받으면 '코어 및 전극(번호)'처럼 조금만 달라도 그 칸이 통째로 무시된다.)
      const exact = field.aliases.some((a) => normalizeHeader(a) === norm);
      const partial = (field.contains || []).some((c) => norm.includes(normalizeHeader(c)));
      if (exact || partial) {
        map[field.key] = idx;
      }
    }
  });
  return map;
}

function findHeaderRow(rows, fieldDefs, { maxScanRows = 10 } = {}) {
  const requiredKeys = fieldDefs.filter((f) => f.required).map((f) => f.key);
  let best = null;
  for (let i = 0; i < Math.min(maxScanRows, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    const columnMap = mapColumns(row, fieldDefs);
    const matchedKeys = Object.keys(columnMap);
    const hasAllRequired = requiredKeys.every((k) => matchedKeys.includes(k));
    if (hasAllRequired && matchedKeys.length > 0) {
      if (!best || matchedKeys.length > best.matchedCount) {
        best = { headerRowIndex: i, columnMap, matchedCount: matchedKeys.length };
      }
    }
  }
  return best;
}

export function resolveColumnMapping(rows, fieldDefs, {
  maxScanRows = 10,
  fallbackDataStartRow = 0,
} = {}) {
  const found = findHeaderRow(rows, fieldDefs, { maxScanRows });
  if (found) {
    return { columnMap: found.columnMap, dataStartRow: found.headerRowIndex + 1, matchedByHeader: true };
  }
  const fallbackMap = {};
  fieldDefs.forEach((f) => {
    if (f.fallbackIndex != null) fallbackMap[f.key] = f.fallbackIndex;
  });
  return { columnMap: fallbackMap, dataStartRow: fallbackDataStartRow, matchedByHeader: false };
}
