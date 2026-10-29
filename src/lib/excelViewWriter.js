// 엑셀 파일 쓰기 (ExcelJS). 값 계산은 excelView.js / statementView.js가 하고, 여기서는 서식만 입힌다.
//
//  · buildViewWorkbook(state)   : 저장된 내역 전체 — 목록 / 품목 / 합친 원본 / 거래처 / 공급자 시트
//  · buildStatementWorkbook(...) : 명세서 한 건을 인쇄 양식 모양 그대로(A4, 보관용 2장, 12줄씩 장 나눔)
//
// 모두 보기 전용 사본이다. 엑셀에서 고친 내용은 앱으로 돌아오지 않는다.
import ExcelJS from 'exceljs';
import { buildExcelView, MERGE_MODE_LABEL } from './excelView';
import { PRINT_ROWS_PER_PAGE, itemDateLabel, computeTotals } from './transactionItems';
import { printedNotes, printedUnit } from './statementView';
import { HALF_COLS_MM, ITEM_COLS, SUM_COLS, formatStatementDate } from './printLayout';

const READ_ONLY_NOTE = '보기 전용 — 여기서 고쳐도 앱에 반영되지 않습니다. 원본은 앱과 JSON 백업입니다.';
const FONT = 'Malgun Gothic';
const MONEY = '#,##0';
const DATE = 'yyyy.mm.dd';

const nowText = (d = new Date()) => d.toLocaleString('ko-KR');
// 비고처럼 글자 칸에 숫자만 든 값(일별 합계 '35' 등)은 숫자로 넣는다 — 글자로 넣으면 엑셀이
// "텍스트로 저장된 숫자" 표시(녹색 삼각형)를 붙인다.
const textOrNumber = (v) => (typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : v);

// ---------------------------------------------------------------- 보기 파일

const VIEW_SHEETS = {
  list: {
    name: '목록',
    columns: [
      { key: 'date', header: '작성일자', width: 12, numFmt: DATE },
      { key: 'summary', header: '내용', width: 36 },
      { key: 'name', header: '상호명', width: 26 },
      { key: 'supply', header: '금액', width: 14, numFmt: MONEY, sum: true },
      { key: 'tax', header: '세액', width: 11, numFmt: MONEY, sum: true },
      { key: 'total', header: '합계', width: 14, numFmt: MONEY, sum: true },
      { key: 'lines', header: '줄 수', width: 7, numFmt: MONEY, sum: true },
      { key: 'pages', header: '장 수', width: 7, numFmt: MONEY },
      { key: 'supplier', header: '공급자', width: 20 },
      { key: 'origin', header: '구분', width: 14 },
      { key: 'id', header: '명세서 ID', width: 22 },
    ],
  },
  items: {
    name: '품목',
    columns: [
      { key: 'txDate', header: '작성일자', width: 12, numFmt: DATE },
      { key: 'name', header: '상호명', width: 24 },
      { key: 'no', header: 'No', width: 5 },
      { key: 'date', header: '날짜', width: 9 },
      { key: 'itemName', header: '품목', width: 34 },
      { key: 'spec', header: '규격', width: 14 },
      { key: 'unit', header: '단위', width: 6 },
      { key: 'qty', header: '수량', width: 8, numFmt: MONEY, sum: true },
      { key: 'price', header: '단가', width: 11, numFmt: MONEY },
      { key: 'supply', header: '공급가액', width: 13, numFmt: MONEY, sum: true },
      { key: 'tax', header: '세액', width: 10, numFmt: MONEY, sum: true },
      { key: 'printedNote', header: '비고(인쇄)', width: 12 },
      { key: 'memo', header: '메모', width: 12 },
      { key: 'kind', header: '구분', width: 8 },
      { key: 'time', header: '가공시간', width: 10 },
      { key: 'mergedCount', header: '합친 줄 수', width: 9, numFmt: '0;-0;' },
      { key: 'id', header: '명세서 ID', width: 22 },
    ],
  },
  merged: {
    name: '합친 원본',
    columns: [
      { key: 'name', header: '상호명', width: 24 },
      { key: 'no', header: '대표 줄 No', width: 9 },
      { key: 'order', header: '원본 순서', width: 9 },
      { key: 'date', header: '날짜', width: 9 },
      { key: 'itemName', header: '품목', width: 34 },
      { key: 'spec', header: '규격', width: 14 },
      { key: 'qty', header: '수량', width: 8, numFmt: MONEY },
      { key: 'price', header: '단가', width: 11, numFmt: MONEY },
      { key: 'supply', header: '공급가액', width: 13, numFmt: MONEY },
      { key: 'kind', header: '구분', width: 8 },
      { key: 'time', header: '가공시간', width: 10 },
      { key: 'qtyMode', header: '수량 방식', width: 9, map: MERGE_MODE_LABEL },
      { key: 'timeMode', header: '가공시간 방식', width: 11, map: MERGE_MODE_LABEL },
      { key: 'id', header: '명세서 ID', width: 22 },
    ],
  },
  companies: {
    name: '거래처',
    columns: [
      { key: 'name', header: '상호', width: 28 },
      { key: 'regNo', header: '등록번호', width: 15 },
      { key: 'president', header: '대표자', width: 14 },
      { key: 'businessType', header: '업태', width: 12 },
      { key: 'businessItem', header: '종목', width: 18 },
      { key: 'address', header: '주소', width: 50 },
      { key: 'phone', header: '전화', width: 15 },
    ],
  },
  suppliers: {
    name: '공급자',
    columns: [
      { key: 'name', header: '상호', width: 24 },
      { key: 'regNo', header: '등록번호', width: 15 },
      { key: 'president', header: '대표자', width: 14 },
      { key: 'businessType', header: '업태', width: 12 },
      { key: 'businessItem', header: '종목', width: 18 },
      { key: 'address', header: '주소', width: 44 },
      { key: 'account', header: '계좌번호', width: 36 },
      { key: 'isDefault', header: '기본', width: 6, map: { true: '기본', false: '' } },
    ],
  },
};

