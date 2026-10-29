import { useLayoutEffect, useRef } from 'react';

// 글자가 칸보다 길면 글자 크기를 줄여서 칸 안에 다 보이게 하는 입력칸. 입력하는 동안에도 바로 맞춘다.
// 너무 작아지면 읽을 수 없어서 MIN_FONT_PX 아래로는 줄이지 않는다 — 그보다 길면 예전처럼 칸 안에서 밀린다.
// 칸 폭이 바뀌어도(창 크기, 세액 칸 열기 등) 다시 맞춘다.
const MIN_FONT_PX = 8;
let canvas = null;

function fit(el) {
  el.style.fontSize = '';   // 원래 크기(CSS)로 되돌린 뒤 잰다
  const text = el.value;
  if (!text) return;
  const cs = getComputedStyle(el);
  const base = parseFloat(cs.fontSize);
  const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 1;
  if (!(room > 0)) return;
  canvas = canvas || document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${base}px ${cs.fontFamily}`;
  const width = ctx.measureText(text).width;
  // 캔버스로 잰 폭과 실제 그려지는 폭이 1~2px 다를 수 있어 조금 더 줄인다(0.96).
  if (width > room) el.style.fontSize = `${Math.max(MIN_FONT_PX, Math.floor((base * room * 0.96 / width) * 10) / 10)}px`;
}

function FitInput(props) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    if (ref.current) fit(ref.current);
  }, [props.value]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      fit(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return <input ref={ref} {...props} />;
}

export default FitInput;
