import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, GripVertical, Trash2, Unlink, Filter, Plus } from 'lucide-react';
import { useDragReorder } from '../hooks/useDragReorder';
import ColumnFilterMenu from './ColumnFilterMenu';
import { ITEM_COLUMNS, filterItems, isFilterActive, sortItemsBy, applyToVisible, createItemForFilters } from '../lib/itemTableView';
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
  insertItemAt,
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
  no: '30px',        // 현재 목록에서 몇 번째 줄인지
  actions: '46px',   // 줄 넣기(+) · 삭제(휴지통) · (합쳐진 줄이면) 합치기 해제
};

// filters/onFiltersChange: 컬럼 필터 상태. 부모가 들고 있다(useItemFilters) — 출력이 지금 보이는
// 줄만 찍어야 해서 부모도 같은 필터를 알아야 한다.
function TransactionItemsTable({
  items, onItemChange, onItemsChange, onDeleteItem, dateColWidth = '80px',
  filters, onFiltersChange,
}) {
  // 펼침 상태는 인덱스가 아니라 mergeId로 잡는다. 순서변경/빼내기로 인덱스는 계속 바뀐다.
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());

  // 컬럼별 필터: { [컬럼키]: 체크된 값들 }. 값이 없으면 그 컬럼은 필터 없음.
  const [menu, setMenu] = useState(null);   // { key, anchor: 컬럼 제목 요소 }

  // 세액 칸은 평소 숨긴다(거의 안 쓴다). 사용자가 "입력"을 눌렀거나, 이미 세액이 든 줄이
  // 있으면 보인다 — 값이 있는데 칸이 안 보여서 모르고 인쇄하는 일이 없도록.
  const [showTax, setShowTax] = useState(false);
  const hasTax = items.some((item) => Number(item.tax));
  const taxVisible = showTax || hasTax;
  const columns = ITEM_COLUMNS.filter((c) => !c.optional || taxVisible);

  const filtered = isFilterActive(filters);
  const visibleRows = filterItems(items, filters);

  // 필터를 걸어도 순서변경/합치기/빼내기/정렬은 그대로 된다. 보이는 줄만 모아서 그 안에서 바꾸고,
  // 숨긴 줄은 제자리에 둔다(applyToVisible). 끌기의 위치 번호(p, i)는 전체 목록이 아니라
  // "보이는 줄 안에서의 순서"다. 필터가 없으면 보이는 줄이 곧 전체라서 예전과 똑같다.
  const visibleIndexes = visibleRows.map((r) => r.index);
  const applyToView = (transform) => onItemsChange(applyToVisible(items, visibleIndexes, transform));

  const setColumnFilter = (key, selected) => onFiltersChange((prev) => {
    const next = { ...prev };
    if (selected === null) delete next[key];
    else next[key] = selected;
    return next;
  });

  // 위치 대신 제목 요소를 넘겨서, 창이 스크롤/크기 변경을 따라 자리를 다시 잡게 한다.
  const openMenu = (key, e) => setMenu({ key, anchor: e.currentTarget });

  // 줄 끼워 넣기: 새 빈 줄이 들어갈 자리(index)를 받아서 넣고, 곧바로 그 줄의 품목 칸에 커서를 둔다.
  // 줄은 index 순서로 그려지므로(key) 새 줄의 입력칸은 새로 생기지 않고 기존 칸이 재사용된다 —
  // autoFocus로는 안 되고, 아이템이 바뀐 뒤에 직접 찾아서 포커스를 준다.
  // 필터가 걸려 있으면 새 줄은 필터 조건에 맞는 값으로 채워서 넣는다(createItemForFilters) — 안 그러면
  // 넣자마자 숨겨진다. pendingFocus는 원래 목록의 자리이고, 화면에서는 보이는 줄 중 몇 번째인지로 바꿔 찾는다.
  const pendingFocus = useRef(null);
  const insertRow = (index) => {
    pendingFocus.current = index;
    onItemsChange(insertItemAt(items, index, createItemForFilters(filters)));
  };
  useEffect(() => {
    const at = pendingFocus.current;
    if (at === null) return;
    pendingFocus.current = null;
    const visiblePos = visibleIndexes.indexOf(at);
    if (visiblePos < 0) return;
    tableRef.current
      ?.querySelector(`tr[data-drop-kind="row"][data-drop-i="${visiblePos}"] td:nth-child(4) input`)
      ?.focus();
    // 새 줄이 들어간 직후(items가 바뀔 때)만 — visibleIndexes는 그때의 값이면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

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
      if (fromSub) return applyToView((v) => extractGroupSource(v, source.p, source.i, target.i));
      if (source.i === target.i) return;
      return applyToView((v) => reorderItems(v, source.i, target.i));
    }

    if (target.kind === 'handle') {
      if (fromSub) {
        if (source.p === target.i) return;
        return applyToView((v) => moveSourceToGroup(v, source.p, source.i, target.i, null));
      }
      if (source.i === target.i) return;
      return applyToView((v) => mergeItems(v, [source.i, target.i]));
    }

    // target.kind === 'sub'
    if (!fromSub) {
      if (source.i === target.p) return;
      return applyToView((v) => moveItemIntoGroup(v, source.i, target.p, target.i));
    }
    if (source.p === target.p) {
      return applyToView((v) => reorderGroupSource(v, source.p, source.i, target.i));
    }
    return applyToView((v) => moveSourceToGroup(v, source.p, source.i, target.p, target.i));
  };

  // 끌어서 놓기는 포인터 이벤트로 한다(useDragReorder 설명 참고 — 끄는 동안 휠 스크롤이 된다).
  // 놓을 수 있는 칸은 data-drop-* 로 표시하고, 이 표 안의 칸만 대상으로 삼는다.
  const tableRef = useRef(null);
  const { dragSource, dropTarget, beginDrag, ghostRef, ghostLabel } =
    useDragReorder(handleDrop, { scopeRef: tableRef });

  const isDragging = (p, i) => dragSource && dragSource.p === p && dragSource.i === i;
  const isTarget = (kind, p, i) =>
    dropTarget && dropTarget.kind === kind && dropTarget.p === p && dropTarget.i === i;

  const renderSourceRows = (item, parentIndex) => {
    // 합쳐진 원본 줄은 input이 아니라 글자를 그대로 그린다. 표 전체가 nowrap이라
    // 칸보다 긴 값이 옆 칸을 침범하지 않도록 넘치는 부분은 잘라둔다.
    const cell = {
      padding: '0.25rem 0.4rem', color: '#475569', fontSize: '0.8125rem',
      overflow: 'hidden',
    };

    return item.mergedFrom.map((source, subIndex) => {
      const targeted = isTarget('sub', parentIndex, subIndex);

      return (
        <tr
          key={`${item.mergeId}-src-${subIndex}`}
          data-drop-kind="sub" data-drop-p={parentIndex} data-drop-i={subIndex}
          style={{
            backgroundColor: targeted ? HIGHLIGHT : '#f8fafc',
            opacity: isDragging(parentIndex, subIndex) ? 0.4 : 1,
          }}
        >
          <td />
          <td
            className="drag-handle"
            onPointerDown={(e) => beginDrag(e, { p: parentIndex, i: subIndex }, source.name)}
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
  // 합계와 장 수는 지금 보이는 줄 기준 — 출력도 보이는 줄만 찍히므로 화면과 인쇄물이 같다.
  const totals = computeTotals(visibleRows.map((r) => r.item));
  const printPages = Math.ceil(visibleRows.length / PRINT_ROWS_PER_PAGE);
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
            {items.length}줄 중 <strong>{visibleRows.length}줄</strong>만 보이며, <strong>출력·합계·저장이 모두 이 {visibleRows.length}줄만</strong> 기준입니다.
            순서변경·합치기·삭제도 이 줄들에서 그대로 되고, 숨긴 줄은 제자리에 남습니다.
            줄을 넣으면 필터 조건에 맞는 값으로 채워지며, 그 칸을 바꾸면 조건에서 벗어나 숨겨질 수 있습니다.
          </span>
          <button className="btn" style={{ padding: '0.1rem 0.5rem', fontSize: '0.8125rem' }}
            onClick={() => onFiltersChange({})}>
            전체 필터 해제
          </button>
        </div>
      )}
      <div className="data-table-container">
      <table ref={tableRef} className="data-table data-table--compact">
        <thead>
          <tr>
            <th style={{ width: COL_WIDTH.no }} title="지금 보이는 목록에서 몇 번째 줄인지 (출력 순서)">No</th>
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
            <th style={{ width: COL_WIDTH.actions }} title="줄 넣기 / 삭제">작업</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(({ item, index }, vi) => {
            const merged = isMergedItem(item);
            const expanded = merged && expandedGroups.has(item.mergeId);
            return (
              <React.Fragment key={item.mergeId || index}>
                {/* 인쇄는 한 장에 PRINT_ROWS_PER_PAGE줄씩 끊어서 다음 장으로 넘어간다. 그 경계(12줄과 13줄 사이,
                    24줄과 25줄 사이…)를 표시한다. 지금 보이는(필터·정렬한) 목록 기준이라 출력과 같다. */}
                {vi > 0 && vi % PRINT_ROWS_PER_PAGE === 0 && (
                  <tr className="page-break-row" aria-hidden="true">
                    <td colSpan={columns.length + 3} style={{ padding: 0, border: 'none' }}>
                      <div style={{ borderTop: '2px dashed #dc2626' }} />
                    </td>
                  </tr>
                )}
                <tr
                  data-drop-kind="row" data-drop-i={vi}
                  style={{
                    opacity: isDragging(null, vi) ? 0.5 : 1,
                    transition: 'background-color 0.2s',
                    backgroundColor: isTarget('row', null, vi)
                      ? HIGHLIGHT
                      : merged ? '#eff6ff' : undefined,
                    borderBottom: '1px solid var(--border-color)',
                  }}
                >
                  <td style={{ textAlign: 'center', color: '#64748b', fontSize: '0.75rem', padding: '0 2px' }}>{vi + 1}</td>
                  <td
                    className="drag-handle"
                    data-drop-kind="handle" data-drop-i={vi}
                    onPointerDown={(e) => beginDrag(e, { p: null, i: vi }, item.name)}
                    title={filtered
                      ? '드래그: 보이는 줄 안에서 순서변경 / 다른 행의 이 칸에 놓으면 합치기 (숨긴 줄은 그대로)'
                      : '드래그: 순서변경 / 다른 행의 이 칸에 놓으면 합치기'}
                    style={{
                      textAlign: 'center',
                      color: '#94a3b8',
                      cursor: 'grab',
                      backgroundColor: isTarget('handle', null, vi) ? HIGHLIGHT : undefined,
                      outline: isTarget('handle', null, vi) ? '2px dashed #2563eb' : 'none',
                    }}
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
                  <td>
                    {/* 단가가 있으면 수량 x 단가로 정해지므로 읽기 전용, 단가가 없을 때만 직접 입력 */}
                    <input
                      className="input-field"
                      style={{ textAlign: 'right', fontWeight: 500, ...(Number(item.price) > 0 ? { backgroundColor: '#f1f5f9' } : {}) }}
                      type="text"
                      placeholder="공급가액"
                      readOnly={Number(item.price) > 0}
                      title={Number(item.price) > 0 ? '단가가 있으면 수량 × 단가로 계산됩니다 (단가를 지우면 직접 입력)' : '공급가액 (직접 입력)'}
                      value={Number(item.supply) ? Number(item.supply).toLocaleString() : ''}
                      onChange={e => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        onItemChange(index, 'supply', raw ? Number(raw) : 0);
                      }}
                    />
                  </td>
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
                        style={{ padding: '1px', color: '#2563eb', border: 'none', background: 'none' }}
                        onClick={() => onItemsChange(unmergeItem(items, index))}
                      >
                        <Unlink size={13} />
                      </button>
                    )}
                    <button
                      className="btn"
                      title={filtered
                        ? '이 줄 아래에 줄 넣기 — 필터 조건에 맞는 값으로 채워집니다 (Shift+클릭: 이 줄 위에 넣기)'
                        : '이 줄 아래에 줄 넣기 (Shift+클릭: 이 줄 위에 넣기)'}
                      style={{ padding: '1px', color: '#16a34a', border: 'none', background: 'none' }}
                      onClick={(e) => insertRow(e.shiftKey ? index : index + 1)}
                    >
                      <Plus size={13} />
                    </button>
                    <button className="btn" title="삭제" style={{ padding: '1px', color: 'red', border: 'none', background: 'none' }} onClick={() => onDeleteItem(index)}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
                {expanded && renderSourceRows(item, vi)}
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
          {filtered && `합계는 보이는 ${visibleRows.length}줄 기준(출력과 같음). `}
          {printPages > 1 && `${visibleRows.length}줄이라 ${printPages}장으로 출력되며, 인쇄물에는 장마다 그 장의 합계가 찍힙니다.`}
        </p>
      )}

      {items.length > 0 && (
        <div style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem', color: '#64748b', lineHeight: 1.7 }}>
          <div>줄 오른쪽 끝의 <strong>＋</strong>를 누르면 그 줄 <strong>아래에 빈 줄</strong>이 끼워집니다(<strong>Shift</strong>+클릭은 위). 각 <strong>컬럼 제목을 누르면</strong> <strong>오름차순 정렬</strong>하거나, 값을 체크해서 <strong>그 값만 골라 볼</strong> 수 있습니다. 정렬은 항목 순서를 실제로 바꾸고(출력 순서도 바뀜), 필터는 <strong>화면·출력·저장에서 그 줄만 남깁니다</strong>(숨긴 줄은 명세서에 포함되지 않음).</div>
          <div><strong>이동</strong> 칸을 잡고 드래그 → 다른 행 <strong>본문</strong>에 놓으면 순서변경, 다른 행의 <strong>이동 칸</strong>에 놓으면 합치기. 끄는 동안 <strong>마우스 휠</strong>로 위아래로 이동할 수 있고, 창 위·아래 끝으로 가져가도 따라 내려갑니다. <strong>Esc</strong>로 취소.</div>
          <div>합쳐진 행은 <strong>▶</strong>로 펼쳐서 원본을 볼 수 있고, 원본도 드래그해서 <strong>그룹 안 순서변경</strong>이나 <strong>그룹 밖으로 빼내기</strong>가 됩니다. 원본이 1개만 남으면 병합이 자동으로 풀립니다.</div>
          <div>출력(PDF)에는 합쳐진 대표 행만 나가고 원본은 반영되지 않습니다.</div>
        </div>
      )}
      </div>

      {dragSource && (
        <div ref={ghostRef} className="drag-ghost" aria-hidden="true">
          {ghostLabel || '(이름 없음)'}
          <span>
            {dropTarget?.kind === 'handle' ? '→ 합치기'
              : dropTarget?.kind === 'sub' ? '→ 그룹 안으로'
                : dropTarget ? '→ 이 자리로' : ''}
          </span>
        </div>
      )}

      {menuColumn && (
        <ColumnFilterMenu
          key={menuColumn.key}
          column={menuColumn}
          items={items}
          selected={filters[menuColumn.key] ?? null}
          anchorEl={menu.anchor}
          onSort={(dir) => applyToView((v) => sortItemsBy(v, menuColumn.key, dir))}
          onApply={(selected) => setColumnFilter(menuColumn.key, selected)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

export default TransactionItemsTable;
