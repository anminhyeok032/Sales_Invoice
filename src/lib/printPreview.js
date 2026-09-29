// 출력 미리보기를 새 창에 띄운다.
//
// 화면 밖에 그려 둔 인쇄 양식(TransactionPrintTemplate)의 현재 모습을 그대로 복사해서
// 새 창에 넣는다. 글자 크기 맞춤(FitText)이 이미 계산된 상태라 인쇄물과 똑같이 나오고,
// 양식 크기는 mm 단위라 창 크기와 상관이 없다. 새 창에는 인쇄/닫기 단추가 붙은 막대가 있고
// (인쇄할 때는 이 막대가 빠진다), 인쇄 창에서 PDF로 저장할 수도 있다.
//
// 같은 이름('invoice-print-preview')의 창을 다시 쓰므로, 출력을 다시 누르면 새 창이 계속
// 늘어나지 않고 그 창이 최신 내용으로 바뀐다.

const WINDOW_NAME = 'invoice-print-preview';
const WINDOW_FEATURES = 'width=920,height=1040,left=80,top=40,resizable=yes,scrollbars=yes';

const escapeHtml = (text) => String(text ?? '').replace(/[&<>"]/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]
));

// 이 문서의 스타일을 그대로 가져간다. 새 창은 주소가 없어서 링크는 절대 주소로 바꿔야 한다.
function collectStyles() {
  return [...document.querySelectorAll('link[rel="stylesheet"], style')]
    .map((node) => (node.tagName === 'LINK'
      ? `<link rel="stylesheet" href="${escapeHtml(node.href)}">`
      : node.outerHTML))
    .join('\n');
}

const PREVIEW_CSS = `
  @page { size: A4; margin: 5mm; }
  @media screen {
    body { margin: 0; background: #94a3b8; }
    .pv-bar {
      position: sticky; top: 0; z-index: 10;
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px;
      padding: 8px 16px; background: #1e293b; color: #fff;
      font: 14px 'Noto Sans KR', 'Malgun Gothic', sans-serif;
    }
    .pv-bar__info { margin-right: auto; }
    .pv-bar__note { color: #fcd34d; margin-left: 10px; }
    .pv-bar button {
      padding: 6px 14px; border: 1px solid #64748b; border-radius: 6px;
      background: #334155; color: #fff; font: inherit; cursor: pointer;
    }
    .pv-bar button.pv-primary { background: #2563eb; border-color: #2563eb; }
    .pv-bar button:hover { filter: brightness(1.15); }
    .pv-pages { padding: 16px 0 40px; }
    /* 종이처럼 보이게: 화면에서만 흰 바탕과 그림자. 인쇄에는 영향이 없다. */
    .pv-pages .print-container {
      box-sizing: content-box;
      margin: 0 auto 16px;
      padding: 5mm;
      background: #fff;
      box-shadow: 0 4px 16px rgba(15, 23, 42, 0.4);
    }
  }
`;

// node: 인쇄 양식의 바깥 요소. options.title: 창 제목(= PDF로 저장할 때의 파일 이름).
// options.note: 막대에 노란 글씨로 띄울 안내(예: 필터가 걸려 있어 일부만 출력됨).
// 반환: 창을 열었으면 true, 팝업이 막혔으면 false.
export function openPrintPreview(node, { title = '거래명세서', note = '' } = {}) {
  if (!node) return false;
  const win = window.open('', WINDOW_NAME, WINDOW_FEATURES);
  if (!win) return false;

  const pageCount = node.querySelectorAll('.print-container').length;

  win.document.open();
  win.document.write(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
${collectStyles()}
<style>${PREVIEW_CSS}</style>
</head>
<body>
<div class="pv-bar no-print">
  <span class="pv-bar__info">출력 미리보기 · A4 ${pageCount}장${note ? `<span class="pv-bar__note">${escapeHtml(note)}</span>` : ''}</span>
  <button type="button" id="pv-print" class="pv-primary">인쇄 / PDF 저장</button>
  <button type="button" id="pv-close">닫기</button>
</div>
<div class="pv-pages">${node.innerHTML}</div>
</body>
</html>`);
  win.document.close();

  win.document.getElementById('pv-print').addEventListener('click', () => win.print());
  win.document.getElementById('pv-close').addEventListener('click', () => win.close());
  win.focus();
  return true;
}
