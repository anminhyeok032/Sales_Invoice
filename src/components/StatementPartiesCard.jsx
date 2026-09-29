import { RotateCcw } from 'lucide-react';
import CollapsibleCard from './CollapsibleCard';
import SupplierSelect from './SupplierSelect';
import ReceiverSelect from './ReceiverSelect';
import { PARTY_FIELDS, setOverrideField } from '../lib/partyOverride';

const EDITED = { borderColor: '#f59e0b', backgroundColor: '#fffbeb' };

// 명세서 윗부분에 찍히는 공급받는자/공급자 정보를 보여주고, 이 명세서에서만 고칠 수 있게 한다.
// 여기서 고친 내용은 거래처 목록/공급자 목록에 저장되지 않는다.
function PartySection({ title, subtitle, base, patch, onPatch, extra }) {
  const edited = patch ? Object.keys(patch).length : 0;

  return (
    <section style={{ marginBottom: '1rem' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem',
      }}>
        <div>
          <strong style={{ fontSize: '1rem' }}>{title}</strong>
          {subtitle && <span style={{ marginLeft: '0.5rem', fontSize: '0.8125rem', color: '#64748b' }}>{subtitle}</span>}
        </div>
        {edited > 0 && (
          <button className="btn" style={{ padding: '0.25rem 0.625rem', fontSize: '0.8125rem' }}
            onClick={() => onPatch(undefined)}>
            <RotateCcw size={14} /> 원래대로 ({edited}칸 수정됨)
          </button>
        )}
      </div>

      {extra}

      <div className="grid-3">
        {PARTY_FIELDS.map((f) => {
          const isEdited = patch && f.key in patch;
          return (
            <div key={f.key} className={`input-group${f.wide ? ' span-2' : ''}`} style={{ marginBottom: '0.5rem' }}>
              <label className="input-label">
                {f.label}
                {isEdited && <span style={{ marginLeft: '0.375rem', color: '#b45309', fontWeight: 600 }}>· 이 명세서만</span>}
              </label>
              <input
                className="input-field"
                style={isEdited ? EDITED : undefined}
                title={isEdited ? `원래 값: ${base?.[f.key] || '(비어 있음)'}` : undefined}
                value={isEdited ? patch[f.key] : (base?.[f.key] ?? '')}
                onChange={(e) => onPatch(setOverrideField(base, patch, f.key, e.target.value))}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StatementPartiesCard({
  receiverBase, receiverPatch, onReceiverPatch,
  companies, excelName, receiverMatch, onReceiverChoose, onReceiverAuto,
  supplierBase, supplierPatch, onSupplierPatch, supplierId, onSupplierChange,
}) {
  const edits = Object.keys(receiverPatch || {}).length + Object.keys(supplierPatch || {}).length;

  return (
    <CollapsibleCard
      title="명세서 상단 정보"
      count={edits > 0 ? `이 명세서에서만 ${edits}칸 수정됨` : '원본 그대로'}
    >
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.8125rem', color: '#64748b' }}>
        여기서 고친 내용은 <strong>이 명세서의 출력과 저장에만</strong> 쓰이고, 거래처 목록·공급자 목록은 바뀌지 않습니다.
        원본을 고치려면 <strong>거래처 정보 관리</strong>에서 고쳐주세요.
      </p>

      <PartySection
        title="공급받는자"
        subtitle={receiverMatch.company ? receiverMatch.company.name : '거래처 목록에 없는 회사 — 필요한 칸을 채워주세요'}
        base={receiverBase}
        patch={receiverPatch}
        onPatch={onReceiverPatch}
        extra={
          <ReceiverSelect
            companies={companies}
            excelName={excelName}
            match={receiverMatch}
            onChoose={onReceiverChoose}
            onAuto={onReceiverAuto}
          />
        }
      />

      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
        <PartySection
          title="공급자"
          base={supplierBase}
          patch={supplierPatch}
          onPatch={onSupplierPatch}
          extra={
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <SupplierSelect value={supplierId} onChange={onSupplierChange} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '40px', height: '40px', border: '1px solid var(--border-color)', borderRadius: '6px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#f8fafc',
                }}>
                  {supplierBase?.stamp
                    ? <img src={supplierBase.stamp} alt="도장" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    : <span style={{ fontSize: '0.625rem', color: '#94a3b8' }}>없음</span>}
                </div>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>도장은 거래처 정보 관리에서 바꿉니다</span>
              </div>
            </div>
          }
        />
      </div>
    </CollapsibleCard>
  );
}

export default StatementPartiesCard;