const colLetter = (n) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

function addTableSheet(wb, spec, rows, createdAt) {
  const { columns } = spec;
  const ws = wb.addWorksheet(spec.name, { views: [{ state: 'frozen', ySplit: 2 }] });
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width;
    if (c.numFmt) col.numFmt = c.numFmt;
  });

  const note = ws.getCell(1, 1);
  note.value = `${READ_ONLY_NOTE}  (만든 시각 ${createdAt})`;
  note.font = { name: FONT, size: 9, color: { argb: 'FFB45309' } };
  ws.mergeCells(1, 1, 1, columns.length);

  const header = ws.getRow(2);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: FONT, bold: true, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };
  });

  rows.forEach((r) => {
    const row = ws.addRow(columns.map((c) => {
      let v = r[c.key];
      if (c.key === 'date' && v == null && r.dateText !== undefined) v = r.dateText;   // 날짜로 못 읽은 작성일자
      if (c.map) v = c.map[String(v)] ?? v;
      if (c.key === 'printedNote' || c.key === 'memo') v = textOrNumber(v);
      return v ?? '';
    }));
    row.font = { name: FONT, size: 10 };
  });

  const first = 3;
  const last = 2 + rows.length;
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: Math.max(2, last), column: columns.length } };

  // 맨 아래 합계 줄: SUBTOTAL(109)이라 엑셀에서 필터를 걸면 보이는 줄만 더한다(앱의 "조회 매출" 합계와 같다).
  if (columns.some((c) => c.sum) && rows.length) {
    const totalRow = ws.getRow(last + 2);
    totalRow.getCell(1).value = '합계 (필터에 보이는 줄만)';
    columns.forEach((c, i) => {
      if (!c.sum) return;
      const L = colLetter(i + 1);
      const result = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
      const cell = totalRow.getCell(i + 1);
      cell.value = { formula: `SUBTOTAL(109,${L}${first}:${L}${last})`, result };
      cell.numFmt = c.numFmt || MONEY;
    });
    totalRow.font = { name: FONT, bold: true, size: 10 };
    totalRow.eachCell((cell) => {
      cell.border = { top: { style: 'thin', color: { argb: 'FF475569' } } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCFFAFE' } };
    });
  }
  return ws;
}

export function buildViewWorkbook(state) {
  const view = buildExcelView(state);
  const wb = new ExcelJS.Workbook();
  wb.creator = '거래명세서 자동 관리';
  wb.created = new Date();
  const createdAt = nowText();
  addTableSheet(wb, VIEW_SHEETS.list, view.list, createdAt);
  addTableSheet(wb, VIEW_SHEETS.items, view.items, createdAt);
  addTableSheet(wb, VIEW_SHEETS.merged, view.merged, createdAt);
  addTableSheet(wb, VIEW_SHEETS.companies, view.companies, createdAt);
  addTableSheet(wb, VIEW_SHEETS.suppliers, view.suppliers, createdAt);
  return wb;
}

