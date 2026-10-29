// 인쇄 양식의 칸 폭과 작성일자 표기. 인쇄 양식(TransactionPrintTemplate)과 엑셀 양식 시트(excelViewWriter)가 같이 쓴다.
import { toDateKey } from './dateRange';

export function formatStatementDate(date) {
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
export const HALF_COLS_MM = [7.7, 14.5, 29.9, 6.0, 4.5, 6.1, 26.3];
export const INFO_COLS_MM = [...HALF_COLS_MM, ...HALF_COLS_MM];
export const INFO_TOTAL_MM = INFO_COLS_MM.reduce((sum, w) => sum + w, 0);
// 품목 칸: 날짜 품목 규격 단위 수량 단가 공급가액 세액 비고 (%)
export const ITEM_COLS = [6.89, 26.10, 17.01, 3.96, 7.62, 9.53, 11.73, 9.38, 7.77];
// 합계 줄: 미수금 (값) 금액 (값) 세액 (값) 합계 (값) 인수자·(인) (%)
export const SUM_COLS = [6.89, 15.69, 4.84, 15.10, 4.84, 14.22, 4.84, 16.42, 17.16];
