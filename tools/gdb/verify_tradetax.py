# -*- coding: utf-8 -*-
"""
Self-check for the Tradetax.gdb reader.

Nothing here trusts the reader's own opinion of the file: every check either
compares two independently-derived views of the same data, or tests an
invariant the legacy application must have maintained.

    python tools/gdb/verify_tradetax.py
"""
import collections, io, os, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gdbreader import GDB, DP_HEADER, RHD_LEN

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_PATH = os.path.join(ROOT, 'private-data', 'Tradetax.gdb')

PASS = FAIL = 0


def check(label, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print('  PASS  %-50s %s' % (label, detail))
    else:
        FAIL += 1
        print('  FAIL  %-50s %s' % (label, detail))


def main():
    db = GDB(DB_PATH)
    T = dict((nm, list(db.rows(rid))) for rid, nm in db.user_tables().items())
    trad, rdes, cust = T['TRADFLST'], T['RDESLST'], T['CUSTOMER']

    print('1. page discovery vs Firebird\'s own pointer-page directory')
    ptr = {}
    for p in range(db.npages):
        b = db.page(p)
        if b[0] == 4:
            _, _, cnt, rel = struct.unpack_from('<IIHH', b, 16)
            ptr.setdefault(rel, []).append((p, cnt))
    for rid, nm in db.user_tables().items():
        seen = set()
        for p, cnt in ptr.get(rid, []):
            b = db.page(p)
            for i in range(cnt):
                pg = struct.unpack_from('<I', b, 32 + i * 4)[0]
                if pg:
                    seen.add(pg)
        scan = set(db.dp[rid].values())
        check('%s data pages found by both routes' % nm, seen == scan, '%d pages' % len(scan))

    print('\n2. every returned row belongs to a committed transaction')
    tip = next(p for p in range(db.npages) if db.page(p)[0] == 3)
    tb = db.page(tip)

    def tx_state(tx):
        if tx >= (db.page_size - 20) * 4:
            return 'beyond-tip'
        return ['active', 'limbo', 'dead', 'committed'][(tb[20 + (tx >> 2)] >> ((tx & 3) * 2)) & 3]

    states = collections.Counter()
    for rid in db.user_tables():
        for seq in sorted(db.dp[rid]):
            b = db.page(db.dp[rid][seq])
            for line in range(struct.unpack_from('<H', b, 22)[0]):
                off, ln = struct.unpack_from('<HH', b, DP_HEADER + line * 4)
                if not off or ln < RHD_LEN:
                    continue
                raw = b[off:off + ln]
                if struct.unpack_from('<H', raw, 10)[0] & (1 | 2 | 4 | 16):
                    continue
                states[tx_state(struct.unpack_from('<I', raw, 0)[0])] += 1
    check('all live rows committed', set(states) == {'committed'}, dict(states))

    print('\n3. every record decompresses to its full declared format length')
    short = 0
    for rid in db.user_tables():
        for _, fmt, data in db.raw_records(rid):
            ds = db.descs(rid, fmt)
            if len(data) < max(d.offset + d.length for d in ds):
                short += 1
    check('no truncated records', short == 0, '%d short of format length' % short)

    print('\n4. referential integrity between the two statement tables')
    jt = set(r['JPNO'] for r in trad)
    check('TRADFLST.JPNO is unique', len(jt) == len(trad), '%d headers' % len(trad))
    orph = set(r['JPNO'] for r in rdes) - jt
    check('every RDESLST line has its header', not orph, '%d orphan keys' % len(orph))

    print('\n5. arithmetic: each header total equals the sum of its own lines')
    tot = collections.defaultdict(float)
    for r in rdes:
        tot[r['JPNO']] += r['IMNY'] or 0
    bad = [r for r in trad if abs((r['IMNY'] or 0) - tot[r['JPNO']]) > 0.5]
    check('sum(RDESLST.IMNY) == TRADFLST.IMNY', not bad,
          '%d / %d headers reconcile' % (len(trad) - len(bad), len(trad)))

    print('\n6. blobs round-trip (PUSER stamp images)')
    for r in T['PUSER']:
        img = r['DJIMG'] or b''
        check('stamp of %s is an intact BMP' % r['SANGHO'],
              img[:2] == b'BM' and int.from_bytes(img[2:6], 'little') == len(img),
              '%d bytes' % len(img))

    print('\n7. text decoding')
    # A misread record would leave string fields full of arbitrary bytes.  If
    # instead every byte sequence is valid CP949 - allowing only for a final
    # character the legacy program itself cut in half - the field offsets and
    # the decompression must be right.
    drops = collections.Counter()
    for rid in db.user_tables():
        for _, fmt, data in db.raw_records(rid):
            for d in db.descs(rid, fmt):
                if d.dtype != 3:
                    continue
                n = struct.unpack_from('<H', data, d.offset)[0]
                raw = data[d.offset + 2:d.offset + 2 + min(n, d.length - 2)]
                try:
                    raw.decode('cp949')
                    drops[0] += 1
                    continue
                except UnicodeDecodeError:
                    pass
                for k in range(1, 5):
                    try:
                        raw[:-k].decode('cp949')
                        drops[k] += 1
                        break
                    except UnicodeDecodeError:
                        continue
                else:
                    drops['garbage'] += 1
    check('every string is valid CP949', 'garbage' not in drops,
          '%d clean, %d cut mid-character by the legacy app'
          % (drops[0], sum(v for k, v in drops.items() if k != 0)))
    check('no string decodes to a replacement character',
          not any('�' in v for rows in T.values() for r in rows
                  for v in r.values() if isinstance(v, str)))

    print('\n%d passed, %d failed' % (PASS, FAIL))
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.exit(main())
