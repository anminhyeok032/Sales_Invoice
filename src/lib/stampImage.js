import { useEffect, useState } from 'react';

// 예전 거래명세서 프로그램의 도장 이미지(BMP)는 자홍색(255, 0, 255)을 "투명"으로 쓰는
// 방식이다. 브라우저는 그 약속을 모르기 때문에 그대로 찍으면 도장 뒤에 자홍색 네모가 나온다.
// 자홍색 칸만 진짜 투명으로 바꾼 PNG를 만들어 쓴다. 자홍색이 없는 이미지는 그대로 둔다.

const cache = new Map();   // 원본 data URL -> 바꾼 결과(Promise<string>)

const isKeyColor = (r, g, b) => r > 200 && g < 70 && b > 200;

function keyOutMagenta(src) {
  if (!cache.has(src)) {
    cache.set(src, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = pixels.data;
        let changed = false;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] && isKeyColor(d[i], d[i + 1], d[i + 2])) {
            d[i + 3] = 0;
            changed = true;
          }
        }
        if (!changed) return resolve(src);
        ctx.putImageData(pixels, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(src);
      img.src = src;
    }));
  }
  return cache.get(src);
}

// 엑셀에 넣을 도장: 엑셀은 PNG/JPEG만 받으므로(기존 프로그램 도장은 BMP) 자홍색을 투명하게 바꾼 뒤
// 항상 PNG로 돌려준다. 'data:image/png;base64,...'
export async function stampToPng(src) {
  if (!src) return '';
  const keyed = await keyOutMagenta(src);
  if (keyed.startsWith('data:image/png')) return keyed;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve('');
    img.src = keyed;
  });
}

// 도장 이미지 주소를 받아, 자홍색 배경을 투명하게 바꾼 주소를 돌려준다(바꾸는 동안에는 원본).
export function useTransparentStamp(src) {
  const [result, setResult] = useState({ src, out: src });

  useEffect(() => {
    if (!src) return undefined;
    let alive = true;
    keyOutMagenta(src).then((out) => { if (alive) setResult({ src, out }); });
    return () => { alive = false; };
  }, [src]);

  return result.src === src ? result.out : src;
}
