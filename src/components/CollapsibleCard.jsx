import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

// 세로로 긴 화면에서는 목록과 편집 영역이 위아래로 쌓이기 때문에, 안 보고 있는
// 목록은 접어서 아래쪽 작업 공간을 확보할 수 있어야 한다.
//
// - title      : 제목. 이 줄 전체가 접기/펴기 버튼이다.
// - count      : 제목 옆에 흐리게 붙는 건수 등의 부가 정보.
// - actions    : 제목 줄 오른쪽 버튼들. 접어도 계속 보인다.
// - subheader  : 접어도 계속 보여야 하는 내용 (예: 엑셀 연동 상태 바).
// - children   : 접으면 숨는 본문.
function CollapsibleCard({
  title, count, actions, subheader, children,
  defaultOpen = true, style, bodyStyle,
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card" style={style}>
      <div
        className="card-title"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '0.75rem', flexWrap: 'wrap',
          // 접혀 있으면 제목만 남으므로 아래 여백과 구분선을 없앤다.
          marginBottom: open || subheader ? undefined : 0,
          paddingBottom: open || subheader ? undefined : 0,
          borderBottom: open || subheader ? undefined : 'none',
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={open ? '접기' : '펼치기'}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.375rem',
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            font: 'inherit', color: 'inherit', textAlign: 'left',
          }}
        >
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <span>{title}</span>
          {count != null && (
            <span style={{ fontSize: '0.875rem', fontWeight: 400, color: '#64748b' }}>{count}</span>
          )}
        </button>
        {actions && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>{actions}</div>
        )}
      </div>
      {subheader}
      {open && <div style={bodyStyle}>{children}</div>}
    </div>
  );
}

export default CollapsibleCard;
