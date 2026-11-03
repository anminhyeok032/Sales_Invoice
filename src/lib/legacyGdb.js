// 기존 거래명세서 프로그램의 데이터 파일(Tradetax.gdb)을 앱에서 바로 읽는다 — 파이썬이나 Firebird 없이.
//
// Tradetax.gdb는 InterBase 6 / Firebird 1.x(ODS 10) 데이터베이스 파일이다. 디스크에 적힌 페이지 구조를 직접
// 풀어서 표를 읽는다(tools/gdb/gdbreader.py를 옮긴 것, 같은 결과를 낸다). 그 표들에서 앱이 쓰는 모양
// (거래명세서 + 품목 줄 + 거래처)을 만든다(tools/gdb/export_tradetax.py의 앱용 파일과 같은 모양).
//
// 이 파일은 다른 앱 코드를 가져다 쓰지 않는다 — node로 파이썬 결과와 대조 시험을 하기 쉽게.

const DP_HEADER = 24;   // pag(16) + dpg_sequence(4) + dpg_relation(2) + dpg_count(2)
const RHD_LEN = 13;     // transaction(4) b_page(4) b_line(2) flags(2) format(1)
const RHDF_LEN = 19;    // + f_page(4) f_line(2)
const F_DELETED = 1, F_CHAIN = 2, F_FRAGMENT = 4, F_INCOMPLETE = 8, F_BLOB = 16;

// Firebird SQZ_decompress: 끝 표시가 아니라 저장된 길이만큼 푼다. 제어 바이트는 부호 있는 수 —
// 양수 = 그만큼 그대로, 음수 = 다음 바이트를 그만큼 반복, 0 = 빈 구간(끝이 아님).
function rleDecompress(buf) {
  const out = [];
  let i = 0;
  const n = buf.length;
  while (i < n) {
    const c = buf[i];
    i += 1;
    if (c < 128) {
      for (let k = 0; k < c && i + k < n; k += 1) out.push(buf[i + k]);
      i += c;
    } else {
      if (i >= n) break;
      const v = buf[i];
      for (let k = 0; k < 256 - c; k += 1) out.push(v);
      i += 1;
    }
  }
  return Uint8Array.from(out);
}

const concat = (a, b) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
};

class GdbReader {
  constructor(buffer, charset = 'euc-kr') {
    this.d = new Uint8Array(buffer);
    this.v = new DataView(this.d.buffer, this.d.byteOffset, this.d.byteLength);
    if (this.d[0] !== 1 || this.v.getUint16(2, true) !== 12345) {
      throw new Error('기존 프로그램 데이터 파일(.gdb)이 아닙니다.');
    }
    // CP949(한글 윈도우). 브라우저의 'euc-kr'은 CP949 전체를 다룬다.
    this.strict = new TextDecoder(charset, { fatal: true });
    this.loose = new TextDecoder(charset);
    this.pageSize = this.v.getUint16(16, true);
    this.npages = Math.floor(this.d.length / this.pageSize);
    this.maxRecords = Math.floor((this.pageSize - DP_HEADER) / (4 + RHD_LEN));
    this.indexPages();
    this.formats = new Map();   // `${rel}:${fmt}` -> descs
    this.loadFormats();
    this.loadSchema();
  }

