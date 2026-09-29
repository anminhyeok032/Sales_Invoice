# -*- coding: utf-8 -*-
"""
Tradetax.gdb -> JSON exporter.

The legacy program stores its data in an InterBase 6 / Firebird 1.x database
(ODS 10).  gdbreader.py reads those pages directly, so nothing has to be
installed - no Firebird server, no fbclient.dll, no pip packages.

Usage
    python tools/gdb/export_tradetax.py --schema
    python tools/gdb/export_tradetax.py --raw
    python tools/gdb/export_tradetax.py            # app-shaped export

Output goes to private-data/export/ (gitignored).
"""
import argparse, base64, datetime, io, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gdbreader import GDB

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_DB = os.path.join(ROOT, 'private-data', 'Tradetax.gdb')
OUT_DIR = os.path.join(ROOT, 'private-data', 'export')


def jdefault(o):
    if isinstance(o, (bytes, bytearray)):
        return base64.b64encode(o).decode('ascii')
    if isinstance(o, (datetime.date, datetime.datetime)):
        return o.isoformat()
    return str(o)


def write(name, obj, compact=False):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name)
    kw = {'separators': (',', ':')} if compact else {'indent': 1}
    with io.open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, default=jdefault, **kw)
    print('  wrote %-28s %8.1f KB' % (name, os.path.getsize(path) / 1024.0))
    return path


