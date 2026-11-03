import React, { useLayoutEffect, useRef, useState } from 'react';
import { PRINT_ROWS_PER_PAGE, itemDateLabel, computeTotals } from '../lib/transactionItems';
import { printedNotes, printedUnit } from '../lib/statementView';
import { FORM_GRID, formatStatementDate } from '../lib/printLayout';
import { useTransparentStamp } from '../lib/stampImage';
import useStore from '../store';

const LINE_HEIGHT = 1.15;

// 칸 안에 글자를 맞춘다. 한 줄(lines=1)이면 넘칠 때 글자를 줄이고,
// 여러 줄이면 먼저 줄을 바꿔 보고 그래도 넘칠 때만 글자를 줄인다
// (기존 양식도 긴 상호/주소는 두 줄로 찍었다).
function FitText({ children, maxFontSize = 11, minFontSize = 6, lines = 1 }) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [fontSize, setFontSize] = useState(maxFontSize);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;
    const width = container.clientWidth;
    if (!width) return;

    const fits = (size) => {
      textEl.style.fontSize = `${size}px`;
      if (textEl.scrollWidth > width + 0.5) return false;
      return lines === 1 || textEl.offsetHeight <= Math.ceil(size * LINE_HEIGHT * lines) + 1;
    };
    let size = maxFontSize;
    while (size > minFontSize && !fits(size)) size = Math.max(minFontSize, size - 0.5);
    textEl.style.fontSize = `${size}px`;
    setFontSize(size);
  }, [children, maxFontSize, minFontSize, lines]);

  const multi = lines > 1;
  return (
    <div ref={containerRef} style={{ width: '100%', overflow: 'hidden' }}>
      <span
        ref={textRef}
        style={{
          fontSize: `${fontSize}px`,
          lineHeight: LINE_HEIGHT,
          display: multi ? 'block' : 'inline-block',
          // 앞쪽 공백을 지우지 않는다: 윗줄과 같다는 표시로 앞에 띄어쓰기를 넣고 '"'를 찍는 경우가 있어서
          // 화면에서 넣은 공백 그대로 찍는다(pre). 여러 줄 칸은 공백을 지키면서 줄을 바꾼다(pre-wrap).
          whiteSpace: multi ? 'pre-wrap' : 'pre',
          wordBreak: multi ? 'keep-all' : undefined,
          overflowWrap: multi ? 'anywhere' : undefined,
          maxWidth: '100%',
        }}
      >
        {children}
      </span>
    </div>
  );
}

// '2021/03/31', '2021-03-31', '21.03.31' -> '2021년 03월 31일' (기존 양식 표기). 못 읽으면 그대로.

const EMPTY_ROW = { date: '', name: '', spec: '', unit: '', qty: '', price: '', supply: '', tax: '', note: '' };