  // ---------------- pages ----------------
  page(p) { return this.d.subarray(p * this.pageSize, (p + 1) * this.pageSize); }
  u16(b, o) { return b[o] | (b[o + 1] << 8); }
  u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000; }

  indexPages() {
    this.dp = new Map();   // rel -> Map(seq -> page)
    for (let p = 0; p < this.npages; p += 1) {
      const b = this.page(p);
      if (b[0] !== 5) continue;
      const seq = this.u32(b, 16);
      const rel = this.u16(b, 20);
      if (!this.dp.has(rel)) this.dp.set(rel, new Map());
      this.dp.get(rel).set(seq, p);
    }
  }

  slot(rel, seq, line) {
    const p = this.dp.get(rel)?.get(seq);
    if (p === undefined) return null;
    const b = this.page(p);
    if (line >= this.u16(b, 22)) return null;
    const off = this.u16(b, DP_HEADER + line * 4);
    const len = this.u16(b, DP_HEADER + line * 4 + 2);
    return off && len ? b.subarray(off, off + len) : null;
  }

  // ---------------- records ----------------
  assemble(raw) {
    const flags = this.u16(raw, 10);
    if (!(flags & F_INCOMPLETE)) return rleDecompress(raw.subarray(RHD_LEN));
    let out = rleDecompress(raw.subarray(RHDF_LEN));
    let fPage = this.u32(raw, RHD_LEN);
    let fLine = this.u16(raw, RHD_LEN + 4);
    for (let guard = 0; guard < 4096 && fPage; guard += 1) {
      const b = this.page(fPage);
      if (b[0] !== 5 || fLine >= this.u16(b, 22)) break;
      const off = this.u16(b, DP_HEADER + fLine * 4);
      const len = this.u16(b, DP_HEADER + fLine * 4 + 2);
      if (!off || !len) break;
      const fr = b.subarray(off, off + len);
      if (this.u16(fr, 10) & F_INCOMPLETE) {
        out = concat(out, rleDecompress(fr.subarray(RHDF_LEN)));
        fPage = this.u32(fr, RHD_LEN);
        fLine = this.u16(fr, RHD_LEN + 4);
      } else {
        out = concat(out, rleDecompress(fr.subarray(RHD_LEN)));
        break;
      }
    }
    return out;
  }

  // 지금 보이는 줄만: 예전 판(chain), 쪼개진 꼬리(fragment), blob 저장, 지운 것은 건너뛴다.
  * rawRecords(rel) {
    const pages = this.dp.get(rel);
    if (!pages) return;
    for (const seq of [...pages.keys()].sort((a, b) => a - b)) {
      const b = this.page(pages.get(seq));
      const cnt = this.u16(b, 22);
      for (let line = 0; line < cnt; line += 1) {
        const off = this.u16(b, DP_HEADER + line * 4);
        const len = this.u16(b, DP_HEADER + line * 4 + 2);
        if (!off || len < RHD_LEN) continue;
        const raw = b.subarray(off, off + len);
        if (this.u16(raw, 10) & (F_DELETED | F_BLOB | F_FRAGMENT | F_CHAIN)) continue;
        yield { format: raw[12], data: this.assemble(raw) };
      }
    }
  }

  // ---------------- blobs ----------------
  blob(bidRel, bidNum) {
    if (!bidRel && !bidNum) return null;
    const raw = this.slot(bidRel, Math.floor(bidNum / this.maxRecords), bidNum % this.maxRecords);
    if (!raw) return null;
    const level = raw[12];
    const length = this.u32(raw, 20);
    const parts = [];
    let total = 0;
    if (level === 0) {
      let i = 28;
      while (i + 2 <= raw.length && total < length) {
        const sl = this.u16(raw, i);
        i += 2;
        const seg = raw.subarray(i, i + sl);
        parts.push(seg);
        total += seg.length;
        i += sl;
      }
    } else {
      let i = 28;
      while (i + 4 <= raw.length && total < length) {
        const pg = this.u32(raw, i);
        i += 4;
        if (!pg) continue;
        const b = this.page(pg);
        if (b[0] !== 8) continue;
        let j = 28;
        const end = 28 + this.u16(b, 24);
        while (j + 2 <= end) {
          const sl = this.u16(b, j);
          j += 2;
          const seg = b.subarray(j, j + sl);
          parts.push(seg);
          total += seg.length;
          j += sl;
        }
      }
    }
    const out = new Uint8Array(total);
    let at = 0;
    parts.forEach((p) => { out.set(p, at); at += p.length; });
    return level === 0 ? out : out.subarray(0, length);
  }

  // ---------------- formats ----------------
  loadFormats() {
    for (const { data } of this.rawRecords(8)) {   // RDB$FORMATS
      if (data.length < 16) continue;
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const rel = dv.getInt16(4, true);
      const fmt = dv.getInt16(6, true);
      const b = this.blob(dv.getUint32(8, true), dv.getUint32(12, true));
      if (!b || b.length % 12 !== 0) continue;
      const bv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const descs = [];
      for (let i = 0; i < b.length; i += 12) {
        descs.push({
          dtype: bv.getUint8(i), scale: bv.getInt8(i + 1), length: bv.getUint16(i + 2, true),
          subtype: bv.getInt16(i + 4, true), flags: bv.getUint16(i + 6, true), offset: bv.getUint32(i + 8, true),
          name: null,
        });
      }
      this.formats.set(`${rel}:${fmt}`, descs);
    }
  }

  formatsOf(rel) {
    return [...this.formats.keys()].map((k) => k.split(':').map(Number)).filter(([r]) => r === rel).map(([, f]) => f);
  }

  descs(rel, fmt = 0) {
    const exact = this.formats.get(`${rel}:${fmt}`);
    if (exact) return exact;
    const cand = this.formatsOf(rel).sort((a, b) => a - b);
    if (!cand.length) return null;
    const lower = cand.filter((c) => c <= fmt);
    return this.formats.get(`${rel}:${lower.length ? lower[lower.length - 1] : cand[0]}`);
  }

  // ---------------- values ----------------
  text(raw) {
    let end = raw.length;
    while (end > 0 && raw[end - 1] === 0) end -= 1;
    while (end > 0 && raw[end - 1] === 0x20) end -= 1;
    const bytes = raw.subarray(0, end);
    if (!bytes.length) return '';
    if (bytes.every((c) => c < 128)) return String.fromCharCode(...bytes);
    try { return this.strict.decode(bytes); } catch { /* 아래에서 다시 */ }
    // 기존 프로그램이 글자 수 제한에서 한글 한 글자를 반쯤 잘라 저장한 값이 있다. 깨진 글자 대신 잘린 바이트를 버린다.
    for (let k = 1; k <= 4; k += 1) {
      try { return this.strict.decode(bytes.subarray(0, bytes.length - k)); } catch { /* 한 바이트 더 */ }
    }
    return this.loose.decode(bytes);
  }

  value(data, d) {
    const o = d.offset;
    const t = d.dtype;
    const L = d.length;
    if (o + L > data.length) return null;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (t === 1 || t === 2) {
      let raw = data.subarray(o, o + L);
      if (t === 2) { const z = raw.indexOf(0); if (z >= 0) raw = raw.subarray(0, z); }
      return this.text(raw);
    }
    if (t === 3) {
      const n = dv.getUint16(o, true);
      return this.text(data.subarray(o + 2, o + 2 + Math.min(n, L - 2)));
    }
    if (t === 11) return dv.getFloat32(o, true);
    if (t === 12 || t === 13) return dv.getFloat64(o, true);
    if (t === 17) return [dv.getUint32(o, true), dv.getUint32(o + 4, true)];
    if (t === 14 || t === 16 || t === 27) {
      // 1858-11-17부터 날 수 + 1/10000초. 앱이 쓰는 칸에는 없지만 표를 다 읽을 수 있게.
      const days = dv.getInt32(o, true);
      const frac = dv.getInt32(o + 4, true);
      return new Date(Date.UTC(1858, 10, 17) + days * 86400000 + frac / 10);
    }
    if (t === 15) return dv.getUint32(o, true) / 10000;
    let v;
    if (t === 7) v = dv.getInt8(o);
    else if (t === 8) v = dv.getInt16(o, true);
    else if (t === 9) v = dv.getInt32(o, true);
    else if (t === 19 || t === 10) v = Number(dv.getBigInt64(o, true));
    else return data.subarray(o, o + L);
    if (d.scale < 0) return v / 10 ** -d.scale;
    if (d.scale > 0) return v * 10 ** d.scale;
    return v;
  }

  // ---------------- schema ----------------
  loadSchema() {
    this.relName = new Map();
    this.relations = new Map();
    const ds6 = this.descs(6);   // RDB$RELATIONS
    for (const { data } of this.rawRecords(6)) {
      const rid = this.value(data, ds6[3]);
      const nm = this.value(data, ds6[8]);
      if (Number.isInteger(rid) && nm) {
        this.relName.set(rid, nm);
        this.relations.set(nm, rid);
      }
    }
    const ds5 = this.descs(5);   // RDB$RELATION_FIELDS
    const raw5 = [...this.rawRecords(5)].map((r) => r.data);
    // RDB$FIELD_POSITION = 표마다 0..n-1을 이루는 SMALLINT 칸
    let posIdx = null;
    for (const si of ds5.map((x, i) => (x.dtype === 8 ? i : -1)).filter((i) => i >= 0)) {
      const groups = new Map();
      raw5.forEach((data) => {
        const k = this.value(data, ds5[1]);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(this.value(data, ds5[si]));
      });
      const ok = [...groups.values()].every((v) => v.slice().sort((a, b) => a - b).every((x, i) => x === i));
      if (ok) { posIdx = si; break; }
    }
    if (posIdx === null) return;
    const colnames = new Map();
    raw5.forEach((data) => {
      const fn = this.value(data, ds5[0]);
      const rid = this.relations.get(this.value(data, ds5[1]));
      if (rid === undefined) return;
      if (!colnames.has(rid)) colnames.set(rid, new Map());
      colnames.get(rid).set(this.value(data, ds5[posIdx]), fn);
    });
    colnames.forEach((cols, rid) => {
      this.formatsOf(rid).forEach((f) => {
        this.formats.get(`${rid}:${f}`).forEach((d, i) => { d.name = cols.get(i) ?? null; });
      });
    });
  }

  rows(relName) {
    const rel = this.relations.get(relName);
    if (rel === undefined) throw new Error(`데이터 파일에 ${relName} 표가 없습니다.`);
    const out = [];
    for (const { format, data } of this.rawRecords(rel)) {
      const ds = this.descs(rel, format);
      if (!ds) continue;
      const nbytes = Math.min(...ds.map((d) => d.offset));
      const row = {};
      ds.forEach((d, i) => {
        const key = d.name || `F${i + 1}`;
        const isNull = data.length >= nbytes && (data[i >> 3] >> (i & 7)) & 1;
        if (isNull) { row[key] = null; return; }
        let v = this.value(data, d);
        if (d.dtype === 17 && Array.isArray(v)) {
          const b = this.blob(v[0], v[1]);
          v = b ? (d.subtype === 1 ? this.text(b) : b) : null;
        }
        row[key] = v;
      });
      out.push(row);
    }
    return out;
  }
}

