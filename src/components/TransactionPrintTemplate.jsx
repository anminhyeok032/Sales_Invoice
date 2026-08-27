import React, { useLayoutEffect, useRef, useState } from 'react';

// Shrinks font-size so text stays on one line within its cell instead of wrapping or being clipped.
function FitText({ children, maxFontSize = 11, minFontSize = 6 }) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [fontSize, setFontSize] = useState(maxFontSize);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;

    textEl.style.fontSize = `${maxFontSize}px`;
    const containerWidth = container.clientWidth;
    const textWidth = textEl.scrollWidth;

    if (containerWidth > 0 && textWidth > containerWidth) {
      let size = Math.max(minFontSize, (containerWidth / textWidth) * maxFontSize);
      textEl.style.fontSize = `${size}px`;
      if (textEl.scrollWidth > containerWidth) {
        size = Math.max(minFontSize, size * (containerWidth / textEl.scrollWidth));
      }
      setFontSize(size);
    } else {
      setFontSize(maxFontSize);
    }
  }, [children, maxFontSize, minFontSize]);

  return (
    <div ref={containerRef} style={{ width: '100%', overflow: 'hidden' }}>
      <span ref={textRef} style={{ fontSize: `${fontSize}px`, whiteSpace: 'nowrap', display: 'inline-block', maxWidth: '100%' }}>
        {children}
      </span>
    </div>
  );
}

