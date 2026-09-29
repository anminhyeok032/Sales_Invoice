# -*- coding: utf-8 -*-
"""
Pure-Python reader for InterBase 6 / Firebird 1.x (ODS 10) .gdb files.
Parses the on-disk page structures directly - no Firebird server or fbclient.dll.
"""
import struct, datetime

DP_HEADER = 24      # pag(16) + dpg_sequence(4) + dpg_relation(2) + dpg_count(2)
RHD_LEN   = 13      # transaction(4) b_page(4) b_line(2) flags(2) format(1)
RHDF_LEN  = 19      # + f_page(4) f_line(2)
F_DELETED, F_CHAIN, F_FRAGMENT, F_INCOMPLETE, F_BLOB = 1, 2, 4, 8, 16

DTYPE = {1: 'CHAR', 2: 'CSTRING', 3: 'VARCHAR', 7: 'BYTE', 8: 'SMALLINT', 9: 'INTEGER',
         10: 'QUAD', 11: 'FLOAT', 12: 'DOUBLE', 13: 'D_FLOAT', 14: 'DATE', 15: 'TIME',
         16: 'TIMESTAMP', 17: 'BLOB', 18: 'ARRAY', 19: 'BIGINT', 27: 'DATE'}
EPOCH = datetime.date(1858, 11, 17)     # modified Julian day 0


def rle_decompress(buf):
    """Firebird SQZ_decompress: driven by the stored record length, not by an
    end marker.  A control byte is a signed char - positive = literal run,
    negative = repeated byte, zero = empty run (NOT end of record)."""
    out = bytearray()
    i, n = 0, len(buf)
    while i < n:
        c = buf[i]
        i += 1
        if c < 128:
            out += buf[i:i + c]
            i += c
        else:
            c = 256 - c
            if i >= n:
                break
            out += bytes((buf[i],)) * c
            i += 1
    return bytes(out)


class Desc:
    __slots__ = ('dtype', 'scale', 'length', 'subtype', 'flags', 'offset', 'name')

    def __init__(self, blob, i):
        (self.dtype, self.scale, self.length, self.subtype,
         self.flags, self.offset) = struct.unpack_from('<BbHhHI', blob, i)
        self.name = None

    def sqltype(self):
        t = DTYPE.get(self.dtype, '?%d' % self.dtype)
        if self.dtype in (1, 2, 3):
            return '%s(%d)' % (t, self.length - (2 if self.dtype == 3 else 0))
        if self.scale:
            return 'NUMERIC(*,%d)' % (-self.scale)
        return t

    def __repr__(self):
        return '%s %s @%d' % (self.name or '?', self.sqltype(), self.offset)