// '2021.10.30' -> '2021-10-30'. 그 밖은 그대로.
function normDate(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : (s || '');
}

const byKey = (fn) => (a, b) => {
  const x = fn(a);
  const y = fn(b);
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] < y[i]) return -1;
    if (x[i] > y[i]) return 1;
  }
  return 0;
};

// Tradetax.gdb 내용 -> 앱이 가져오는 모양 { format, transactions, companies }
// (export_tradetax.py가 만들던 tradetax-import.json과 같다. 명세서 제목 TRADFLST.JKYU도 같이.)
export function readTradetaxGdb(buffer, sourceName = 'Tradetax.gdb') {
  const db = new GdbReader(buffer);

  const lines = new Map();
  db.rows('RDESLST').forEach((r) => {
    if (!lines.has(r.JPNO)) lines.set(r.JPNO, []);
    lines.get(r.JPNO).push(r);
  });
  const headers = db.rows('TRADFLST').sort(byKey((r) => [r.IDAY || '', r.JPNO || '']));
  const transactions = headers.map((h) => {
    const date = normDate(h.IDAY);
    const [y, m] = date.length === 10 ? [date.slice(0, 4), date.slice(5, 7)] : ['', ''];
    const items = (lines.get(h.JPNO) || []).slice().sort((a, b) => (a.ORDRF || 0) - (b.ORDRF || 0));
    return {
      id: `gdb-${h.JPNO}`,
      year: /^\d+$/.test(y) ? Number(y) : 0,
      month: /^\d+$/.test(m) ? Number(m) : 0,
      companyName: h.SANGHO || '',
      date,
      // 기존 프로그램에서 직접 쓰던 제목. 앱에서는 명세서 제목이 된다(목록에 보이고 '제목·내용' 검색으로 찾음).
      title: String(h.JKYU || '').trim(),
      items: items.map((i) => ({
        date: i.MDAY || '', name: i.PNAME || '', spec: i.PSTAN || '',
        unit: i.PUNIT || '', qty: i.INO || 0, price: i.ICOST || 0,
        supply: i.IMNY || 0, tax: i.IVAT || 0, note: i.ETC || '',
      })),
    };
  });

  const companies = db.rows('CUSTOMER')
    .sort(byKey((r) => [r.HCD || 0, r.MCD || 0]))
    .map((c) => ({
      id: `gdb-${c.HCD}-${c.MCD}`, name: c.SANGHO,
      president: c.MNAME || '', regNo: c.BSNO || '',
      businessType: c.UPTEA || '', businessItem: c.UPJOG || '',
      address: c.ADDR || '', phone: c.MTEL || '',
    }));

  return {
    format: 'tradetax-gdb-import',
    generatedAt: new Date().toISOString(),
    source: sourceName,
    transactions,
    companies,
  };
}
