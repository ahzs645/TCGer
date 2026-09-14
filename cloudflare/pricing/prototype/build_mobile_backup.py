"""Export only public raw-price fields, in independently downloadable set shards."""
import hashlib
import json
import sqlite3
from pathlib import Path
import argparse


def build(database, output):
    output = Path(output)
    (output / 'objects').mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(f'file:{Path(database).resolve()}?mode=ro', uri=True)
    stamp = json.loads(db.execute("SELECT value FROM metadata WHERE key='sourceAsOf'").fetchone()[0])
    groups, sets = [], {}
    for group_id, name, abbreviation in db.execute('SELECT group_id,name,abbreviation FROM groups ORDER BY group_id'):
        groups.append(dict(groupId=group_id, name=name, abbreviation=abbreviation, categoryId=3))
        products = []
        for (raw,) in db.execute('SELECT raw_json FROM products WHERE group_id=? ORDER BY product_id', (group_id,)):
            product = json.loads(raw)
            products.append({**{key: product[key] for key in ('productId', 'name', 'groupId', 'categoryId')},
                             'extendedData': [entry for entry in product.get('extendedData', []) if entry['name'] == 'Number']})
        prices = [dict(productId=row[0], subTypeName=row[1], marketPrice=row[2], lowPrice=row[3])
                  for row in db.execute('SELECT product_id,printing,market_price,low_price FROM prices WHERE group_id=? ORDER BY product_id,printing', (group_id,))]
        payload = json.dumps(dict(groupId=group_id, sourceAsOf=stamp, products=products, prices=prices), separators=(',', ':'), ensure_ascii=False).encode()
        digest = hashlib.sha256(payload).hexdigest()
        file = f'objects/{digest}.json'
        (output / file).write_bytes(payload)
        sets[str(group_id)] = dict(file=file, sha256=digest, bytes=len(payload))
    manifest = dict(schema='tcger-pokemon-prices-backup-v1', sourceAsOf=stamp, groups=groups, sets=sets)
    (output / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':'), ensure_ascii=False))
    db.close()
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sqlite', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    result = build(args.sqlite, args.out)
    print(f"Exported {len(result['sets'])} sets as of {result['sourceAsOf']}")
