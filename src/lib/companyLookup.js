// 가공일지 엑셀의 '업체' 칸은 거래처 목록의 상호와 거의 일치하지 않는다.
// 실제 2026년도 가공일지 기준 35곳 중 2곳만 글자까지 같았다. 엑셀에는 줄여 쓴 이름
// ('가나' → '(주)가나테크'), 띄어쓰기가 다른 이름, 오타('ABCD'/'ABD')가 섞여 있다.
// 그래서 이름을 정규화해서 비교하고, 비슷한 순서대로 후보를 내놓는다.

const EMPTY_RECEIVER = { regNo: '', president: '', address: '', businessType: '', businessItem: '' };

const CORP_MARKS = /주식회사|유한회사|합자회사|합명회사|\((주|유|합|사|재)\)/g;
const DELIMS = /[\s()[\]{}.,\-_·&'"/\\:;!?]+/;

// 법인 표기, 괄호, 띄어쓰기, 구두점을 걷어내고 소문자로.
export function normalizeCompanyName(name) {
  return tokenize(name).join('');
}

// 비교 단위. 구분자와 글자 종류(한글/영문/숫자)가 바뀌는 곳에서 끊는다.
// '케이제이몰드컴퍼니(KJ MOLD)' -> ['케이제이몰드컴퍼니', 'kj', 'mold']
function tokenize(name) {
  return String(name ?? '')
    .normalize('NFKC')                     // ㈜ -> (주), 전각 영숫자 -> 반각
    .replace(CORP_MARKS, ' ')
    .toLowerCase()
    .split(DELIMS)
    .flatMap((part) => part.match(/[가-힣ㄱ-ㅎㅏ-ㅣ]+|[a-z]+|[0-9]+/g) || []);
}

// 엑셀에는 영문으로, 거래처 목록에는 한글 발음으로 적힌 경우가 많다.
// 'ABC' -> '에이비씨', 'K2' -> '케이투'. 알파벳/숫자를 한 글자씩 읽는 소리로 바꾼다.
const LETTER = {
  a: '에이', b: '비', c: '씨', d: '디', e: '이', f: '에프', g: '지', h: '에이치', i: '아이',
  j: '제이', k: '케이', l: '엘', m: '엠', n: '엔', o: '오', p: '피', q: '큐', r: '알', s: '에스',
  t: '티', u: '유', v: '브이', w: '더블유', x: '엑스', y: '와이', z: '제트',
  0: '제로', 1: '원', 2: '투', 3: '쓰리', 4: '포', 5: '파이브', 6: '식스', 7: '세븐', 8: '에잇', 9: '나인',
};
function spellOut(tokens) {
  return tokens.map((t) => (/^[a-z0-9]+$/.test(t) ? [...t].map((ch) => LETTER[ch]).join('') : t));
}

function bigrams(s) {
  if (s.length < 2) return [s];
  const out = [];
  for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
  return out;
}

function dice(x, y) {
  const A = bigrams(x);
  const pool = bigrams(y);
  const total = A.length + pool.length;
  let hit = 0;
  A.forEach((g) => {
    const i = pool.indexOf(g);
    if (i >= 0) { hit += 1; pool.splice(i, 1); }
  });
  return (2 * hit) / total;
}

// 짧은 쪽이 긴 쪽의 "단어 시작"에서부터 들어맞는지. 단어 중간은 안 된다 —
// 그래야 'JM'이 'KJ MOLD'의 kjmold 한가운데에 걸리는 일이 없다.
function boundaryContainment(shortTokens, longTokens) {
  const q = shortTokens.join('');
  for (let i = 0; i < longTokens.length; i += 1) {
    const rest = longTokens.slice(i).join('');
    if (!rest.startsWith(q)) continue;
    // 단어를 통째로 덮으면('가나' = '가나 테크'의 '가나') 단어 앞부분만 걸친 것보다 조금 더 믿는다.
    let covered = 0;
    let wholeWords = false;
    for (let j = i; j < longTokens.length && covered < q.length; j += 1) {
      covered += longTokens[j].length;
      if (covered === q.length) wholeWords = true;
    }
    return { atStart: i === 0, wholeWords };
  }
  return null;
}

function tokenSimilarity(xt, yt) {
  const x = xt.join('');
  const y = yt.join('');
  if (!x || !y) return 0;
  if (x === y) return 1;

  const [st, lt] = x.length <= y.length ? [xt, yt] : [yt, xt];
  const hit = boundaryContainment(st, lt);
  if (hit) {
    const ratio = st.join('').length / lt.join('').length;
    return 0.6 + 0.25 * ratio + (hit.atStart ? 0.05 : 0) + (hit.wholeWords ? 0.05 : 0);
  }
  return 0.7 * dice(x, y);
}

// 두 이름이 얼마나 비슷한지 0~1. 순서: 완전 일치 > 단어 단위 포함 > 글자쌍 유사도.
// 영문은 한글 발음으로 바꿔서도 비교해 본다(조금 낮게 쳐 준다).
export function nameSimilarity(a, b) {
  const x = tokenize(a);
  const y = tokenize(b);
  const direct = tokenSimilarity(x, y);
  if (direct === 1) return 1;
  const spelled = Math.max(
    tokenSimilarity(spellOut(x), y),
    tokenSimilarity(x, spellOut(y)),
  ) * 0.95;
  return Math.max(direct, spelled);
}

// 비슷한 거래처 후보, 점수 높은 순.
export function suggestCompanies(companies, name, { min = 0.35, limit = 8 } = {}) {
  return companies
    .map((company) => ({ company, score: nameSimilarity(name, company.name) }))
    .filter((c) => c.score >= min)
    .sort((a, b) => b.score - a.score || a.company.name.length - b.company.name.length)
    .slice(0, limit);
}

// 이 점수 이상이면 자동으로 골라 준다(완전 일치, 포함 관계, 아주 비슷한 오타).
export const AUTO_MATCH_SCORE = 0.6;

// 엑셀 이름 하나로 공급받는자를 정한다.
//   1) 사용자가 예전에 직접 골라 둔 거래처(별칭) — 다음 달 엑셀에도 그대로 쓴다.
//   2) 없으면 이름 비교로 가장 비슷한 거래처(점수가 충분할 때만).
// 반환: { company | null, how: 'alias'|'exact'|'auto'|'none', ambiguous, suggestions }
export function matchReceiver(companies, name, aliases = {}) {
  const suggestions = suggestCompanies(companies, name);

  const aliasId = aliases[name];
  if (aliasId !== undefined) {
    // ''로 저장돼 있으면 "목록에 없는 회사"로 직접 정해 둔 것.
    const aliased = companies.find((c) => c.id === aliasId) || null;
    if (aliased || aliasId === '') return { company: aliased, how: 'alias', ambiguous: false, suggestions };
  }

  const exact = companies.find((c) => c.name === name);
  if (exact) return { company: exact, how: 'exact', ambiguous: false, suggestions };

  const [best, second] = suggestions;
  if (!best || best.score < AUTO_MATCH_SCORE) {
    return { company: null, how: 'none', ambiguous: false, suggestions };
  }
  // 자동으로 고를 만한 후보가 둘 이상이면('가나' -> 가나정밀 / 가나TECH) 사용자가 확인하게 한다.
  const ambiguous = Boolean(second && second.score >= AUTO_MATCH_SCORE);
  return { company: best.company, how: 'auto', ambiguous, suggestions };
}

// 인쇄용 공급받는자. 거래처를 못 찾으면 엑셀 이름만 채운 빈 양식.
export function receiverInfo(company, fallbackName) {
  return company || { id: '', name: fallbackName || '', ...EMPTY_RECEIVER };
}
