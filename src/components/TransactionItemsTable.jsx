import React, { useState } from 'react';
import { ChevronDown, ChevronRight, GripVertical, Trash2, Unlink, Filter } from 'lucide-react';
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
  computeTotals,
  clearTaxes,
  PRINT_ROWS_PER_PAGE,
} from '../lib/transactionItems';

const HIGHLIGHT = '#bfdbfe';

// 세로 화면(폭 약 700px)에서도 가로 스크롤 없이 한 화면에 다 들어가게 짠 폭.
// 짧은 값만 들어가는 칸(구분은 거의 '신작'/'수정', 수량은 한두 자리, 가공시간은 H:MM)은
// 좁게 고정하고, 남는 폭은 품목과 규격이 나눠 갖는다.
// 실제 기존 품목 전체를 재어 본 기준으로 필요한 칸 폭: 품목은 중간값 124px / 99% 198px,
// 규격은 대부분 비어 있고 99%가 106px. 그래서 규격은 16%(태블릿 세로 약 110px)만 주고
// 나머지를 모두 품목에 준다 — 기존 프로그램 화면도 품명이 가장 넓다.
const COL_WIDTH = {
  newOrMod: '44px', qty: '44px', processingTime: '50px',
  spec: '16%', price: '66px', supply: '72px', tax: '62px',
};