// ---------------------------------------------------------------- 명세서 양식 시트
// 인쇄 양식(TransactionPrintTemplate)의 칸 폭(mm)을 그대로 엑셀 열로 옮긴다. 공급자/공급받는자 표,
// 품목 표, 합계 줄은 칸 나누는 자리가 서로 달라서, 세 표의 경계를 모두 모은 잘게 나눈 열 위에
// 각 칸을 병합해서 놓는다.

const FRAME_MM = 190;
const FORM = { receiver: 'FF000080', supplier: 'FFFF0000' };
const SUM_FILL = { receiver: 'FFE6E6F2', supplier: 'FFFFE6E6' };   // 양식 색 10% + 흰색 90% (화면과 같음)
const BLACK = 'FF000000';

const cumulative = (widths, total) => {
  const sum = widths.reduce((a, b) => a + b, 0);
  let acc = 0;
  return [0, ...widths.map((w) => { acc += w; return (acc / sum) * total; })];
};

function buildGrid() {
  const info = cumulative([...HALF_COLS_MM, ...HALF_COLS_MM], FRAME_MM);
  const items = cumulative(ITEM_COLS, FRAME_MM);
  const sums = cumulative(SUM_COLS, FRAME_MM);
  // 0.6mm보다 가까운 경계는 하나로 본다(너무 좁은 열이 생기지 않게).
  const all = [...info, ...items, ...sums].sort((a, b) => a - b);
  const bounds = [];
  all.forEach((x) => { if (!bounds.length || x - bounds[bounds.length - 1] > 0.6) bounds.push(x); });
  bounds[bounds.length - 1] = FRAME_MM;
  const at = (x) => bounds.reduce((best, b, i) => (Math.abs(b - x) < Math.abs(bounds[best] - x) ? i : best), 0);
  // 각 표의 칸 i는 열 [start, end) — 엑셀 열 번호는 1부터
  const spans = (cuts) => cuts.slice(0, -1).map((x, i) => [at(x) + 1, at(cuts[i + 1])]);
  return { bounds, info: spans(info), items: spans(items), sums: spans(sums) };
}

const mmToWidth = (mm) => Math.max(0.3, (mm * 3.7795 - 5) / 7);   // 엑셀 열 폭 단위(기본 글꼴 문자 폭) 근사
const mmToPt = (mm) => mm * 2.835;

