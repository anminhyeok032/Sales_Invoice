import useStore from '../store';

// 명세서를 출력할 때 공급자(우리 회사)로 누구를 찍을지 고르는 칸.
// value가 비어 있거나 지워진 공급자면 기본 공급자를 보여준다.
// compact: 공급자 칸 안에 들어가는 작은 모양(제목 없이 칸 폭에 맞춤).
function SupplierSelect({ value, onChange, compact = false }) {
  const suppliers = useStore((s) => s.suppliers);
  const defaultSupplierId = useStore((s) => s.defaultSupplierId);
  const current = suppliers.some((s) => s.id === value) ? value : defaultSupplierId;

  return (
    <div className="input-group" style={compact ? { marginBottom: '0.375rem' } : { width: '240px', marginBottom: 0 }}>
      {!compact && <label className="input-label">공급자 (우리 회사)</label>}
      <select className="input-field" value={current} onChange={(e) => onChange(e.target.value)}
        title="출력할 공급자(우리 회사) 고르기">
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name || '(이름 없음)'}{s.id === defaultSupplierId ? ' · 기본' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

export default SupplierSelect;
