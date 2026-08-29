import React, { useState } from 'react';
import { ChevronDown, ChevronRight, GripVertical, Trash2, Unlink } from 'lucide-react';
import { useDragReorder } from '../hooks/useDragReorder';
import {
  reorderItems,
  mergeItems,
  unmergeItem,
  isMergedItem,
  reorderGroupSource,
  extractGroupSource,
  moveSourceToGroup,
  moveItemIntoGroup,
} from '../lib/transactionItems';

const HIGHLIGHT = '#bfdbfe';

function TransactionItemsTable({ items, onItemChange, onItemsChange, onDeleteItem, dateColWidth = '80px' }) {
  // 펼침 상태는 인덱스가 아니라 mergeId로 잡는다. 순서변경/빼내기로 인덱스는 계속 바뀐다.
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());

  const toggleExpand = (mergeId) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(mergeId)) next.delete(mergeId);
      else next.add(mergeId);
      return next;
    });
  };

  const handleDrop = (source, target) => {
    const fromSub = source.p != null;

    if (target.kind === 'row') {
      if (fromSub) return onItemsChange(extractGroupSource(items, source.p, source.i, target.i));
      if (source.i === target.i) return;
      return onItemsChange(reorderItems(items, source.i, target.i));
    }

    if (target.kind === 'handle') {
      if (fromSub) {
        if (source.p === target.i) return;
        return onItemsChange(moveSourceToGroup(items, source.p, source.i, target.i, null));
      }
      if (source.i === target.i) return;
      return onItemsChange(mergeItems(items, [source.i, target.i]));
    }

    // target.kind === 'sub'
    if (!fromSub) {
      if (source.i === target.p) return;
      return onItemsChange(moveItemIntoGroup(items, source.i, target.p, target.i));
    }
    if (source.p === target.p) {
      return onItemsChange(reorderGroupSource(items, source.p, source.i, target.i));
    }
    return onItemsChange(moveSourceToGroup(items, source.p, source.i, target.p, target.i));
  };

  const {
    dragSource,
    dropTarget,
    activeHandleKey,
    setActiveHandleKey,
    startDrag,
    overTarget,
    leaveTarget,
    dropOnTarget,
    endDrag,
  } = useDragReorder(handleDrop);

  const isDragging = (p, i) => dragSource && dragSource.p === p && dragSource.i === i;
  const isTarget = (kind, p, i) =>
    dropTarget && dropTarget.kind === kind && dropTarget.p === p && dropTarget.i === i;

  const gripCellProps = (handleKey) => ({
    onMouseEnter: () => setActiveHandleKey(handleKey),
    onMouseLeave: () => setActiveHandleKey(null),
  });

  const renderSourceRows = (item, parentIndex) => {
    const cell = { padding: '0.25rem 0.4rem', color: '#475569', fontSize: '0.8125rem' };

    return item.mergedFrom.map((source, subIndex) => {
      const handleKey = `s:${parentIndex}:${subIndex}`;
      const targeted = isTarget('sub', parentIndex, subIndex);

      return (
        <tr
          key={`${item.mergeId}-src-${subIndex}`}
          draggable={activeHandleKey === handleKey}
          onDragStart={(e) => startDrag(e, { p: parentIndex, i: subIndex })}
          onDragEnd={endDrag}
          onDragOver={(e) => overTarget(e, { kind: 'sub', p: parentIndex, i: subIndex })}
          onDragLeave={leaveTarget}
          onDrop={(e) => dropOnTarget(e, { kind: 'sub', p: parentIndex, i: subIndex })}
          style={{
            backgroundColor: targeted ? HIGHLIGHT : '#f8fafc',
            opacity: isDragging(parentIndex, subIndex) ? 0.4 : 1,
          }}
        >
          <td
            {...gripCellProps(handleKey)}
            title="드래그: 그룹 안 순서변경 / 병합 밖 행에 놓으면 이 그룹에서 빠짐"
            style={{ textAlign: 'center', color: '#94a3b8', cursor: 'grab', paddingLeft: '0.75rem' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
              <span style={{ color: '#cbd5e1' }}>└</span>
              <GripVertical size={14} />
            </div>
          </td>
          <td style={cell}>{source.date}</td>
          <td style={cell}>{source.name}</td>
          <td style={cell}>{source.newOrMod || ''}</td>
          <td style={cell}>{source.unit}</td>
          <td style={cell}>{source.qty}</td>
          <td style={cell}>{source.processingTime || ''}</td>
          <td style={cell}>{source.spec}</td>
          <td style={{ ...cell, textAlign: 'right' }}>{source.price ? Number(source.price).toLocaleString() : ''}</td>
          <td style={{ ...cell, textAlign: 'right' }}>{Number(source.supply || 0).toLocaleString()}</td>
          <td />
        </tr>
      );
    });
  };

  return (
    <div className="data-table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: '68px' }}>이동</th>
            <th style={{ width: dateColWidth }}>날짜</th>
            <th>품목 (조합됨)</th>
            <th style={{ width: '90px' }}>구분<br />(신작/수정/자사불)</th>
            <th style={{ width: '70px' }}>단위</th>
            <th style={{ width: '80px' }}>수량</th>
            <th style={{ width: '80px' }}>가공시간<br />(확인용)</th>
            <th>규격 (비고)</th>
            <th style={{ width: '120px' }}>단가 (입력)</th>
            <th style={{ width: '120px' }}>공급가액</th>
            <th style={{ width: '76px' }}>삭제</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const merged = isMergedItem(item);
            const expanded = merged && expandedGroups.has(item.mergeId);
            const handleKey = `t:${index}`;

            return (
              <React.Fragment key={item.mergeId || index}>
                <tr
                  draggable={activeHandleKey === handleKey}
                  onDragStart={(e) => startDrag(e, { p: null, i: index })}
                  onDragEnd={endDrag}
                  onDragOver={(e) => overTarget(e, { kind: 'row', p: null, i: index })}
                  onDragLeave={leaveTarget}
                  onDrop={(e) => dropOnTarget(e, { kind: 'row', p: null, i: index })}
                  style={{
                    opacity: isDragging(null, index) ? 0.5 : 1,
                    transition: 'background-color 0.2s',
                    backgroundColor: isTarget('row', null, index)
                      ? HIGHLIGHT
                      : merged ? '#eff6ff' : undefined,
                    borderBottom: '1px solid var(--border-color)',
                  }}
                >
                  <td
                    {...gripCellProps(handleKey)}
                    title="드래그: 순서변경 / 다른 행의 이 칸에 놓으면 합치기"
                    style={{
                      textAlign: 'center',
                      color: '#94a3b8',
                      cursor: 'grab',
                      backgroundColor: isTarget('handle', null, index) ? HIGHLIGHT : undefined,
                      outline: isTarget('handle', null, index) ? '2px dashed #2563eb' : 'none',
                    }}
                    onDragOver={(e) => overTarget(e, { kind: 'handle', p: null, i: index }, 'copy')}
                    onDragLeave={leaveTarget}
                    onDrop={(e) => dropOnTarget(e, { kind: 'handle', p: null, i: index })}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
                      {merged ? (
                        <button
                          className="btn"
                          title={expanded ? '합쳐진 원본 접기' : '합쳐진 원본 펼치기'}
                          style={{ padding: 0, border: 'none', background: 'none', color: '#2563eb', lineHeight: 0 }}
                          onClick={() => toggleExpand(item.mergeId)}
                        >
                          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      ) : (
                        <span style={{ width: '16px' }} />
                      )}
                      <GripVertical size={18} />
                    </div>
                  </td>
                  <td><input className="input-field" style={{ padding: '0.25rem' }} value={item.date} onChange={e => onItemChange(index, 'date', e.target.value)} /></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {merged && (
                        <span style={{
                          flexShrink: 0, fontSize: '0.6875rem', fontWeight: 600, color: '#1d4ed8',
                          backgroundColor: '#dbeafe', border: '1px solid #93c5fd', borderRadius: '4px', padding: '1px 5px',
                        }}>
                          합침 {item.mergedFrom.length}
                        </span>
                      )}
                      <input className="input-field" style={{ padding: '0.25rem' }} value={item.name} onChange={e => onItemChange(index, 'name', e.target.value)} />
                    </div>
                  </td>
                  <td><input className="input-field" style={{ padding: '0.25rem' }} value={item.newOrMod || ''} onChange={e => onItemChange(index, 'newOrMod', e.target.value)} /></td>
                  <td><input className="input-field" style={{ padding: '0.25rem' }} value={item.unit} onChange={e => onItemChange(index, 'unit', e.target.value)} /></td>
                  <td><input className="input-field" style={{ padding: '0.25rem' }} type="number" value={item.qty} onChange={e => onItemChange(index, 'qty', e.target.value)} /></td>
                  <td><input className="input-field" style={{ padding: '0.25rem' }} value={item.processingTime || ''} onChange={e => onItemChange(index, 'processingTime', e.target.value)} /></td>
                  <td><input className="input-field" style={{ padding: '0.25rem' }} value={item.spec} onChange={e => onItemChange(index, 'spec', e.target.value)} /></td>
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
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {merged && (
                      <button
                        className="btn"
                        title="합치기 해제"
                        style={{ padding: '0.25rem', color: '#2563eb', border: 'none' }}
                        onClick={() => onItemsChange(unmergeItem(items, index))}
                      >
                        <Unlink size={16} />
                      </button>
                    )}
                    <button className="btn" style={{ padding: '0.25rem', color: 'red', border: 'none' }} onClick={() => onDeleteItem(index)}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
                {expanded && renderSourceRows(item, index)}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {items.length > 0 && (
        <div style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem', color: '#64748b', lineHeight: 1.7 }}>
          <div><strong>이동</strong> 칸을 잡고 드래그 → 다른 행 <strong>본문</strong>에 놓으면 순서변경, 다른 행의 <strong>이동 칸</strong>에 놓으면 합치기</div>
          <div>합쳐진 행은 <strong>▶</strong>로 펼쳐서 원본을 볼 수 있고, 원본도 드래그해서 <strong>그룹 안 순서변경</strong>이나 <strong>그룹 밖으로 빼내기</strong>가 됩니다. 원본이 1개만 남으면 병합이 자동으로 풀립니다.</div>
          <div>출력(PDF)에는 합쳐진 대표 행만 나가고 원본은 반영되지 않습니다.</div>
        </div>
      )}
    </div>
  );
}

export default TransactionItemsTable;
