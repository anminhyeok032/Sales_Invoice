import React, { useState } from 'react';
import { ChevronDown, ChevronRight, GripVertical, Trash2, Unlink, Filter, ListFilter } from 'lucide-react';
import { useDragReorder } from '../hooks/useDragReorder';
import ColumnFilterMenu from './ColumnFilterMenu';
import { ITEM_COLUMNS, filterItems, isFilterActive, sortItemsBy } from '../lib/itemTableView';
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

// 헤더에 정렬/필터 단추가 붙어서 좁은 칸은 폭을 조금 더 준다.
const COL_WIDTH = {
  newOrMod: '104px', unit: '78px', qty: '92px',
  processingTime: '98px', price: '126px', supply: '132px',
};
const COL_CLASS = { name: 'col-name', spec: 'col-spec' };

function TransactionItemsTable({ items, onItemChange, onItemsChange, onDeleteItem, dateColWidth = '80px' }) {
  // 펼침 상태는 인덱스가 아니라 mergeId로 잡는다. 순서변경/빼내기로 인덱스는 계속 바뀐다.
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());

  // 컬럼별 필터: { [컬럼키]: 체크된 값들 }. 값이 없으면 그 컬럼은 필터 없음.
  const [filters, setFilters] = useState({});
  const [menu, setMenu] = useState(null);   // { key, rect }

  const filtered = isFilterActive(filters);
  const visibleRows = filterItems(items, filters);

  const setColumnFilter = (key, selected) => setFilters((prev) => {
    const next = { ...prev };
    if (selected === null) delete next[key];
    else next[key] = selected;
    return next;
  });

  const openMenu = (key, e) =>
    setMenu({ key, rect: e.currentTarget.getBoundingClientRect() });

  const toggleExpand = (mergeId) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(mergeId)) next.delete(mergeId);
      else next.add(mergeId);
      return next;
    });
  };

  const handleDrop = (source, target) => {
    // 필터가 걸려 있으면 화면에 없는 줄이 섞여 있어서 "몇 번째 앞으로"가
    // 무슨 뜻인지 정해지지 않는다. 순서변경/합치기는 필터를 푼 뒤에.
    if (filtered) return;
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
    // 합쳐진 원본 줄은 input이 아니라 글자를 그대로 그린다. 표 전체가 nowrap이라
    // 칸보다 긴 값은 옆 칸을 침범할 수 있으므로 잘라서 표시한다.
    // 합쳐진 원본 줄은 input이 아니라 글자를 그대로 그린다. 표 전체가 nowrap이라
    // 칸보다 긴 값이 옆 칸을 침범하지 않도록 넘치는 부분은 잘라둔다.
    const cell = {
      padding: '0.25rem 0.4rem', color: '#475569', fontSize: '0.8125rem',
      overflow: 'hidden',
    };

    return item.mergedFrom.map((source, subIndex) => {
      const handleKey = `s:${parentIndex}:${subIndex}`;
      const targeted = isTarget('sub', parentIndex, subIndex);

      return (
        <tr
          key={`${item.mergeId}-src-${subIndex}`}
          draggable={!filtered && activeHandleKey === handleKey}
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

  const menuColumn = menu && ITEM_COLUMNS.find((c) => c.key === menu.key);

  return (
    <div>
      {filtered && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
          margin: '0 0 0.5rem', padding: '0.4rem 0.6rem', borderRadius: '6px',
          backgroundColor: '#eff6ff', border: '1px solid #bfdbfe',
          fontSize: '0.8125rem', color: '#1d4ed8',
        }}>
          <Filter size={14} />
          <span>
            {items.length}줄 중 <strong>{visibleRows.length}줄</strong>만 보는 중입니다.
            숨긴 줄도 저장과 출력에는 그대로 나갑니다. (필터 중에는 순서변경/합치기 불가)
          </span>
          <button className="btn" style={{ padding: '0.1rem 0.5rem', fontSize: '0.8125rem' }}
            onClick={() => setFilters({})}>
            전체 필터 해제
          </button>
        </div>
      )}
      <div className="data-table-container">
      <table className="data-table data-table--compact">
        <thead>
          <tr>
            <th style={{ width: '60px' }}>이동</th>
            {ITEM_COLUMNS.map((col) => {
              const on = Array.isArray(filters[col.key]);
              return (
                <th
                  key={col.key}
                  className={COL_CLASS[col.key]}
                  style={col.key === 'date'
                    // 헤더에 필터 단추가 붙어서 호출부가 넘긴 폭이 좁으면 날짜가 잘린다.
                    ? { width: dateColWidth, minWidth: '104px' }
                    : COL_WIDTH[col.key] && { width: COL_WIDTH[col.key] }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '2px' }}>
                    <span>
                      {col.label.map((line, i) => (
                        <React.Fragment key={line}>{i > 0 && <br />}{line}</React.Fragment>
                      ))}
                    </span>
                    <button
                      className="btn"
                      title={`${col.label.join(' ')} 정렬 / 필터`}
                      onClick={(e) => openMenu(col.key, e)}
                      style={{
                        flexShrink: 0, padding: '2px', border: 'none', lineHeight: 0,
                        background: on ? '#dbeafe' : 'none', color: on ? '#1d4ed8' : '#94a3b8',
                      }}
                    >
                      {on ? <Filter size={13} /> : <ListFilter size={13} />}
                    </button>
                  </div>
                </th>
              );
            })}
            <th style={{ width: '64px' }}>삭제</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(({ item, index }) => {
            const merged = isMergedItem(item);
            const expanded = merged && expandedGroups.has(item.mergeId);
            const handleKey = `t:${index}`;

            return (
              <React.Fragment key={item.mergeId || index}>
                <tr
                  draggable={!filtered && activeHandleKey === handleKey}
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
                    title={filtered
                      ? '필터가 걸려 있는 동안에는 순서변경/합치기를 할 수 없습니다'
                      : '드래그: 순서변경 / 다른 행의 이 칸에 놓으면 합치기'}
                    style={{
                      textAlign: 'center',
                      color: filtered ? '#cbd5e1' : '#94a3b8',
                      cursor: filtered ? 'not-allowed' : 'grab',
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
                  <td><input className="input-field" value={item.date} onChange={e => onItemChange(index, 'date', e.target.value)} /></td>
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
                      <input className="input-field" value={item.name} onChange={e => onItemChange(index, 'name', e.target.value)} />
                    </div>
                  </td>
                  <td><input className="input-field" value={item.newOrMod || ''} onChange={e => onItemChange(index, 'newOrMod', e.target.value)} /></td>
                  <td><input className="input-field" value={item.unit} onChange={e => onItemChange(index, 'unit', e.target.value)} /></td>
                  <td><input className="input-field" type="number" value={item.qty} onChange={e => onItemChange(index, 'qty', e.target.value)} /></td>
                  <td><input className="input-field" value={item.processingTime || ''} onChange={e => onItemChange(index, 'processingTime', e.target.value)} /></td>
                  <td><input className="input-field" value={item.spec} onChange={e => onItemChange(index, 'spec', e.target.value)} /></td>
                  <td>
                    <input
                      className="input-field"
                      style={{ borderColor: '#3b82f6', textAlign: 'right' }}
                      type="text"
                      placeholder="단가"
                      value={item.price ? Number(item.price).toLocaleString() : ''}
                      onChange={e => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        onItemChange(index, 'price', raw ? Number(raw) : 0);
                      }}
                    />
                  </td>
                  <td style={{ textAlign: 'right', paddingRight: '0.5rem', fontWeight: '500' }}>{Number(item.supply).toLocaleString()}</td>
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
          <div>각 컬럼 제목의 <strong>필터 단추</strong>로 <strong>오름차순 정렬</strong>하거나, 값을 체크해서 <strong>그 값만 골라 볼</strong> 수 있습니다. 정렬은 항목 순서를 실제로 바꾸고(출력 순서도 바뀜), 필터는 보기에서만 숨깁니다.</div>
          <div><strong>이동</strong> 칸을 잡고 드래그 → 다른 행 <strong>본문</strong>에 놓으면 순서변경, 다른 행의 <strong>이동 칸</strong>에 놓으면 합치기</div>
          <div>합쳐진 행은 <strong>▶</strong>로 펼쳐서 원본을 볼 수 있고, 원본도 드래그해서 <strong>그룹 안 순서변경</strong>이나 <strong>그룹 밖으로 빼내기</strong>가 됩니다. 원본이 1개만 남으면 병합이 자동으로 풀립니다.</div>
          <div>출력(PDF)에는 합쳐진 대표 행만 나가고 원본은 반영되지 않습니다.</div>
        </div>
      )}
      </div>

      {menuColumn && (
        <ColumnFilterMenu
          key={menuColumn.key}
          column={menuColumn}
          items={items}
          selected={filters[menuColumn.key] ?? null}
          anchorRect={menu.rect}
          onSort={(dir) => onItemsChange(sortItemsBy(items, menuColumn.key, dir))}
          onApply={(selected) => setColumnFilter(menuColumn.key, selected)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

export default TransactionItemsTable;
