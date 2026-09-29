import React, { useLayoutEffect, useRef, useState } from 'react';
import { PRINT_ROWS_PER_PAGE } from '../lib/transactionItems';
import { toDateKey } from '../lib/dateRange';
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
          whiteSpace: multi ? 'normal' : 'nowrap',
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
function formatStatementDate(date) {
  const key = toDateKey(date);
  return key ? `${key.slice(0, 4)}년 ${key.slice(4, 6)}월 ${key.slice(6, 8)}일` : (date || '');
}

// 칸 폭은 기존 프로그램 인쇄물을 스캔한 이미지에서 선 위치를 재서 옮긴 값(테두리 안 682px = 190mm).
// 공급자/공급받는자는 반씩(95mm). 상호·대표 줄과 업태·종목 줄은 칸 나누는 자리가 달라서
// 둘을 합친 7칸 격자를 두고 colSpan으로 맞춘다:
//   [세로제목, 항목명, a, b, c, d, e]
//   상호 = a+b, 대표 = c+d, 값 = e        업태 = a, 종목 = b+c, 값 = d+e
// 폭은 mm가 아니라 %로 준다. 굵은 테두리(양쪽 0.8mm)를 뺀 안쪽 폭은 188.4mm라서, 합이 190mm가 되게
// mm로 고정하면 표가 테두리 오른쪽으로 1.6mm 튀어나온다. 비율만 스캔에서 잰 값을 따른다.
const HALF_COLS_MM = [7.7, 14.5, 29.9, 6.0, 4.5, 6.1, 26.3];
const INFO_COLS_MM = [...HALF_COLS_MM, ...HALF_COLS_MM];
const INFO_TOTAL_MM = INFO_COLS_MM.reduce((sum, w) => sum + w, 0);
// 품목 칸: 날짜 품목 규격 단위 수량 단가 공급가액 세액 비고 (%)
const ITEM_COLS = [6.89, 26.10, 17.01, 3.96, 7.62, 9.53, 11.73, 9.38, 7.77];
// 합계 줄: 미수금 (값) 금액 (값) 세액 (값) 합계 (값) 인수자·(인) (%)
const SUM_COLS = [6.89, 15.69, 4.84, 15.10, 4.84, 14.22, 4.84, 16.42, 17.16];

const EMPTY_ROW = { date: '', name: '', spec: '', unit: '', qty: '', price: '', supply: '', tax: '', note: '' };

