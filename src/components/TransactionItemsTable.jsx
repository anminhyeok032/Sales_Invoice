import { GripVertical, Trash2 } from 'lucide-react';
import { useDragReorder } from '../hooks/useDragReorder';
import { reorderItems } from '../lib/transactionItems';

function TransactionItemsTable({ items, onItemChange, onReorder, onDeleteItem, dateColWidth = '80px' }) {
  const {
    draggedItemIndex,
    activeDragHandleIndex,
    setActiveDragHandleIndex,
    handleDragStart,
    handleDragOver,
    handleDrop,
  } = useDragReorder((fromIndex, toIndex) => onReorder(reorderItems(items, fromIndex, toIndex)));

  return (
    <div className="data-table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: '40px' }}>이동</th>
            <th style={{ width: dateColWidth }}>날짜</th>
            <th>품목 (조합됨)</th>
            <th>규격 (비고)</th>
            <th style={{ width: '70px' }}>단위</th>
            <th style={{ width: '80px' }}>수량</th>
            <th style={{ width: '120px' }}>단가 (입력)</th>
            <th style={{ width: '120px' }}>공급가액</th>
            <th style={{ width: '50px' }}>삭제</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr
              key={index}
              draggable={activeDragHandleIndex === index}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
              style={{
                opacity: draggedItemIndex === index ? 0.5 : 1,
                transition: 'background-color 0.2s',
                borderBottom: draggedItemIndex !== null && draggedItemIndex !== index ? '2px solid transparent' : '1px solid var(--border-color)',
              }}
              onDragEnter={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
              onDragLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <td
                style={{ textAlign: 'center', color: '#94a3b8', cursor: 'grab' }}
                onMouseEnter={() => setActiveDragHandleIndex(index)}
                onMouseLeave={() => setActiveDragHandleIndex(null)}
              >
                <GripVertical size={18} style={{ margin: '0 auto' }} />
              </td>
              <td><input className="input-field" style={{ padding: '0.25rem' }} value={item.date} onChange={e => onItemChange(index, 'date', e.target.value)} /></td>
              <td><input className="input-field" style={{ padding: '0.25rem' }} value={item.name} onChange={e => onItemChange(index, 'name', e.target.value)} /></td>
              <td><input className="input-field" style={{ padding: '0.25rem' }} value={item.spec} onChange={e => onItemChange(index, 'spec', e.target.value)} /></td>
              <td><input className="input-field" style={{ padding: '0.25rem' }} value={item.unit} onChange={e => onItemChange(index, 'unit', e.target.value)} /></td>
              <td><input className="input-field" style={{ padding: '0.25rem' }} type="number" value={item.qty} onChange={e => onItemChange(index, 'qty', e.target.value)} /></td>
              <td>
                <input
                  className="input-field"
                  style={{ padding: '0.25rem', borderColor: '#3b82f6', textAlign: 'right' }}
                  type="text"
                  placeholder="단가"
                  value={item.price ? Number(item.price).toLocaleString() : ''}
                  onChange={e => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    onItemChange(index, 'price', raw ? Number(raw) : 0);
                  }}
                />
              </td>
              <td style={{ textAlign: 'right', paddingRight: '1rem', fontWeight: '500' }}>{Number(item.supply).toLocaleString()}</td>
              <td style={{ textAlign: 'center' }}>
                <button className="btn" style={{ padding: '0.25rem', color: 'red', border: 'none' }} onClick={() => onDeleteItem(index)}>
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default TransactionItemsTable;