// 인쇄되는 A4 한 장 = 공급받는자 보관용(파랑) + 공급자 보관용(빨강).
// 양식(테두리·항목명)은 보관용 색, 입력된 내용은 모두 검정.
const TransactionPrintTemplate = React.forwardRef(({ data, receiver, supplier, date }, ref) => {
  const MAX_ROWS = PRINT_ROWS_PER_PAGE;
  const items = data || [];
  const { showNote = true, showDailySum = true } = useStore((s) => s.printOptions) || {};
  // 예전 프로그램 도장(BMP)의 자홍색 배경을 투명하게
  const stampSrc = useTransparentStamp(supplier?.stamp);

  // 비고 칸: 출력 설정(품목 메모 / 일별 합계)에 따라 찍히는 글자. 엑셀 보기 파일도 같은 함수를 쓴다.
  const notes = printedNotes(items, { showNote, showDailySum });
  const enhancedItems = items.map((item, idx) => ({ ...item, _appendedNote: notes[idx] }));

  const pages = [];
  for (let i = 0; i < enhancedItems.length; i += MAX_ROWS) {
    pages.push(enhancedItems.slice(i, i + MAX_ROWS));
  }
  if (pages.length === 0) pages.push([]);


  const formatCurrency = (val) => (val ? Number(val).toLocaleString() : '');
  const printedDate = formatStatementDate(date);

  // 세 표가 같은 열 격자(FORM_GRID)를 쓴다 — 표를 건너는 세로선이 한 줄로 맞는다. 칸은 원래 표의 몇 번째 칸부터
  // 몇 번째 칸까지인지로 적고, 격자에서 몇 열을 차지하는지(colSpan)는 FORM_GRID.span이 정한다.
  const gridCols = <colgroup>{FORM_GRID.cols.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>;
  const span = (table, from, to = from) => FORM_GRID.span(table, from, to);
  const I = (from, to) => span('info', from, to);

  // o: 공급자 칸은 0부터, 공급받는자 칸은 7부터(공급자/공급받는자 표는 7칸씩 두 벌 — printLayout.HALF_COLS_MM)
  const partyCells = (p, withStamp, o) => ({
    regNo: <td colSpan={I(o + 2, o + 6)} className="st-value st-regno"><FitText maxFontSize={15} minFontSize={9}>{p.regNo}</FitText></td>,
    name: <td colSpan={I(o + 2, o + 3)} className="st-value"><FitText lines={2}>{p.name}</FitText></td>,
    president: (
      <td colSpan={I(o + 6)} className="st-value st-president">
        <div className="st-president__inner">
          <FitText>{p.president}</FitText>
          <span className="st-in">(인)</span>
        </div>
        {withStamp && stampSrc && <img className="st-stamp" src={stampSrc} alt="" />}
      </td>
    ),
    address: <td colSpan={I(o + 2, o + 6)} className="st-value"><FitText lines={2}>{p.address}</FitText></td>,
    businessType: <td colSpan={I(o + 2)} className="st-value"><FitText>{p.businessType}</FitText></td>,
    businessItem: <td colSpan={I(o + 5, o + 6)} className="st-value"><FitText>{p.businessItem}</FitText></td>,
    // 항목명 칸들
    vertical: (label) => <th rowSpan="4" colSpan={I(o)} className="st-vertical">{label}</th>,
    label: (text) => <th colSpan={I(o + 1)}>{text}</th>,
    daepyo: <th colSpan={I(o + 4, o + 5)}>대 표</th>,
    jongmok: <th colSpan={I(o + 3, o + 4)}>종 목</th>,
  });

  // No. 옆의 장 번호: 여러 장을 한 번에 찍으면 '1 / 4'처럼. 한 장뿐이면 비운다.
  const pageLabel = (pageIndex) => (pages.length > 1 ? `${pageIndex + 1} / ${pages.length}` : '');

  const renderHalf = (type, pageItems, pageIndex) => {
    const isReceiver = type === 'receiver';
    const title = isReceiver ? '(공급받는자 보관용)' : '(공급자 보관용)';

    const displayItems = [...pageItems];
    while (displayItems.length < MAX_ROWS) displayItems.push(EMPTY_ROW);


    // 합계 줄은 장마다 그 장에 찍힌 줄의 합계
    const totals = computeTotals(pageItems);

    const S = partyCells(supplier, true, 0);
    const R = partyCells(receiver, false, 7);

    // 공급자 계좌(있을 때만): 테두리 밖 왼쪽 아래에 한 줄. 그만큼 칸 높이를 늘린다(.has-foot).
    const account = String(supplier?.account || '').trim();

    return (
      <div className={`statement ${type}${account ? ' has-foot' : ''}`}>
        <div className="statement-head">
          <div className="statement-title">거래명세표</div>
          <div className="statement-subline">
            <span className="statement-no">No. <span className="st-ink">{pageLabel(pageIndex)}</span></span>
            <span className="statement-subtitle">{title}</span>
            <span className="statement-date">작성일자 <span className="st-ink">{printedDate}</span></span>
          </div>
        </div>

        <div className="statement-frame">
          <table className="st-info">
            {gridCols}
            <tbody>
              <tr className="st-row-regno">
                {S.vertical('공급자')}
                {S.label('등록번호')}
                {S.regNo}
                {R.vertical('공급받는자')}
                {R.label('등록번호')}
                {R.regNo}
              </tr>
              <tr className="st-row-name">
                {S.label(<>상&nbsp;&nbsp;호</>)}
                {S.name}
                {S.daepyo}
                {S.president}
                {R.label(<>상&nbsp;&nbsp;호</>)}
                {R.name}
                {R.daepyo}
                {R.president}
              </tr>
              <tr className="st-row-address">
                {S.label(<>주&nbsp;&nbsp;소</>)}
                {S.address}
                {R.label(<>주&nbsp;&nbsp;소</>)}
                {R.address}
              </tr>
              <tr className="st-row-type">
                {S.label(<>업&nbsp;&nbsp;태</>)}
                {S.businessType}
                {S.jongmok}
                {S.businessItem}
                {R.label(<>업&nbsp;&nbsp;태</>)}
                {R.businessType}
                {R.jongmok}
                {R.businessItem}
              </tr>
            </tbody>
          </table>

          <table className="st-items">
            {gridCols}
            <thead>
              <tr>
                {['날짜', <>품&nbsp;&nbsp;&nbsp;&nbsp;목</>, <>규&nbsp;&nbsp;&nbsp;&nbsp;격</>, '단위', '수 량', '단 가', '공급가액', '세 액', '비 고']
                  .map((h, i) => <th key={i} colSpan={span('items', i)}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {displayItems.map((item, index) => {
                const showDate = !(index > 0 && item.date && item.date === displayItems[index - 1].date);
                return (
                  <tr key={index}>
                    <td colSpan={span('items', 0)} className="text-center"><FitText>{showDate ? itemDateLabel(item.date) : ''}</FitText></td>
                    <td colSpan={span('items', 1)}><FitText>{item.name}</FitText></td>
                    <td colSpan={span('items', 2)}><FitText>{item.spec}</FitText></td>
                    <td colSpan={span('items', 3)} className="text-center"><FitText>{printedUnit(item.unit)}</FitText></td>
                    <td colSpan={span('items', 4)} className="text-right"><FitText>{formatCurrency(item.qty)}</FitText></td>
                    <td colSpan={span('items', 5)} className="text-right"><FitText>{formatCurrency(item.price)}</FitText></td>
                    <td colSpan={span('items', 6)} className="text-right"><FitText>{formatCurrency(item.supply)}</FitText></td>
                    <td colSpan={span('items', 7)} className="text-right"><FitText>{formatCurrency(item.tax)}</FitText></td>
                    <td colSpan={span('items', 8)}><FitText>{item._appendedNote !== undefined ? item._appendedNote : item.note}</FitText></td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <table className="st-sum">
            {gridCols}
            <tbody>
              <tr>
                <th colSpan={span('sum', 0)}>미수금</th>
                <td colSpan={span('sum', 1)} />
                <th colSpan={span('sum', 2)}>금액</th>
                <td colSpan={span('sum', 3)} className="text-right"><FitText>{formatCurrency(totals.supply)}</FitText></td>
                <th colSpan={span('sum', 4)}>세액</th>
                <td colSpan={span('sum', 5)} className="text-right"><FitText>{formatCurrency(totals.tax)}</FitText></td>
                <th colSpan={span('sum', 6)}>합계</th>
                <td colSpan={span('sum', 7)} className="text-right"><FitText>{formatCurrency(totals.total)}</FitText></td>
                <th colSpan={span('sum', 8)} className="st-receiver-sign"><span>인수자</span><span>(인)</span></th>
              </tr>
            </tbody>
          </table>
        </div>
        {account && <div className="statement-foot st-ink">{account}</div>}
      </div>
    );
  };

  return (
    <div ref={ref}>
      {pages.map((pageItems, pageIndex) => (
        <div key={pageIndex} className="print-container" style={{ pageBreakAfter: pageIndex < pages.length - 1 ? 'always' : 'auto' }}>
          {renderHalf('receiver', pageItems, pageIndex)}
          <div className="statement-divider" />
          {renderHalf('supplier', pageItems, pageIndex)}
        </div>
      ))}
    </div>
  );
});

export default TransactionPrintTemplate;
