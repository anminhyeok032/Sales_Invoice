import { RotateCcw } from 'lucide-react';

// 공급받는자로 찍을 거래처를 고르는 칸.
// 엑셀 업체 이름과 거래처 목록 상호가 거의 일치하지 않아서, 이름이 비슷한 후보를 맨 위에
// 모아 보여주고 나머지 거래처는 그 아래에 둔다.
//
// match: companyLookup.matchReceiver()의 결과
// excelName: 엑셀(또는 저장된 명세서)에 적힌 이름
// onChoose(id): id는 거래처 id, ''는 "목록에 없는 회사로 처리"
// onAuto: 직접 고른 것을 풀고 자동 찾기로 되돌림 (없으면 버튼을 숨긴다)
function ReceiverSelect({ companies, excelName, match, onChoose, onAuto }) {
  const value = match.company?.id ?? '';
  const suggested = new Set(match.suggestions.map((s) => s.company.id));
  const others = companies
    .filter((c) => !suggested.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  const note = {
    exact: { color: '#16a34a', text: '거래처 목록에 같은 이름이 있습니다.' },
    alias: { color: '#16a34a', text: `직접 고른 거래처입니다. 다음에도 '${excelName}'은(는) 이 거래처로 찾습니다.` },
    saved: { color: '#16a34a', text: '이 명세서에 저장된 공급받는자입니다.' },
    auto: match.ambiguous
      ? { color: '#b45309', text: `'${excelName}'과(와) 비슷한 거래처가 여러 곳입니다. 맞는 곳인지 꼭 확인하세요.` }
      : { color: '#2563eb', text: `'${excelName}'과(와) 이름이 비슷한 거래처를 자동으로 골랐습니다. 다르면 바꿔주세요.` },
    none: { color: '#b45309', text: `'${excelName}'과(와) 비슷한 거래처를 찾지 못했습니다. 목록에서 고르거나 아래 칸을 직접 채워주세요.` },
  }[match.how];

  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div className="input-group" style={{ width: '320px', maxWidth: '100%', marginBottom: 0 }}>
          <label className="input-label">공급받는자 (거래처)</label>
          <select className="input-field" value={value} onChange={(e) => onChoose(e.target.value)}>
            <option value="">— 거래처 목록에 없는 회사로 처리 —</option>
            {match.suggestions.length > 0 && (
              <optgroup label="이름이 비슷한 거래처">
                {match.suggestions.map(({ company, score }) => (
                  <option key={company.id} value={company.id}>
                    {company.name} ({Math.round(score * 100)}%)
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="그 외 거래처">
              {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          </select>
        </div>
        {match.how === 'alias' && onAuto && (
          <button className="btn" style={{ padding: '0.4rem 0.625rem', fontSize: '0.8125rem' }} onClick={onAuto}>
            <RotateCcw size={14} /> 자동 찾기로 되돌리기
          </button>
        )}
      </div>
      {note && (
        <p style={{ margin: '0.375rem 0 0', fontSize: '0.8125rem', color: note.color }}>
          엑셀 이름 <strong>{excelName}</strong> · {note.text}
        </p>
      )}
    </div>
  );
}

export default ReceiverSelect;