// 인쇄되는 A4 한 장 = 공급받는자 보관용(파랑) + 공급자 보관용(빨강).
// 양식(테두리·항목명)은 보관용 색, 입력된 내용은 모두 검정.
const TransactionPrintTemplate = React.forwardRef(({ data, receiver, supplier, date }, ref) => {
  const MAX_ROWS = PRINT_ROWS_PER_PAGE;
  const items = data || [];
  const { showNote = true, showDailySum = true } = useStore((s) => s.printOptions) || {};
  // 예전 프로그램 도장(BMP)의 자홍색 배경을 투명하게
  const stampSrc = useTransparentStamp(supplier?.stamp);

  const dailyInfo = {};
  items.forEach((item, idx) => {
    if (!item.date) return;
    if (!dailyInfo[item.date]) {
      dailyInfo[item.date] = { sum: 0, lastItemIndex: idx };
    }
    dailyInfo[item.date].sum += (Number(item.supply) || 0);
    dailyInfo[item.date].lastItemIndex = idx;
  });

  const enhancedItems = items.map((item, idx) => {
    const isLastOfDate = item.date && dailyInfo[item.date] && dailyInfo[item.date].lastItemIndex === idx;
    let appendedNote = showNote ? (item.note || '') : '';
    if (showDailySum && isLastOfDate) {
      const sum = dailyInfo[item.date].sum;
      if (sum > 0) {
        const shortSum = sum / 10000;
        appendedNote = appendedNote ? `${appendedNote} (${shortSum})` : `${shortSum}`;
      }
    }
    return { ...item, _appendedNote: appendedNote };
  });

  const pages = [];
  for (let i = 0; i < enhancedItems.length; i += MAX_ROWS) {
    pages.push(enhancedItems.slice(i, i + MAX_ROWS));
  }
  if (pages.length === 0) pages.push([]);

  const formatCurrency = (val) => (val ? Number(val).toLocaleString() : '');
  const printedDate = formatStatementDate(date);

  const partyCells = (p, withStamp) => ({
    regNo: <td colSpan="5" className="st-value st-regno"><FitText maxFontSize={15} minFontSize={9}>{p.regNo}</FitText></td>,
    name: <td colSpan="2" className="st-value"><FitText lines={2}>{p.name}</FitText></td>,
    president: (
      <td className="st-value st-president">
        <div className="st-president__inner">
          <FitText>{p.president}</FitText>
          <span className="st-in">(인)</span>
        </div>
        {withStamp && stampSrc && <img className="st-stamp" src={stampSrc} alt="" />}
      </td>
    ),
    address: <td colSpan="5" className="st-value"><FitText lines={2}>{p.address}</FitText></td>,
    businessType: <td className="st-value"><FitText>{p.businessType}</FitText></td>,
    businessItem: <td colSpan="2" className="st-value"><FitText>{p.businessItem}</FitText></td>,
  });

  const renderHalf = (type, pageItems) => {
    const isReceiver = type === 'receiver';
    const title = isReceiver ? '(공급받는자 보관용)' : '(공급자 보관용)';

    const displayItems = [...pageItems];
    while (displayItems.length < MAX_ROWS) displayItems.push(EMPTY_ROW);

    // 장마다 그 장에 찍힌 줄의 합계
    const pageSupply = pageItems.reduce((sum, item) => sum + (Number(item.supply) || 0), 0);
    const pageTax = pageItems.reduce((sum, item) => sum + (Number(item.tax) || 0), 0);
    const pageTotal = pageSupply + pageTax;

    const S = partyCells(supplier, true);
    const R = partyCells(receiver, false);

    return (
      <div className={`statement ${type}`}>
        <div className="statement-head">
          <div className="statement-title">거래명세표</div>
          <div className="statement-subline">
            <span className="statement-no">No.</span>
            <span className="statement-subtitle">{title}</span>
            <span className="statement-date">작성일자 <span className="st-ink">{printedDate}</span></span>
          </div>
        </div>

        <div className="statement-frame">
          <table className="st-info">
            <colgroup>{INFO_COLS_MM.map((w, i) => <col key={i} style={{ width: `${(w / INFO_TOTAL_MM) * 100}%` }} />)}</colgroup>
            <tbody>
              <tr className="st-row-regno">
                <th rowSpan="4" className="st-vertical">공급자</th>
                <th>등록번호</th>
                {S.regNo}
                <th rowSpan="4" className="st-vertical">공급받는자</th>
                <th>등록번호</th>
                {R.regNo}
              </tr>
              <tr className="st-row-name">
                <th>상&nbsp;&nbsp;호</th>
                {S.name}
                <th colSpan="2">대 표</th>
                {S.president}
                <th>상&nbsp;&nbsp;호</th>
                {R.name}
                <th colSpan="2">대 표</th>
                {R.president}
              </tr>
              <tr className="st-row-address">
                <th>주&nbsp;&nbsp;소</th>
                {S.address}
                <th>주&nbsp;&nbsp;소</th>
                {R.address}
              </tr>
              <tr className="st-row-type">
                <th>업&nbsp;&nbsp;태</th>
                {S.businessType}
                <th colSpan="2">종 목</th>
                {S.businessItem}
                <th>업&nbsp;&nbsp;태</th>
                {R.businessType}
                <th colSpan="2">종 목</th>
                {R.businessItem}
              </tr>
            </tbody>
          </table>

          <table className="st-items">
            <colgroup>{ITEM_COLS.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
            <thead>
              <tr>
                <th>날짜</th>
                <th>품&nbsp;&nbsp;&nbsp;&nbsp;목</th>
                <th>규&nbsp;&nbsp;&nbsp;&nbsp;격</th>
                <th>단위</th>
                <th>수 량</th>
                <th>단 가</th>
                <th>공급가액</th>
                <th>세 액</th>
                <th>비 고</th>
              </tr>
            </thead>
            <tbody>
              {displayItems.map((item, index) => {
                const showDate = !(index > 0 && item.date && item.date === displayItems[index - 1].date);
                return (
                  <tr key={index}>
                    <td className="text-center"><FitText>{showDate ? item.date : ''}</FitText></td>
                    <td><FitText>{item.name}</FitText></td>
                    <td><FitText>{item.spec}</FitText></td>
                    <td className="text-center"><FitText>{item.unit}</FitText></td>
                    <td className="text-right"><FitText>{formatCurrency(item.qty)}</FitText></td>
                    <td className="text-right"><FitText>{formatCurrency(item.price)}</FitText></td>
                    <td className="text-right"><FitText>{formatCurrency(item.supply)}</FitText></td>
                    <td className="text-right"><FitText>{formatCurrency(item.tax)}</FitText></td>
                    <td><FitText>{item._appendedNote !== undefined ? item._appendedNote : item.note}</FitText></td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <table className="st-sum">
            <colgroup>{SUM_COLS.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
            <tbody>
              <tr>
                <th>미수금</th>
                <td />
                <th>금액</th>
                <td className="text-right"><FitText>{formatCurrency(pageSupply)}</FitText></td>
                <th>세액</th>
                <td className="text-right"><FitText>{formatCurrency(pageTax)}</FitText></td>
                <th>합계</th>
                <td className="text-right"><FitText>{formatCurrency(pageTotal)}</FitText></td>
                <th className="st-receiver-sign"><span>인수자</span><span>(인)</span></th>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div ref={ref}>
      {pages.map((pageItems, pageIndex) => (
        <div key={pageIndex} className="print-container" style={{ pageBreakAfter: pageIndex < pages.length - 1 ? 'always' : 'auto' }}>
          {renderHalf('receiver', pageItems)}
          <div className="statement-divider" />
          {renderHalf('supplier', pageItems)}
        </div>
      ))}
    </div>
  );
});

export default TransactionPrintTemplate;
