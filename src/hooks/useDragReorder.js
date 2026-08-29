import { useState } from 'react';

// 드래그 출발지: { p: null, i } = 최상위 항목, { p: 부모index, i: 원본index } = 병합 안의 원본
// 드롭 대상: { kind: 'row' | 'handle' | 'sub', p, i }
//   row    = 최상위 행 본문        -> 순서변경 / 병합 밖으로 빼내기
//   handle = 최상위 행의 '이동' 칸 -> 합치기 / 다른 그룹으로 옮기기
//   sub    = 병합 안의 원본 행     -> 그룹 내 순서변경 / 그룹으로 넣기
const encode = (source) => JSON.stringify(source);

const decode = (raw) => {
  try {
    const parsed = JSON.parse(raw);
    return parsed && Number.isInteger(parsed.i) ? parsed : null;
  } catch {
    return null;
  }
};

export function useDragReorder(onDrop) {
  const [dragSource, setDragSource] = useState(null);
  const [activeHandleKey, setActiveHandleKey] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const reset = () => {
    setDragSource(null);
    setActiveHandleKey(null);
    setDropTarget(null);
  };

  // effectAllowed는 dropEffect와 호환되어야 한다. 호환되지 않는 값을 쓰면
  // 브라우저가 드롭을 거부해서 drop 이벤트가 아예 발생하지 않는다.
  const startDrag = (e, source) => {
    setDragSource(source);
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', encode(source));
  };

  const overTarget = (e, target, dropEffect = 'move') => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = dropEffect;
    setDropTarget(target);
  };

  // 칸 안의 자식(아이콘/버튼)으로 옮겨갈 때도 dragleave가 오므로,
  // 대상 밖으로 정말 나갔을 때만 강조를 푼다.
  const leaveTarget = (e) => {
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDropTarget(null);
  };

  const dropOnTarget = (e, target) => {
    e.preventDefault();
    e.stopPropagation();
    // 출발지는 dataTransfer를 우선 사용한다. state(dragSource)는 dragstart 직후
    // 아직 커밋되지 않았을 수 있어서 단독으로는 신뢰할 수 없다.
    const source = decode(e.dataTransfer.getData('text/plain')) || dragSource;
    reset();
    if (source) onDrop(source, target);
  };

  return {
    dragSource,
    dropTarget,
    activeHandleKey,
    setActiveHandleKey,
    startDrag,
    overTarget,
    leaveTarget,
    dropOnTarget,
    endDrag: reset,
  };
}
