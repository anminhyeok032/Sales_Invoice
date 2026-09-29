import { RotateCcw } from 'lucide-react';
import CollapsibleCard from './CollapsibleCard';
import SupplierSelect from './SupplierSelect';
import ReceiverSelect from './ReceiverSelect';
import { setOverrideField } from '../lib/partyOverride';

// 기존 프로그램 화면처럼 공급자(왼쪽, 빨강) / 공급받는자(오른쪽, 파랑)를 한 줄에 나란히.
// 칸 배치도 그 화면을 따른다:  No / 상호·대표 / 주소 / 업태·업종
const ROWS = [
  [{ key: 'regNo', label: 'No' }],
  [{ key: 'name', label: '상호' }, { key: 'president', label: '대표' }],
  [{ key: 'address', label: '주소' }],
  [{ key: 'businessType', label: '업태' }, { key: 'businessItem', label: '업종' }],
];

function PartyPanel({ side, base, patch, onPatch, readOnly, selector, stamp }) {
  const edited = patch ? Object.keys(patch).length : 0;

  const field = (f) => {
    const isEdited = Boolean(patch && f.key in patch);
    return (
      <input
        className={`input-field${isEdited ? ' party-edited' : ''}`}
        readOnly={readOnly}
        title={isEdited ? `이 명세서에서만 고친 값 (원래: ${base?.[f.key] || '비어 있음'})` : (base?.[f.key] || undefined)}
        value={isEdited ? patch[f.key] : (base?.[f.key] ?? '')}
        onChange={readOnly ? undefined : (e) => onPatch(setOverrideField(base, patch, f.key, e.target.value))}
      />
    );
  };

  return (
    <div className={`party-panel party-panel--${side}`}>
      <div className="party-panel__head">
        <span className="party-panel__title">{side === 'supplier' ? '[공 급 자]' : '[공급받는자]'}</span>
        {stamp !== undefined && (
          <span className="party-panel__stamp" title="도장은 거래처 정보 관리에서 바꿉니다">
            {stamp ? <img src={stamp} alt="도장" /> : '인'}
          </span>
        )}
        {!readOnly && edited > 0 && (
          <button className="btn party-panel__reset" onClick={() => onPatch(undefined)}
            title="이 명세서에서만 고친 칸을 원래 값으로 되돌립니다">
            <RotateCcw size={12} /> 원래대로({edited})
          </button>
        )}
      </div>

      {selector}

      {ROWS.map((row) => (
        <div key={row[0].key} className={`party-row${row.length > 1 ? ' party-row--pair' : ''}`}>
          {row.flatMap((f) => [
            <label key={`${f.key}-l`} className="party-row__label">{f.label}</label>,
            <span key={f.key} className="party-row__field">{field(f)}</span>,
          ])}
        </div>
      ))}
    </div>
  );
}

// 공급자/공급받는자 두 칸. 자동 작성에서는 고칠 수 있고(readOnly=false),
// 저장된 내역에서는 보기만 한다(칸을 고치는 곳은 자동 작성뿐).
export function PartiesPanel({
  receiverBase, receiverPatch, onReceiverPatch,
  companies, excelName, receiverMatch, onReceiverChoose, onReceiverAuto,
  supplierBase, supplierPatch, onSupplierPatch, supplierId, onSupplierChange,
  readOnly = false,
}) {
  return (
    <div className="parties-grid">
      <PartyPanel
        side="supplier"
        base={supplierBase}
        patch={supplierPatch}
        onPatch={onSupplierPatch}
        readOnly={readOnly}
        stamp={supplierBase?.stamp || ''}
        selector={<SupplierSelect compact value={supplierId} onChange={onSupplierChange} />}
      />
      <PartyPanel
        side="receiver"
        base={receiverBase}
        patch={receiverPatch}
        onPatch={onReceiverPatch}
        readOnly={readOnly}
        selector={
          <ReceiverSelect
            compact
            companies={companies}
            excelName={excelName}
            match={receiverMatch}
            onChoose={onReceiverChoose}
            onAuto={onReceiverAuto}
          />
        }
      />
    </div>
  );
}

function StatementPartiesCard(props) {
  const edits = Object.keys(props.receiverPatch || {}).length + Object.keys(props.supplierPatch || {}).length;

  return (
    <CollapsibleCard
      title="공급자 / 공급받는자"
      count={edits > 0 ? `이 명세서에서만 ${edits}칸 수정됨` : null}
    >
      <PartiesPanel {...props} />
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#64748b' }}>
        <span className="party-edited" style={{ padding: '0 4px', borderRadius: '3px', border: '1px solid' }}>노란 칸</span>은
        이 명세서의 출력과 저장에만 쓰이고, 거래처·공급자 목록은 바뀌지 않습니다. 원본은 <strong>거래처 정보 관리</strong>에서 고쳐주세요.
      </p>
    </CollapsibleCard>
  );
}

export default StatementPartiesCard;
