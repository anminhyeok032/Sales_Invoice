import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownAZ, ArrowUpZA, Check } from 'lucide-react';
import { distinctValues } from '../lib/itemTableView';

// 엑셀 필터 단추를 눌렀을 때 나오는 창.
// 표는 가로 스크롤 되는 상자 안에 있어서 그 안에 그리면 잘린다. 그래서 화면 기준
// (position: fixed)으로 띄우고 단추 위치에 맞춰 놓는다.
function ColumnFilterMenu({ column, items, selected, anchorRect, onSort, onApply, onClose }) {
  const ref = useRef(null);
  const values = useMemo(
    () => distinctValues(items, column.key, column.numeric),
    [items, column.key, column.numeric]
  );
  // selected가 null이면 필터 없음 = 전부 체크된 상태로 시작한다.
  const [checked, setChecked] = useState(
    () => new Set(selected ?? values.map((v) => v.key))
  );
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const shown = query
    ? values.filter((v) => v.label.toLowerCase().includes(query.toLowerCase()))
    : values;
  const allShownChecked = shown.length > 0 && shown.every((v) => checked.has(v.key));

  const toggle = (key) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const toggleAllShown = () => setChecked((prev) => {
    const next = new Set(prev);
    shown.forEach((v) => (allShownChecked ? next.delete(v.key) : next.add(v.key)));
    return next;
  });

  const apply = () => {
    // 전부 체크된 상태는 "필터 없음"과 같다.
    onApply(checked.size === values.length ? null : [...checked]);
    onClose();
  };

  const top = Math.min(anchorRect.bottom + 4, window.innerHeight - 340);
  const left = Math.min(anchorRect.left, window.innerWidth - 262);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', top: Math.max(8, top), left: Math.max(8, left),
        width: '254px', zIndex: 50, backgroundColor: '#fff',
        border: '1px solid var(--border-color)', borderRadius: '8px',
        boxShadow: '0 10px 20px rgba(0,0,0,0.12)', padding: '0.5rem',
        fontSize: '0.8125rem',
      }}
    >
      <button className="btn" style={{ width: '100%', justifyContent: 'flex-start', marginBottom: '0.25rem' }}
        onClick={() => { onSort('asc'); onClose(); }}>
        <ArrowDownAZ size={15} /> 오름차순 정렬
      </button>
      <button className="btn" style={{ width: '100%', justifyContent: 'flex-start' }}
        onClick={() => { onSort('desc'); onClose(); }}>
        <ArrowUpZA size={15} /> 내림차순 정렬
      </button>
      <p style={{ margin: '0.375rem 0 0.5rem', color: '#94a3b8', fontSize: '0.75rem', lineHeight: 1.4 }}>
        정렬은 항목 순서를 실제로 바꿉니다 (출력 순서도 같이 바뀜).
      </p>

      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem' }}>
        <input
          className="input-field"
          placeholder="값 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginBottom: '0.375rem' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.2rem 0.25rem', cursor: 'pointer', fontWeight: 600 }}>
          <input type="checkbox" checked={allShownChecked} onChange={toggleAllShown} />
          (모두 선택)
        </label>
        <div style={{ maxHeight: '160px', overflowY: 'auto', margin: '0.125rem 0' }}>
          {shown.length === 0 && (
            <p style={{ color: '#94a3b8', padding: '0.25rem' }}>일치하는 값이 없습니다.</p>
          )}
          {shown.map((v) => (
            <label key={v.key}
              style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.2rem 0.25rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={checked.has(v.key)} onChange={() => toggle(v.key)} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {v.label}
              </span>
              <span style={{ color: '#94a3b8' }}>{v.count}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.5rem' }}>
        <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={apply}>
          <Check size={15} /> 적용
        </button>
        <button className="btn" onClick={() => { onApply(null); onClose(); }}>필터 해제</button>
      </div>
    </div>
  );
}

export default ColumnFilterMenu;