function TransactionItemsTable({ items, onItemChange, onItemsChange, onDeleteItem, dateColWidth = '80px' }) {
  // 펼침 상태는 인덱스가 아니라 mergeId로 잡는다. 순서변경/빼내기로 인덱스는 계속 바뀐다.
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());

  // 컬럼별 필터: { [컬럼키]: 체크된 값들 }. 값이 없으면 그 컬럼은 필터 없음.
  const [filters, setFilters] = useState({});
  const [menu, setMenu] = useState(null);   // { key, rect }

  // 세액 칸은 평소 숨긴다(거의 안 쓴다). 사용자가 "입력"을 눌렀거나, 이미 세액이 든 줄이
  // 있으면 보인다 — 값이 있는데 칸이 안 보여서 모르고 인쇄하는 일이 없도록.
  const [showTax, setShowTax] = useState(false);
  const hasTax = items.some((item) => Number(item.tax));
  const taxVisible = showTax || hasTax;
  const columns = ITEM_COLUMNS.filter((c) => !c.optional || taxVisible);

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
            style={{ textAlign: 'center', color: '#94a3b8', cursor: 'grab' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
              <span style={{ color: '#cbd5e1' }}>└</span>
              <GripVertical size={12} />
            </div>
          </td>
          <td style={cell}>{source.date}</td>
          <td style={cell}>{source.name}</td>
          <td style={cell}>{source.spec}</td>
          <td style={cell}>{source.newOrMod || ''}</td>
          <td style={cell}>{source.qty}</td>
          <td style={cell}>{source.processingTime || ''}</td>
          <td style={{ ...cell, textAlign: 'right' }}>{source.price ? Number(source.price).toLocaleString() : ''}</td>
          <td style={{ ...cell, textAlign: 'right' }}>{Number(source.supply || 0).toLocaleString()}</td>
          {taxVisible && <td style={{ ...cell, textAlign: 'right' }}>{source.tax ? Number(source.tax).toLocaleString() : ''}</td>}
          <td />
        </tr>
      );
    });
  };

  const menuColumn = menu && ITEM_COLUMNS.find((c) => c.key === menu.key);
  // 합계는 필터와 상관없이 명세서 전체 기준 — 숨긴 줄도 인쇄에는 나가기 때문.
  const totals = computeTotals(items);
  const printPages = Math.ceil(items.length / PRINT_ROWS_PER_PAGE);
  const won = (n) => `₩${n.toLocaleString()}`;

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
            <th style={{ width: '32px' }} title="이동">이동</th>
            {columns.map((col) => {
              const on = Array.isArray(filters[col.key]);
              return (
                <th
                  key={col.key}
                  style={{ width: col.key === 'date' ? dateColWidth : COL_WIDTH[col.key] }}
                >
                  {/* 좁은 칸에 따로 단추를 둘 자리가 없어서, 제목 자체를 누르면 엑셀처럼
                      정렬/필터 창이 열린다. */}
                  <button
                    type="button"
                    className="th-filter"
                    title={`${col.hint || col.label.join('')} — 눌러서 정렬 / 필터`}
                    onClick={(e) => openMenu(col.key, e)}
                    style={on ? { backgroundColor: '#dbeafe', color: '#1d4ed8' } : undefined}
                  >
                    <span>
                      {col.label.map((line, i) => (
                        <React.Fragment key={line}>{i > 0 && <br />}{line}</React.Fragment>
                      ))}
                    </span>
                    {on ? <Filter size={10} /> : <ChevronDown size={10} />}
                  </button>
                </th>
              );
            })}
            <th style={{ width: '36px' }} title="삭제">삭제</th>
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
                          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </button>
                      ) : null}
                      <GripVertical size={14} />
                    </div>
                  </td>
                  <td><input className="input-field" value={item.date} onChange={e => onItemChange(index, 'date', e.target.value)} /></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {merged && (
                        <span style={{
                          flexShrink: 0, fontSize: '0.625rem', fontWeight: 600, color: '#1d4ed8',
                          backgroundColor: '#dbeafe', border: '1px solid #93c5fd', borderRadius: '4px', padding: '0 3px',
                        }} title={`${item.mergedFrom.length}줄을 합친 항목`}>
                          합침{item.mergedFrom.length}
                        </span>
                      )}
                      {/* 폭이 좁은 화면에서 긴 품목은 칸 안에서 잘린다 — 마우스를 올리면 전체가 보인다 */}
                      <input className="input-field" title={item.name} value={item.name} onChange={e => onItemChange(index, 'name', e.target.value)} />
                    </div>
                  </td>
                  <td><input className="input-field" title={item.spec} value={item.spec} onChange={e => onItemChange(index, 'spec', e.target.value)} /></td>
                  <td><input className="input-field" value={item.newOrMod || ''} onChange={e => onItemChange(index, 'newOrMod', e.target.value)} /></td>
                  <td><input className="input-field" type="number" value={item.qty} onChange={e => onItemChange(index, 'qty', e.target.value)} /></td>
                  <td><input className="input-field" value={item.processingTime || ''} onChange={e => onItemChange(index, 'processingTime', e.target.value)} /></td>
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
                  <td style={{ textAlign: 'right', fontWeight: '500' }}>{Number(item.supply).toLocaleString()}</td>
                  {taxVisible && (
                    <td>
                      <input
                        className="input-field"
                        style={{ textAlign: 'right' }}
                        type="text"
                        placeholder="-"
                        title="세액 (직접 입력)"
                        value={Number(item.tax) ? Number(item.tax).toLocaleString() : ''}
                        onChange={e => {
                          const raw = e.target.value.replace(/[^0-9]/g, '');
                          onItemChange(index, 'tax', raw ? Number(raw) : 0);
                        }}
                      />
                    </td>
                  )}
                  <td style={{ textAlign: 'center', padding: 0 }}>
                    {merged && (
                      <button
                        className="btn"
                        title="합치기 해제"
                        style={{ padding: '2px', color: '#2563eb', border: 'none', background: 'none' }}
                        onClick={() => onItemsChange(unmergeItem(items, index))}
                      >
                        <Unlink size={14} />
                      </button>
                    )}
                    <button className="btn" title="삭제" style={{ padding: '2px', color: 'red', border: 'none', background: 'none' }} onClick={() => onDeleteItem(index)}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
                {expanded && renderSourceRows(item, index)}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="item-totals">
        <div className="item-totals__cell">
          <span className="item-totals__label">계</span>
          <span className="item-totals__value">{won(totals.supply)}</span>
        </div>
        <div className="item-totals__cell">
          <span className="item-totals__label">세 액</span>
          <span className="item-totals__value">{won(totals.tax)}</span>
          {!taxVisible && (
            <button className="btn item-totals__btn" onClick={() => setShowTax(true)}
              title="줄마다 세액을 직접 넣을 수 있는 칸을 엽니다">입력</button>
          )}
          {taxVisible && !hasTax && (
            <button className="btn item-totals__btn" onClick={() => {
              setShowTax(false);
              setColumnFilter('tax', null);
            }}>닫기</button>
          )}
          {hasTax && (
            <button className="btn item-totals__btn" onClick={() => {
              if (window.confirm('모든 줄의 세액을 0으로 지울까요?')) onItemsChange(clearTaxes(items));
            }} title="모든 줄의 세액을 0으로">모두 지우기</button>
          )}
        </div>
        <div className="item-totals__cell item-totals__cell--total">
          <span className="item-totals__label">합계금액</span>
          <span className="item-totals__value">{won(totals.total)}</span>
        </div>
      </div>
      {(printPages > 1 || filtered) && (
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#64748b', textAlign: 'right' }}>
          {filtered && '합계는 필터로 숨긴 줄까지 포함한 전체 기준입니다. '}
          {printPages > 1 && `${items.length}줄이라 ${printPages}장으로 출력되며, 인쇄물에는 장마다 그 장의 합계가 찍힙니다.`}
        </p>
      )}

      {items.length > 0 && (
        <div style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem', color: '#64748b', lineHeight: 1.7 }}>
          <div>각 <strong>컬럼 제목을 누르면</strong> <strong>오름차순 정렬</strong>하거나, 값을 체크해서 <strong>그 값만 골라 볼</strong> 수 있습니다. 정렬은 항목 순서를 실제로 바꾸고(출력 순서도 바뀜), 필터는 보기에서만 숨깁니다.</div>
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