class GDB:
    def __init__(self, path, charset='cp949'):
        self.path, self.charset = path, charset
        self.d = open(path, 'rb').read()
        d = self.d
        if d[0] != 1 or struct.unpack_from('<H', d, 2)[0] != 12345:
            raise ValueError('not an InterBase/Firebird database file')
        self.page_size = struct.unpack_from('<H', d, 16)[0]
        self.ods_major = struct.unpack_from('<H', d, 18)[0] & 0x7FFF
        self.ods_minor = struct.unpack_from('<H', d, 62)[0]
        self.hdr_flags = struct.unpack_from('<H', d, 42)[0]
        self.dialect = 3 if self.hdr_flags & 0x40 else 1
        self.npages = len(d) // self.page_size
        self.max_records = (self.page_size - DP_HEADER) // (4 + RHD_LEN)
        self._index_pages()
        self.formats = {}
        self._load_formats()
        self._load_schema()

    # ---------------- pages ----------------
    def page(self, p):
        return self.d[p * self.page_size:(p + 1) * self.page_size]

    def _index_pages(self):
        self.dp = {}
        for p in range(self.npages):
            b = self.page(p)
            if b[0] != 5:
                continue
            seq, rel = struct.unpack_from('<IH', b, 16)
            self.dp.setdefault(rel, {})[seq] = p

    def _slot(self, rel, seq, line):
        p = self.dp.get(rel, {}).get(seq)
        if p is None:
            return None
        b = self.page(p)
        if line >= struct.unpack_from('<H', b, 22)[0]:
            return None
        off, ln = struct.unpack_from('<HH', b, DP_HEADER + line * 4)
        return b[off:off + ln] if off and ln else None

    # ---------------- records ----------------
    def _assemble(self, raw):
        flags = struct.unpack_from('<H', raw, 10)[0]
        if not flags & F_INCOMPLETE:
            return rle_decompress(raw[RHD_LEN:])
        out = bytearray(rle_decompress(raw[RHDF_LEN:]))
        f_page, f_line = struct.unpack_from('<IH', raw, RHD_LEN)
        for _ in range(4096):
            if not f_page:
                break
            b = self.page(f_page)
            if b[0] != 5 or f_line >= struct.unpack_from('<H', b, 22)[0]:
                break
            off, ln = struct.unpack_from('<HH', b, DP_HEADER + f_line * 4)
            if not off or not ln:
                break
            fr = b[off:off + ln]
            if struct.unpack_from('<H', fr, 10)[0] & F_INCOMPLETE:
                out += rle_decompress(fr[RHDF_LEN:])
                f_page, f_line = struct.unpack_from('<IH', fr, RHD_LEN)
            else:
                out += rle_decompress(fr[RHD_LEN:])
                break
        return bytes(out)

    def raw_records(self, rel):
        for seq in sorted(self.dp.get(rel, {})):
            b = self.page(self.dp[rel][seq])
            cnt = struct.unpack_from('<H', b, 22)[0]
            for line in range(cnt):
                off, ln = struct.unpack_from('<HH', b, DP_HEADER + line * 4)
                if not off or ln < RHD_LEN:
                    continue
                raw = b[off:off + ln]
                flags = struct.unpack_from('<H', raw, 10)[0]
                # rhd_chain = an older MVCC version, rhd_fragment = tail of a
                # split record, rhd_blob = blob storage, rhd_deleted = removed.
                # Only unflagged slots are current, visible rows.
                if flags & (F_DELETED | F_BLOB | F_FRAGMENT | F_CHAIN):
                    continue
                yield seq * self.max_records + line, raw[12], self._assemble(raw)

    # ---------------- blobs ----------------
    def blob(self, bid_rel, bid_num):
        if not bid_rel and not bid_num:
            return None
        raw = self._slot(bid_rel, *divmod(bid_num, self.max_records))
        if raw is None:
            return None
        level = raw[12]
        length = struct.unpack_from('<I', raw, 20)[0]
        out = bytearray()
        if level == 0:
            i = 28
            while i + 2 <= len(raw) and len(out) < length:
                sl = struct.unpack_from('<H', raw, i)[0]
                i += 2
                out += raw[i:i + sl]
                i += sl
            return bytes(out)
        i = 28
        while i + 4 <= len(raw) and len(out) < length:
            pg = struct.unpack_from('<I', raw, i)[0]
            i += 4
            if not pg:
                continue
            b = self.page(pg)
            if b[0] != 8:
                continue
            j, end = 28, 28 + struct.unpack_from('<H', b, 24)[0]
            while j + 2 <= end:
                sl = struct.unpack_from('<H', b, j)[0]
                j += 2
                out += b[j:j + sl]
                j += sl
        return bytes(out[:length])

    # ---------------- formats ----------------
    def _load_formats(self):
        for _, _, data in self.raw_records(8):        # RDB$FORMATS
            if len(data) < 16:
                continue
            rel, fmt = struct.unpack_from('<hh', data, 4)
            blob = self.blob(*struct.unpack_from('<II', data, 8))
            if blob and len(blob) % 12 == 0:
                self.formats[(rel, fmt)] = [Desc(blob, i) for i in range(0, len(blob), 12)]

    def descs(self, rel, fmt=0):
        f = self.formats.get((rel, fmt))
        if f is not None:
            return f
        cand = sorted(k[1] for k in self.formats if k[0] == rel)
        if not cand:
            return None
        lower = [c for c in cand if c <= fmt]
        return self.formats[(rel, lower[-1] if lower else cand[0])]

    # ---------------- values ----------------
    def _text(self, raw):
        raw = raw.rstrip(b'\x00').rstrip(b' ')
        if not raw:
            return ''
        try:
            return raw.decode('ascii')
        except UnicodeDecodeError:
            pass
        try:
            return raw.decode(self.charset)
        except UnicodeDecodeError:
            pass
        # The legacy program truncated some values at a byte limit, cutting the
        # last CP949 character in half.  Drop the dangling bytes rather than
        # handing the caller a replacement character.
        for k in range(1, 5):
            try:
                return raw[:-k].decode(self.charset)
            except UnicodeDecodeError:
                continue
        return raw.decode(self.charset, 'replace')

    @staticmethod
    def _ts(days, frac):
        try:
            return (datetime.datetime.combine(EPOCH + datetime.timedelta(days=days),
                                              datetime.time())
                    + datetime.timedelta(seconds=frac / 10000.0))
        except (OverflowError, ValueError):
            return None

    def _value(self, data, d):
        o, t, L = d.offset, d.dtype, d.length
        if o + L > len(data):
            return None
        if t in (1, 2):
            raw = data[o:o + L]
            if t == 2:
                raw = raw.split(b'\0', 1)[0]
            return self._text(raw)
        if t == 3:
            n = struct.unpack_from('<H', data, o)[0]
            return self._text(data[o + 2:o + 2 + min(n, L - 2)])
        if t == 11:
            return struct.unpack_from('<f', data, o)[0]
        if t in (12, 13):
            return struct.unpack_from('<d', data, o)[0]
        if t == 17:
            return struct.unpack_from('<II', data, o)
        if t in (14, 16, 27):
            days, frac = struct.unpack_from('<ii', data, o)
            return self._ts(days, frac)
        if t == 15:
            frac = struct.unpack_from('<I', data, o)[0]
            return str(datetime.timedelta(seconds=frac / 10000.0))
        if t == 7:
            v = struct.unpack_from('<b', data, o)[0]
        elif t == 8:
            v = struct.unpack_from('<h', data, o)[0]
        elif t == 9:
            v = struct.unpack_from('<i', data, o)[0]
        elif t == 19:
            v = struct.unpack_from('<q', data, o)[0]
        elif t == 10:
            lo, hi = struct.unpack_from('<Ii', data, o)
            v = (hi << 32) | lo
        else:
            return data[o:o + L]
        if d.scale < 0:
            return v / float(10 ** -d.scale)
        if d.scale > 0:
            return v * (10 ** d.scale)
        return v

    # ---------------- schema ----------------
    def _load_schema(self):
        self.rel_name, self.relations = {}, {}
        ds6 = self.descs(6)                             # RDB$RELATIONS
        for _, _, data in self.raw_records(6):
            rid = self._value(data, ds6[3])
            nm = self._value(data, ds6[8])
            if isinstance(rid, int) and nm:
                self.rel_name[rid] = nm
                self.relations[nm] = rid

        ds5 = self.descs(5)                             # RDB$RELATION_FIELDS
        raw5 = [d for _, _, d in self.raw_records(5)]
        # RDB$FIELD_POSITION = the SMALLINT column whose values form 0..n-1 within each table
        self.pos_idx = None
        for si in [i for i, x in enumerate(ds5) if x.dtype == 8]:
            groups = {}
            for data in raw5:
                groups.setdefault(self._value(data, ds5[1]), []).append(self._value(data, ds5[si]))
            if all(sorted(v) == list(range(len(v))) for v in groups.values()):
                self.pos_idx = si
                break

        self.colnames = {}
        if self.pos_idx is not None:
            for data in raw5:
                fn = self._value(data, ds5[0])
                rid = self.relations.get(self._value(data, ds5[1]))
                if rid is not None:
                    self.colnames.setdefault(rid, {})[self._value(data, ds5[self.pos_idx])] = fn
        for rid, cols in self.colnames.items():
            for key in [k for k in self.formats if k[0] == rid]:
                for i, d in enumerate(self.formats[key]):
                    d.name = cols.get(i)

    def columns(self, rel):
        fmts = [k[1] for k in self.formats if k[0] == rel]
        return self.descs(rel, max(fmts)) if fmts else []

    def rows(self, rel, resolve_blobs=True):
        for _, fmt, data in self.raw_records(rel):
            ds = self.descs(rel, fmt)
            if not ds:
                continue
            nbytes = min(d.offset for d in ds)
            nulls = int.from_bytes(data[:nbytes], 'little') if len(data) >= nbytes else 0
            row = {}
            for i, d in enumerate(ds):
                key = d.name or ('F%d' % (i + 1))
                if nulls >> i & 1:
                    row[key] = None
                    continue
                v = self._value(data, d)
                if d.dtype == 17 and resolve_blobs and isinstance(v, tuple):
                    b = self.blob(*v)
                    v = (self._text(b) if d.subtype == 1 else b) if b is not None else None
                row[key] = v
            yield row

    def user_tables(self):
        return dict((rid, nm) for rid, nm in sorted(self.rel_name.items())
                    if rid >= 128 and rid in self.dp)
