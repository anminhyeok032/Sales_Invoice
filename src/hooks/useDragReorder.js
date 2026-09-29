import { useCallback, useEffect, useRef, useState } from 'react';

// 행 끌어서 옮기기 / 합치기.
//
// 출발지: { p: null, i } = 최상위 항목, { p: 부모index, i: 원본index } = 병합 안의 원본
// 놓는 곳: { kind: 'row' | 'handle' | 'sub', p, i }
//   row    = 최상위 행 본문        -> 순서변경 / 병합 밖으로 빼내기
//   handle = 최상위 행의 '이동' 칸 -> 합치기 / 다른 그룹으로 옮기기
//   sub    = 병합 안의 원본 행     -> 그룹 내 순서변경 / 그룹으로 넣기
//
// 브라우저 기본 끌어서 놓기(HTML5 draggable)를 쓰지 않고 포인터 이벤트로 직접 구현한다.
// Windows의 Chrome/Edge는 기본 끌어서 놓기를 OS의 드래그 루프에 맡기는데, 그동안에는 마우스
// 휠 입력이 페이지로 오지 않는다 — 긴 명세서에서 행을 잡은 채 휠로 내려갈 수가 없었다.
// 포인터 이벤트로 끌면 페이지는 평소 그대로라 휠 스크롤이 그냥 된다.
//
// 놓을 수 있는 칸에는 data-drop-kind / data-drop-p / data-drop-i 를 달아 두고, 포인터가
// 움직이거나 페이지가 스크롤될 때마다 포인터 아래 칸을 다시 찾는다.

const START_DISTANCE = 4;   // 이만큼 움직여야 끌기로 본다(그 전에는 그냥 클릭)
const EDGE = 70;            // 창 위/아래 가장자리 이 안쪽으로 끌면 자동 스크롤
const MAX_SPEED = 18;       // 자동 스크롤 한 프레임 최대 px

function readTarget(el) {
  const { dropKind, dropP, dropI } = el.dataset;
  return { kind: dropKind, p: dropP === undefined || dropP === '' ? null : Number(dropP), i: Number(dropI) };
}

const sameTarget = (a, b) => (a === b) || (a && b && a.kind === b.kind && a.p === b.p && a.i === b.i);

export function useDragReorder(onDrop, { disabled = false, scopeRef } = {}) {
  const [dragSource, setDragSource] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [ghostLabel, setGhostLabel] = useState('');
  const ghostRef = useRef(null);
  const drag = useRef(null);          // 진행 중인 끌기의 좌표/상태
  const onDropRef = useRef(onDrop);

  useEffect(() => { onDropRef.current = onDrop; }, [onDrop]);

  // 포인터 아래에 있는 '놓을 수 있는 칸'. 끌고 있는 표 안의 칸만 인정한다.
  const hitTest = useCallback((x, y) => {
    const el = document.elementFromPoint(x, y)?.closest('[data-drop-kind]');
    if (!el || (scopeRef?.current && !scopeRef.current.contains(el))) return null;
    return readTarget(el);
  }, [scopeRef]);

  const updateTarget = useCallback(() => {
    const d = drag.current;
    if (!d?.started) return;
    const t = hitTest(d.x, d.y);
    if (!sameTarget(t, d.target)) {
      d.target = t;
      setDropTarget(t);
    }
  }, [hitTest]);

  const finish = useCallback((commit) => {
    const d = drag.current;
    if (!d) return;
    d.cleanup();
    drag.current = null;
    document.body.classList.remove('is-row-dragging');
    setDragSource(null);
    setDropTarget(null);
    if (commit && d.started && d.target) onDropRef.current(d.source, d.target);
  }, []);

  // 창 가장자리 자동 스크롤(휠을 쓰지 않을 때나 터치로 끌 때). 끄는 동안에만 돈다.
  useEffect(() => {
    if (!dragSource) return undefined;
    let frame = 0;
    const tick = () => {
      const d = drag.current;
      if (d?.started) {
        const h = window.innerHeight;
        let dy = 0;
        if (d.y < EDGE) dy = -Math.ceil(((EDGE - d.y) / EDGE) * MAX_SPEED);
        else if (d.y > h - EDGE) dy = Math.ceil(((d.y - (h - EDGE)) / EDGE) * MAX_SPEED);
        if (dy) window.scrollBy(0, dy);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragSource]);

  // 행의 '이동' 칸에서 누를 때 부른다. label은 끄는 동안 포인터 옆에 띄울 글자.
  const beginDrag = (e, source, label) => {
    if (disabled || drag.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('button, input, a')) return;   // 칸 안의 펼치기 단추 등은 원래대로
    e.preventDefault();                                  // 글자 선택 방지

    const onMove = (ev) => {
      const d = drag.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      d.x = ev.clientX;
      d.y = ev.clientY;
      if (!d.started) {
        if (Math.hypot(d.x - d.startX, d.y - d.startY) < START_DISTANCE) return;
        d.started = true;
        document.body.classList.add('is-row-dragging');
        setDragSource(source);
        setGhostLabel(label || '');
      }
      if (ghostRef.current) ghostRef.current.style.transform = `translate(${d.x + 14}px, ${d.y + 10}px)`;
      updateTarget();
    };
    const onUp = (ev) => { if (drag.current && ev.pointerId === drag.current.pointerId) finish(true); };
    const onCancel = () => finish(false);
    const onKey = (ev) => { if (ev.key === 'Escape') finish(false); };
    // 휠이나 자동 스크롤로 페이지가 움직이면 포인터는 그대로여도 그 아래 칸은 바뀐다.
    const onScroll = () => updateTarget();

    // 포인터를 붙잡아 둔다 — 창 밖에서 버튼을 놓아도 pointerup이 온다.
    // 다른 이유로 놓쳐 버리면(요소가 사라짐 등) 옮기지 않고 끝낸다.
    const handle = e.currentTarget;
    const onLost = () => finish(false);
    try { handle.setPointerCapture(e.pointerId); } catch { /* 이미 떼어진 포인터 */ }
    handle.addEventListener('lostpointercapture', onLost);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);

    drag.current = {
      source, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
      started: false, target: null,
      cleanup: () => {
        handle.removeEventListener('lostpointercapture', onLost);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('scroll', onScroll, true);
      },
    };
  };

  // 표가 사라지면(다른 명세서 선택 등) 진행 중인 끌기를 정리한다.
  useEffect(() => () => finish(false), [finish]);

  return { dragSource, dropTarget, beginDrag, ghostRef, ghostLabel };
}
