// 작성일자는 곳곳에서 형식이 다르다.
//   · 새 명세서 작성:            '2026/08/30'
//   · 기존 프로그램에서 가져온 것: '2026-08-31'
//   · 사용자가 직접 고친 것:      뭐든지 (출력용 작성일자는 그냥 텍스트 입력이다)
// 그래서 숫자만 뽑아 'YYYYMMDD' 한 가지로 맞춘 뒤 비교한다.

// 'YYYYMMDD' 문자열. 알아볼 수 없으면 빈 문자열.
export function toDateKey(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 6) return `20${digits}`;   // yy.mm.dd
  if (digits.length === 8) return digits;          // yyyy.mm.dd
  return '';
}

// 조회 조건이 비어 있거나 아직 덜 입력된 상태면 그 방향은 제한하지 않는다.
export function isWithinRange(value, fromKey, toKey) {
  if (!fromKey && !toKey) return true;
  const key = toDateKey(value);
  if (!key) return false;      // 날짜를 못 읽는 내역은 기간을 걸면 빠진다
  if (fromKey && key < fromKey) return false;
  if (toKey && key > toKey) return false;
  return true;
}