// The TransactionPrintTemplate component represents the A4 printable area.
const TransactionPrintTemplate = React.forwardRef(({ data, receiver, supplier, date }, ref) => {
  const MAX_ROWS = 10;
  const items = data || [];
  
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
    let appendedNote = item.note || '';
    if (isLastOfDate) {
      const sum = dailyInfo[item.date].sum;
      if (sum > 0) {
        const shortSum = sum / 10000;
        appendedNote = appendedNote ? `${appendedNote} (${shortSum})` : `${shortSum}`;
      }
    }
    return { ...item, _appendedNote: appendedNote };
  });
  
  // Chunk items into arrays of MAX_ROWS length
  const pages = [];
  for (let i = 0; i < enhancedItems.length; i += MAX_ROWS) {
    pages.push(enhancedItems.slice(i, i + MAX_ROWS));
  }

  // If there are no items, ensure we at least render one empty page
  if (pages.length === 0) {
    pages.push([]);
  }

  const renderHalf = (type, pageItems, isLastPage) => {
    const isReceiver = type === 'receiver';
    const title = isReceiver ? '(공급받는자 보관용)' : '(공급자 보관용)';
    
    // Fill the remaining rows with empty objects to maintain table height
    const displayItems = [...pageItems];
    while (displayItems.length < MAX_ROWS) {
      displayItems.push({ date: '', name: '', spec: '', unit: '', qty: '', price: '', supply: '', tax: '', note: '' });
    }

    // Calculate sums only for the items on THIS page, or you could do it for all items.
    // Usually, each page shows the sum for that page.
    const pageSupply = pageItems.reduce((sum, item) => sum + (Number(item.supply) || 0), 0);
    const pageTax = pageItems.reduce((sum, item) => sum + (Number(item.tax) || 0), 0);
    const pageTotal = pageSupply + pageTax;

    const formatCurrency = (val) => val ? Number(val).toLocaleString() : '';

    return (
      <div className={`statement-box ${type}`}>
        <div className="statement-header">
          <div className="statement-no">No. </div>
          <div className="statement-title-wrap">
            <div className="statement-title">거 래 명 세 표</div>
            <div className="statement-subtitle">{title}</div>
          </div>
          <div className="statement-date">작성일자: {date}</div>
        </div>

        <table className="company-info-table">
          <tbody>
            <tr>
              <th rowSpan="4" style={{ width: '20px', writingMode: 'vertical-rl', textOrientation: 'upright' }}>공급자</th>
              <th style={{ width: '60px' }}>등록번호</th>
              <td colSpan="3" className="text-center font-bold"><FitText maxFontSize={14}>{supplier.regNo}</FitText></td>
              <th rowSpan="4" style={{ width: '20px', writingMode: 'vertical-rl', textOrientation: 'upright' }}>공급받는자</th>
              <th style={{ width: '60px' }}>등록번호</th>
              <td colSpan="3" className="text-center font-bold"><FitText maxFontSize={14}>{receiver.regNo}</FitText></td>
            </tr>
            <tr>
              <th>상호</th>
              <td><FitText>{supplier.name}</FitText></td>
              <th style={{ width: '40px' }}>대표</th>
              <td style={{ display: 'flex', alignItems: 'center', gap: '4px', overflow: 'visible', position: 'relative', zIndex: 0 }}>
                <FitText>{supplier.president}</FitText>
                {supplier.stamp ? (
                  <span style={{ position: 'relative', display: 'inline-block', width: '16px', height: '16px', flexShrink: 0 }}>
                    <img src={supplier.stamp} alt="도장" style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-60%, -50%)',
                      width: '40px',
                      height: '40px',
                      objectFit: 'contain',
                      zIndex: -1,
                    }} />
                  </span>
                ) : (
                  <span className="stamp-placeholder" style={{ flexShrink: 0 }}>(인)</span>
                )}
              </td>
              <th>상호</th>
              <td><FitText>{receiver.name}</FitText></td>
              <th style={{ width: '40px' }}>대표</th>
              <td style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <FitText>{receiver.president}</FitText>
                <span style={{ flexShrink: 0 }}>(인)</span>
              </td>
            </tr>
            <tr>
              <th>주소</th>
              <td colSpan="3"><FitText>{supplier.address}</FitText></td>
              <th>주소</th>
              <td colSpan="3"><FitText>{receiver.address}</FitText></td>
            </tr>
            <tr>
              <th>업태</th>
              <td><FitText>{supplier.businessType}</FitText></td>
              <th>종목</th>
              <td><FitText>{supplier.businessItem}</FitText></td>
              <th>업태</th>
              <td><FitText>{receiver.businessType}</FitText></td>
              <th>종목</th>
              <td><FitText>{receiver.businessItem}</FitText></td>
            </tr>
          </tbody>
        </table>

        <table className="items-table">
          <thead>
            <tr>
              <th style={{ width: '8%' }}>날짜</th>
              <th style={{ width: '25%' }}>품목</th>
              <th style={{ width: '15%' }}>규격</th>
              <th style={{ width: '6%' }}>단위</th>
              <th style={{ width: '8%' }}>수량</th>
              <th style={{ width: '10%' }}>단가</th>
              <th style={{ width: '12%' }}>공급가액</th>
              <th style={{ width: '10%' }}>세액</th>
              <th style={{ width: '6%' }}>비고</th>
            </tr>
          </thead>
          <tbody>
            {displayItems.map((item, index) => {
              let showDate = true;
              if (index > 0 && item.date && item.date === displayItems[index - 1].date) {
                showDate = false;
              }
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

        <table className="summary-table">
          <tbody>
            <tr>
              <th style={{ width: '8%' }}>미수금</th>
              <td style={{ width: '8%' }}></td>
              <th style={{ width: '10%' }}>금액</th>
              <td className="text-right" style={{ width: '15%' }}><FitText>{formatCurrency(pageSupply)}</FitText></td>
              <th style={{ width: '10%' }}>세액</th>
              <td className="text-right" style={{ width: '10%' }}><FitText>{formatCurrency(pageTax)}</FitText></td>
              <th style={{ width: '10%' }}>합계</th>
              <td className="text-right" style={{ width: '15%' }}><FitText>{formatCurrency(pageTotal)}</FitText></td>
              <th style={{ width: '7%' }}>인수자</th>
              <td className="text-center" style={{ width: '7%' }}>(인)</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div ref={ref}>
      {pages.map((pageItems, pageIndex) => (
        <div key={pageIndex} className="print-container" style={{ pageBreakAfter: pageIndex < pages.length - 1 ? 'always' : 'auto' }}>
          {renderHalf('receiver', pageItems, pageIndex === pages.length - 1)}
          <div className="statement-divider" />
          {renderHalf('supplier', pageItems, pageIndex === pages.length - 1)}
        </div>
      ))}
    </div>
  );
});

export default TransactionPrintTemplate;