export function buildStatementWorkbook({ tx, items, supplier, receiver, printOptions, stampPng }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = '거래명세서 자동 관리';
  const ws = wb.addWorksheet('명세서', { views: [{ showGridLines: false }] });
  const grid = buildGrid();
  const nCols = grid.bounds.length - 1;
  grid.bounds.slice(1).forEach((b, i) => { ws.getColumn(i + 1).width = mmToWidth(b - grid.bounds[i]); });

  ws.pageSetup = {
    paperSize: 9, orientation: 'portrait', horizontalCentered: true,
    fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.2, right: 0.2, top: 0.2, bottom: 0.2, header: 0, footer: 0 },
  };

  const rowHeightsMm = [];   // 도장 위치 계산용
  let r = 0;
  const newRow = (heightMm) => { r += 1; ws.getRow(r).height = mmToPt(heightMm); rowHeightsMm[r] = heightMm; return r; };

  const thin = (argb) => ({ style: 'thin', color: { argb } });
  const box = (argb) => ({ top: thin(argb), left: thin(argb), bottom: thin(argb), right: thin(argb) });
  const put = (row, [c1, c2], value, { color = BLACK, size = 9, bold = false, align = 'left', border, fill, rows = 1, vertical, numFmt, shrink = true } = {}) => {
    if (c2 < c1) c2 = c1;
    if (c2 > c1 || rows > 1) ws.mergeCells(row, c1, row + rows - 1, c2);
    const cell = ws.getCell(row, c1);
    cell.value = value === '' || value == null ? null : value;
    cell.font = { name: FONT, size, bold, color: { argb: color } };
    cell.alignment = { horizontal: align, vertical: 'middle', shrinkToFit: shrink, textRotation: vertical ? 'vertical' : undefined };
    if (numFmt) cell.numFmt = numFmt;
    for (let rr = row; rr < row + rows; rr += 1) {
      for (let cc = c1; cc <= c2; cc += 1) {
        const c = ws.getCell(rr, cc);
        if (border) c.border = border;
        if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      }
    }
    return cell;
  };
  // 굵은 바깥 테두리
  const outline = (r1, r2, argb) => {
    const med = { style: 'medium', color: { argb } };
    for (let rr = r1; rr <= r2; rr += 1) {
      for (let cc = 1; cc <= nCols; cc += 1) {
        const c = ws.getCell(rr, cc);
        const b = { ...(c.border || {}) };
        if (rr === r1) b.top = med;
        if (rr === r2) b.bottom = med;
        if (cc === 1) b.left = med;
        if (cc === nCols) b.right = med;
        c.border = b;
      }
    }
  };

  const span = (from, to) => [grid.info[from][0], grid.info[to][1]];   // 공급자/공급받는자 표의 칸 from~to
  const account = String(supplier?.account || '').trim();
  const notes = printedNotes(items, printOptions);
  const enhanced = items.map((it, i) => ({ ...it, _note: notes[i] }));
  const pages = [];
  for (let i = 0; i < enhanced.length; i += PRINT_ROWS_PER_PAGE) pages.push(enhanced.slice(i, i + PRINT_ROWS_PER_PAGE));
  if (!pages.length) pages.push([]);
  const printedDate = formatStatementDate(tx.date);
  const money = (v) => (Number(v) ? Number(v) : null);
  const stampSpots = [];

  const half = (type, pageItems) => {
    const form = FORM[type];
    const b = box(form);
    // 제목 / No. / 보관용 / 작성일자
    const t = newRow(8);
    put(t, [1, nCols], '거 래 명 세 표', { color: form, size: 16, bold: true, align: 'center', shrink: false });
    ws.getCell(t, 1).font = { name: FONT, size: 16, bold: true, color: { argb: form }, underline: 'double' };
    const s = newRow(5.5);
    const third = Math.floor(nCols / 3);
    put(s, [1, Math.max(1, Math.floor(nCols * 0.18))], 'No.', { color: form, size: 11, bold: true, border: { bottom: thin(form) } });
    put(s, [third + 1, nCols - third], type === 'receiver' ? '(공급받는자 보관용)' : '(공급자 보관용)', { color: form, size: 8, align: 'center' });
    const dateCell = put(s, [Math.ceil(nCols * 0.7), nCols], null, { align: 'right', fill: 'FFECEEF3' });
    dateCell.value = { richText: [
      { text: '작성일자 ', font: { name: FONT, size: 9, color: { argb: form } } },
      { text: printedDate, font: { name: FONT, size: 9, color: { argb: BLACK } } },
    ] };

    // 공급자 / 공급받는자 (4줄)
    const top = newRow(7.8);
    newRow(7.8); newRow(7.8); newRow(7.8);
    const party = (side, p) => {
      const o = side === 'L' ? 0 : 7;
      put(top, span(o, o), side === 'L' ? '공급자' : '공급받는자', { color: form, align: 'center', border: b, rows: 4, vertical: true, shrink: false });
      put(top, span(o + 1, o + 1), '등록번호', { color: form, align: 'center', border: b });
      put(top, span(o + 2, o + 6), p.regNo || '', { size: 11, bold: true, align: 'center', border: b });
      put(top + 1, span(o + 1, o + 1), '상  호', { color: form, align: 'center', border: b });
      put(top + 1, span(o + 2, o + 3), p.name || '', { border: b });
      put(top + 1, span(o + 4, o + 5), '대 표', { color: form, align: 'center', border: b });
      put(top + 1, span(o + 6, o + 6), `${p.president || ''}(인)`, { border: b });
      put(top + 2, span(o + 1, o + 1), '주  소', { color: form, align: 'center', border: b });
      put(top + 2, span(o + 2, o + 6), p.address || '', { border: b });
      put(top + 3, span(o + 1, o + 1), '업  태', { color: form, align: 'center', border: b });
      put(top + 3, span(o + 2, o + 2), p.businessType || '', { border: b });
      put(top + 3, span(o + 3, o + 4), '종 목', { color: form, align: 'center', border: b });
      put(top + 3, span(o + 5, o + 6), p.businessItem || '', { border: b });
    };
    party('L', supplier || {});
    party('R', receiver || {});
    // 도장: 공급자 대표 칸 오른쪽 끝(1mm 넘침)에 16.5mm, 그 줄 세로 가운데 — 인쇄 양식(.st-stamp)과 같다
    const presidentRightMm = grid.bounds[grid.info[6][1]];
    const rowTopMm = rowHeightsMm.slice(1, top + 1).reduce((a, h) => a + (h || 0), 0);
    stampSpots.push({ xMm: presidentRightMm + 1 - 16.5, yMm: rowTopMm + 3.9 - 16.5 / 2 });

    // 품목
    const head = newRow(5.6);
    ['날짜', '품    목', '규    격', '단위', '수 량', '단 가', '공급가액', '세 액', '비 고'].forEach((h, i) => {
      put(head, grid.items[i], h, { color: form, align: 'center', border: b });
    });
    for (let k = 0; k < PRINT_ROWS_PER_PAGE; k += 1) {
      const it = pageItems[k] || {};
      const prev = pageItems[k - 1];
      const showDate = !(k > 0 && it.date && prev && it.date === prev.date);
      const row = newRow(6.15);
      put(row, grid.items[0], showDate ? itemDateLabel(it.date) : '', { align: 'center', border: b });
      put(row, grid.items[1], it.name || '', { border: b });
      put(row, grid.items[2], it.spec || '', { border: b });
      put(row, grid.items[3], printedUnit(it.unit), { align: 'center', border: b });
      put(row, grid.items[4], money(it.qty), { align: 'right', border: b, numFmt: MONEY });
      put(row, grid.items[5], money(it.price), { align: 'right', border: b, numFmt: MONEY });
      put(row, grid.items[6], money(it.supply), { align: 'right', border: b, numFmt: MONEY });
      put(row, grid.items[7], money(it.tax), { align: 'right', border: b, numFmt: MONEY });
      put(row, grid.items[8], textOrNumber(it._note || ''), { border: b });
    }

    // 합계 줄 (인수자 칸만 색 없음). 장마다 그 장의 합계 — 인쇄 양식과 같다.
    const { supply, tax } = computeTotals(pageItems);
    const sr = newRow(8.6);
    const fill = SUM_FILL[type];
    const sumCells = ['미수금', null, '금액', supply || null, '세액', tax || null, '합계', (supply + tax) || null];
    sumCells.forEach((v, i) => {
      const label = i % 2 === 0;
      put(sr, grid.sums[i], v, { color: label ? form : BLACK, align: label ? 'center' : 'right', border: b, fill, numFmt: label ? undefined : MONEY });
    });
    put(sr, grid.sums[8], '인수자          (인)', { color: form, border: b });
    outline(top, sr, form);

    if (account) {
      const ar = newRow(4);
      put(ar, [1, Math.ceil(nCols * 0.7)], account, { size: 8 });
    }
  };

  pages.forEach((pageItems, p) => {
    half('receiver', pageItems);
    const gap = newRow(6);
    for (let c = 1; c <= nCols; c += 1) ws.getCell(gap, c).border = { bottom: { style: 'dashed', color: { argb: 'FF999999' } } };
    half('supplier', pageItems);
    if (p < pages.length - 1) ws.getRow(r).addPageBreak();
  });

  // 도장 이미지(있을 때만): 각 보관용의 공급자 대표 칸 위
  if (stampPng) {
    const imageId = wb.addImage({ base64: stampPng, extension: 'png' });
    const colAt = (xMm) => {
      for (let i = 1; i < grid.bounds.length; i += 1) {
        if (xMm <= grid.bounds[i]) return i - 1 + (xMm - grid.bounds[i - 1]) / (grid.bounds[i] - grid.bounds[i - 1]);
      }
      return nCols - 1;
    };
    const rowAt = (yMm) => {
      let acc = 0;
      for (let i = 1; i < rowHeightsMm.length; i += 1) {
        const h = rowHeightsMm[i] || 0;
        if (yMm <= acc + h) return i - 1 + Math.max(0, (yMm - acc) / h);
        acc += h;
      }
      return rowHeightsMm.length - 1;
    };
    stampSpots.forEach(({ xMm, yMm }) => {
      ws.addImage(imageId, { tl: { col: colAt(xMm), row: rowAt(Math.max(0, yMm)) }, ext: { width: 63, height: 63 }, editAs: 'oneCell' });
    });
  }
  return wb;
}

// ---------------------------------------------------------------- 저장 / 내려받기

export async function workbookBuffer(wb) {
  return wb.xlsx.writeBuffer();
}

export async function downloadWorkbook(wb, fileName) {
  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function stamped(prefix, ext, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${prefix}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.${ext}`;
}
