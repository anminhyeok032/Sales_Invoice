import useStore from '../store';

// 명세서를 출력할 때 공급자(우리 회사)로 누구를 찍을지 고르는 칸.
// value가 비어 있거나 지워진 공급자면 기본 공급자를 보여준다.
function SupplierSelect({ value, onChange }) {
  const suppliers = useStore((s) => s.suppliers);
  const defaultSupplierId = useStore((s) => s.defaultSupplierId);
  const current = suppliers.some((s) => s.id === value) ? value : defaultSupplierId;

  return (
    <div className="input-group" style={{ width: '240px', marginBottom: 0 }}>
      <label className="input-label">공급자 (우리 회사)</label>
      <select className="input-field" value={current} onChange={(e) => onChange(e.target.value)}>
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
