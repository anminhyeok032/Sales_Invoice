import { useState } from 'react';
import FitInput from './FitInput';

// 숫자 입력칸(수량·단가·공급가액·세액). 마이너스와 천 단위 쉼표를 받는다.
// 입력하는 동안에는 친 글자를 그대로 들고 있다 — '-'만 친 순간이나 '1.'처럼 아직 숫자가 덜 된 글자를
// 숫자로 바꿔 버리면 칸이 지워져서 마이너스·소수점을 칠 수가 없다. 값은 칠 때마다 숫자로 넘기고('-', ''는 0),
// 칸을 떠나면 저장된 값으로 다시 보인다.
//   decimal: 소수점 허용(수량)
//   grouping: 천 단위 쉼표로 보이기(금액)
function format(n, grouping) {
  if (!n) return '';
  return grouping ? n.toLocaleString(undefined, { maximumFractionDigits: 6 }) : String(n);
}

function NumberInput({ value, onValueChange, decimal = false, grouping = true, ...rest }) {
  const [draft, setDraft] = useState(null);
  const n = Number(value) || 0;

  const handleChange = (e) => {
    let text = e.target.value.replace(decimal ? /[^0-9.-]/g : /[^0-9-]/g, '');
    text = text.replace(/(?!^)-/g, '');                               // 마이너스는 맨 앞에만
    if (decimal) text = text.replace(/^(-?\d*\.?\d*).*$/, '$1');       // 소수점은 하나만
    setDraft(text);
    const num = Number(text);
    onValueChange(text === '' || text === '-' || text === '.' || text === '-.' || !Number.isFinite(num) ? 0 : num);
  };

  // 입력 중에도 금액은 쉼표를 붙여 보인다(친 글자 모양은 그대로: '-', 끝의 '.' 등).
  const shown = draft === null ? format(n, grouping) : (grouping ? groupDraft(draft) : draft);

  return (
    <FitInput
      {...rest}
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      value={shown}
      onChange={handleChange}
      onBlur={(e) => { setDraft(null); rest.onBlur?.(e); }}
    />
  );
}

function groupDraft(text) {
  const m = text.match(/^(-?)(\d*)(\.?\d*)$/);
  if (!m || !m[2]) return text;
  return `${m[1]}${Number(m[2]).toLocaleString()}${m[3]}`;
}

export default NumberInput;