def norm_date(s):
    """'2021.10.30' -> '2021-10-30'; leave anything else alone."""
    d = ''.join(ch for ch in (s or '') if ch.isdigit())
    return '%s-%s-%s' % (d[0:4], d[4:6], d[6:8]) if len(d) == 8 else (s or '')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default=DEFAULT_DB)
    ap.add_argument('--schema', action='store_true', help='print the schema and exit')
    ap.add_argument('--raw', action='store_true', help='dump every table verbatim')
    ap.add_argument('--images', action='store_true', help='also write PUSER stamp images as .bmp')
    args = ap.parse_args()

    db = GDB(args.db)
    print('%s' % args.db)
    print('  ODS %d.%d, page size %d, dialect %d, %d pages' %
          (db.ods_major, db.ods_minor, db.page_size, db.dialect, db.npages))

    if args.schema:
        for rid, nm in db.user_tables().items():
            print('\nCREATE TABLE %s (            -- relation id %d' % (nm, rid))
            cols = db.columns(rid)
            for i, d in enumerate(cols):
                print('  %-10s %-14s%s' % (d.name, d.sqltype(), ',' if i < len(cols) - 1 else ''))
            print(');')
        return

    T = dict((nm, list(db.rows(rid))) for rid, nm in db.user_tables().items())
    for nm, rows in T.items():
        print('  %-10s %6d rows' % (nm, len(rows)))
    print()

    if args.raw:
        for nm, rows in T.items():
            write('raw_%s.json' % nm.lower(), rows)
        return

    # ---- supplier (our own company) ----
    suppliers = [{
        'id': r['HCD'], 'name': r['SANGHO'], 'president': r['MNAME'],
        'regNo': r['BSNO'], 'businessType': r['UPTEA'], 'businessItem': r['UPJOG'],
        'address': r['ADDR'], 'phone': r['MTEL'], 'email': r['EMAIL'],
        'hasStamp': bool(r['DJIMG']),
    } for r in T['PUSER']]

    # ---- customers ----
    customers = [{
        'id': r['MCD'], 'supplierId': r['HCD'], 'name': r['SANGHO'],
        'president': r['MNAME'], 'regNo': r['BSNO'], 'businessType': r['UPTEA'],
        'businessItem': r['UPJOG'], 'address': r['ADDR'], 'phone': r['MTEL'],
        'email': r['EMAIL'], 'note': r['METC'],
    } for r in sorted(T['CUSTOMER'], key=lambda r: (r['HCD'] or 0, r['MCD'] or 0))]

    # ---- saved statements: header + its line items ----
    lines = {}
    for r in T['RDESLST']:
        lines.setdefault(r['JPNO'], []).append(r)
    transactions = []
    for h in sorted(T['TRADFLST'], key=lambda r: (r['IDAY'] or '', r['JPNO'] or '')):
        items = sorted(lines.get(h['JPNO'], []), key=lambda r: r['ORDRF'] or 0)
        transactions.append({
            'id': h['JPNO'],
            'date': norm_date(h['IDAY']),
            'title': h['JKYU'],
            'customer': {
                'id': h['MCD'], 'name': h['SANGHO'], 'president': h['MNAME'],
                'regNo': h['BSNO'], 'businessType': h['UPTEA'],
                'businessItem': h['UPJOG'], 'address': h['ADDR'],
            },
            'supply': h['IMNY'], 'tax': h['IVAT'], 'note': h['ETC'],
            'items': [{
                'date': i['MDAY'], 'name': i['PNAME'], 'spec': i['PSTAN'],
                'unit': i['PUNIT'], 'qty': i['INO'], 'price': i['ICOST'],
                'supply': i['IMNY'], 'tax': i['IVAT'], 'note': i['ETC'],
            } for i in items],
        })

    # ---- remembered unit prices per customer ----
    prices = [{
        'supplierId': r['HCD'], 'name': r['PNAME'], 'spec': r['PSTAN'],
        'unit': r['PUNIT'], 'price': r['ICOST'],
    } for r in T['CUSTMCOST']]

    write('suppliers.json', suppliers)
    write('customers.json', customers)
    write('transactions.json', transactions)
    write('price_memory.json', prices)

    # ---- the file the app's "기존 프로그램 데이터 가져오기" button reads ----
    # Only the fields the app actually stores, so the payload stays as small as
    # possible: see src/lib/legacyImport.js.
    app_tx = []
    for t in transactions:
        y, m = (t['date'][:4], t['date'][5:7]) if len(t['date']) == 10 else ('', '')
        app_tx.append({
            'id': 'gdb-' + t['id'],
            'year': int(y) if y.isdigit() else 0,
            'month': int(m) if m.isdigit() else 0,
            'companyName': t['customer']['name'] or '',
            'date': t['date'],
            'items': [{
                'date': i['date'] or '', 'name': i['name'] or '', 'spec': i['spec'] or '',
                'unit': i['unit'] or '', 'qty': i['qty'] or 0, 'price': i['price'] or 0,
                'supply': i['supply'] or 0, 'tax': i['tax'] or 0, 'note': i['note'] or '',
            } for i in t['items']],
        })
    app_co = [{
        'id': 'gdb-%s-%s' % (c['supplierId'], c['id']), 'name': c['name'],
        'president': c['president'] or '', 'regNo': c['regNo'] or '',
        'businessType': c['businessType'] or '', 'businessItem': c['businessItem'] or '',
        'address': c['address'] or '', 'phone': c['phone'] or '',
    } for c in customers]
    write('tradetax-import.json', {
        'format': 'tradetax-gdb-import',
        'generatedAt': datetime.datetime.now().replace(microsecond=0).isoformat(),
        'source': os.path.basename(args.db),
        'transactions': app_tx,
        'companies': app_co,
    }, compact=True)

    if args.images:
        os.makedirs(OUT_DIR, exist_ok=True)
        for r in T['PUSER']:
            if r['DJIMG']:
                p = os.path.join(OUT_DIR, 'stamp_%s.bmp' % r['HCD'])
                open(p, 'wb').write(r['DJIMG'])
                print('  wrote %-28s %8.1f KB' % (os.path.basename(p), len(r['DJIMG']) / 1024.0))

    print('\n  %d statements / %d line items / %d customers'
          % (len(transactions), sum(len(t['items']) for t in transactions), len(customers)))


if __name__ == '__main__':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    main()
