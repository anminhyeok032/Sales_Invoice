import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownAZ, ArrowUpZA, Check } from 'lucide-react';
import { distinctValues } from '../lib/itemTableView';

const MARGIN = 8;      // 창 가장자리와 띄울 거리
const GAP = 4;         // 컬럼 제목과 띄울 거리
const COMFORT = 360;   // 위/아래 어느 쪽에도 다 안 들어갈 때, 이만큼은 있어야 그쪽으로 편다
                       // (모자라면 제목을 덮고 창 전체 높이를 쓴다 — 값 목록이 두세 줄로 쪼그라들지 않게)

// 엑셀 필터 단추를 눌렀을 때 나오는 창.
// 표는 가로 스크롤 되는 상자 안에 있어서 그 안에 그리면 잘린다. 그래서 화면 기준
// (position: fixed)으로 띄우고 컬럼 제목 위치에 맞춰 놓는다.
//
// 값이 많으면 창보다 길어질 수 있다. 실제 높이를 재서 아래에 자리가 있으면 아래로,
// 없으면 위로 펼치고, 어느 쪽도 모자라면 값 목록만 줄여서 스크롤되게 한다 —
// 정렬 단추와 적용/해제 단추는 항상 보인다.
function ColumnFilterMenu({ column, items, selected, anchorEl, onSort, onApply, onClose }) {
  const ref = useRef(null);
  const naturalHeight = useRef(0);
  const [pos, setPos] = useState(null);   // { top | bottom, left, maxHeight }
  const values = useMemo(
    () => distinctValues(items, column.key, column.numeric),
    [items, column.key, column.numeric]
  );
  // selected가 null이면 필터 없음 = 전부 체크된 상태로 시작한다.
  const [checked, setChecked] = useState(
    () => new Set(selected ?? values.map((v) => v.key))
  );
  const [query, setQuery] = useState('');

  const place = useCallback(() => {
    if (!anchorEl?.isConnected || !ref.current) return;
    const r = anchorEl.getBoundingClientRect();
    const vh = window.innerHeight;
    const below = vh - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const width = ref.current.offsetWidth;
    const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - width - MARGIN));
    const need = naturalHeight.current;

    const openBelow = () => setPos({ top: r.bottom + GAP, left, maxHeight: below });
    // 위로 펼칠 때는 아래쪽을 컬럼 제목에 붙인다(검색으로 목록이 줄어도 제목에서 떨어지지 않게).
    const openAbove = () => setPos({ bottom: vh - r.top + GAP, left, maxHeight: above });

    if (below >= need) openBelow();
    else if (above >= need) openAbove();
    else if (Math.max(below, above) >= COMFORT) (below >= above ? openBelow : openAbove)();
    else setPos({ top: MARGIN, left, maxHeight: vh - MARGIN * 2 });
  }, [anchorEl]);

  // 처음 한 번은 높이 제한 없이 그려서 원래 높이를 잰 뒤 자리를 잡는다.
  useLayoutEffect(() => {
    if (ref.current && !naturalHeight.current) naturalHeight.current = ref.current.offsetHeight;
    place();
  }, [place]);

  // 페이지를 스크롤하거나 창 크기를 바꾸면 컬럼 제목을 따라간다.
  // (창 안의 값 목록을 스크롤하는 것은 무시)
  useEffect(() => {
    const onScroll = (e) => { if (!ref.current?.contains(e.target)) place(); };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [place]);

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

  return (
    <div
      ref={ref}
      className="filter-menu"
      style={{
        position: 'fixed',
        top: pos?.top, bottom: pos?.bottom, left: pos?.left ?? MARGIN,
        maxHeight: pos?.maxHeight,
        // 자리를 잡기 전(높이를 재는 동안)에는 보이지 않게
        visibility: pos ? 'visible' : 'hidden',
        width: '254px', zIndex: 50, backgroundColor: '#fff',
        border: '1px solid var(--border-color)', borderRadius: '8px',
        boxShadow: '0 10px 20px rgba(0,0,0,0.12)', padding: '0.5rem',
        fontSize: '0.8125rem',
        display: 'flex', flexDirection: 'column',
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

      {/* 이 부분만 줄어들 수 있다(안의 값 목록이 스크롤). 위의 정렬 단추와 아래 단추는 고정. */}
      <div className="filter-menu__body">
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
        <div className="filter-menu__values">
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
