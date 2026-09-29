// 거래처 목록 정렬. 목록 자체의 순서는 건드리지 않고 보이는 순서만 바꾼다 —
// 목록 순서는 업체목록.xls에 저장할 때의 순서이기도 해서 보기 편하자고 바꾸면 안 된다.

// 등록한 시각(밀리초). 새 거래처는 추가할 때 createdAt을 남긴다. 그 기능 전에 추가한 것은 id가
// 추가한 시각(Date.now())이라 거기서 읽고, 엑셀·기존 프로그램에서 불러온 것처럼 알 수 없는 것은 0.
export function companyCreatedAt(company) {
  if (Number(company?.createdAt) > 0) return Number(company.createdAt);
  const idNum = Number(company?.id);
  return Number.isFinite(idNum) && idNum > 1e12 && idNum < 1e14 ? idNum : 0;
}

// key: 'name' | 'created' | '' (정렬 없음 = 목록 순서 그대로). dir: 'asc' | 'desc'.
// 안정 정렬이라 같은 값끼리는 목록 순서를 지킨다. 등록일을 모르는 거래처는 정렬 방향과 상관없이 맨 뒤.
export function sortCompanies(companies, key, dir = 'asc') {
  if (!key) return companies;
  const sign = dir === 'desc' ? -1 : 1;
  const nameOf = (c) => String(c.name || '').replace(/\s+/g, '');
  return companies
    .map((company, index) => ({ company, index }))
    .sort((a, b) => {
      if (key === 'name') {
        const na = nameOf(a.company), nb = nameOf(b.company);
        if (!na !== !nb) return na ? -1 : 1;            // 상호가 빈 거래처는 뒤로
        return sign * na.localeCompare(nb, 'ko') || a.index - b.index;
      }
      const ta = companyCreatedAt(a.company), tb = companyCreatedAt(b.company);
      if (!ta !== !tb) return ta ? -1 : 1;              // 등록일을 모르는 거래처는 뒤로
      return sign * (ta - tb) || a.index - b.index;
    })
    .map((r) => r.company);
}

export function formatCreatedDate(company) {
  const t = companyCreatedAt(company);
  if (!t) return '';
  const d = new Date(t);
  return `${String(d.getFullYear()).slice(2)}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}
