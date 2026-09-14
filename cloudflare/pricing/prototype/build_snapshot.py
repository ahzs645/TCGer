#!/usr/bin/env python3
"""Package an existing SQLite DB, or build one small TCGdex pricing snapshot."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
import tempfile
import urllib.request


def utc_now():
    return datetime.now(timezone.utc)


def iso(value):
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def get_json(path):
    url = "https://api.tcgdex.net/v2/en/" + path
    request = urllib.request.Request(url, headers={"User-Agent": "TCGer-pricing-prototype/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(2_000_001)
    if len(data) > 2_000_000:
        raise ValueError("Upstream response exceeds prototype size limit")
    return json.loads(data)


def card_quotes(card, retrieved):
    """Keep market price variants distinct; do not infer condition or edition."""
    provider = (card.get("pricing") or {}).get("tcgplayer") or {}
    if provider.get("unit") != "USD" or not provider.get("updated"):
        return []
    observed = datetime.fromisoformat(provider["updated"].replace("Z", "+00:00"))
    if observed.tzinfo is None or observed > retrieved:
        raise ValueError("Invalid upstream observation date")
    quotes = []
    for printing, value in provider.items():
        if not isinstance(value, dict):
            continue
        amount = value.get("marketPrice")
        product_id = value.get("productId")
        if (isinstance(amount, bool) or not isinstance(amount, (int, float))
                or not math.isfinite(amount) or amount <= 0 or not product_id):
            continue
        quotes.append({
            "gameId": "pokemon", "cardId": card["id"], "finishCode": printing,
            "language": "English", "amount": amount, "currency": "USD",
            "source": "TCGdex/TCGplayer:market", "providerProductId": str(product_id),
            "observedAt": iso(observed), "retrievedAt": iso(retrieved),
            "expiresAt": iso(observed + timedelta(hours=48)),
        })
    return quotes


def build_set(set_id, database):
    if not re.fullmatch(r"[a-zA-Z0-9-]{1,40}", set_id):
        raise ValueError("Invalid set id")
    details = get_json("sets/" + set_id)
    ids = [card["id"] for card in details.get("cards", [])]
    if not 1 <= len(ids) <= 300 or len(ids) != len(set(ids)):
        raise ValueError("Prototype requires one set of 1–300 unique cards")
    if any(not re.fullmatch(r"[a-zA-Z0-9.-]{1,100}", card_id) for card_id in ids):
        raise ValueError("Unsafe upstream card id")
    # Four bounded downloads at a time; any failed fetch aborts publication.
    with ThreadPoolExecutor(max_workers=4) as pool:
        cards = list(pool.map(lambda card_id: get_json("cards/" + card_id), ids))
    retrieved = utc_now()
    quotes = []
    for expected, card in zip(ids, cards):
        if card.get("id") != expected or (card.get("set") or {}).get("id") != set_id:
            raise ValueError("Upstream identity mismatch")
        quotes.extend(card_quotes(card, retrieved))
    if not quotes:
        raise ValueError("No real market quotes returned")
    with sqlite3.connect(database) as db:
        db.executescript("""
          CREATE TABLE cards (id TEXT PRIMARY KEY, set_id TEXT NOT NULL, name TEXT NOT NULL, number TEXT);
          CREATE TABLE quotes (card_id TEXT NOT NULL REFERENCES cards(id), printing TEXT NOT NULL,
            amount REAL NOT NULL, currency TEXT NOT NULL, source TEXT NOT NULL,
            provider_product_id TEXT NOT NULL, observed_at TEXT NOT NULL,
            retrieved_at TEXT NOT NULL, expires_at TEXT NOT NULL,
            PRIMARY KEY(card_id, printing, source, currency));
        """)
        db.executemany("INSERT INTO cards VALUES (?,?,?,?)", [
            (c["id"], set_id, c["name"], str(c.get("localId", ""))) for c in cards
        ])
        db.executemany("INSERT INTO quotes VALUES (?,?,?,?,?,?,?,?,?)", [
            tuple(q[key] for key in ["cardId", "finishCode", "amount", "currency", "source",
                                    "providerProductId", "observedAt", "retrievedAt", "expiresAt"])
            for q in quotes
        ])
    summary = {"kind": "tcgdex-live-set", "setId": set_id, "setName": details["name"],
               "cardCount": len(cards), "pricedCards": len({q["cardId"] for q in quotes}),
               "quoteCount": len(quotes), "sourceUrl": "https://api.tcgdex.net/v2/en/sets/" + set_id}
    return {"schema": "tcger-hosted-prices-v1", "quotes": quotes}, summary


def copy_database(source, target):
    # SQLite backup takes a consistent snapshot, including committed WAL data.
    with sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True) as original:
        with sqlite3.connect(target) as copied:
            original.backup(copied)


def package(source, output, snapshot=None, summary=None):
    output.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True) as db:
        if db.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
            raise ValueError("SQLite integrity check failed")
        tables = [r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    raw = source.read_bytes()
    content_hash = hashlib.sha256(raw).hexdigest()
    assets = []

    def artifact(kind, data, extension):
        compressed = gzip.compress(data, compresslevel=9, mtime=0)
        digest = hashlib.sha256(compressed).hexdigest()
        name = f"{kind}-{digest}.{extension}.gz"
        (output / name).write_bytes(compressed)
        assets.append({"kind": kind, "file": name, "sha256": digest, "bytes": len(compressed),
                       "uncompressedSha256": hashlib.sha256(data).hexdigest(), "uncompressedBytes": len(data)})

    artifact("database", raw, "sqlite")
    if snapshot:
        artifact("prices", json_bytes(snapshot), "json")
    # Convenience copy for local SQL inspection, never uploaded under this name.
    (output / "catalog.sqlite").write_bytes(raw)
    manifest = {"schema": "tcger-pricing-prototype-v1", "snapshotId": content_hash,
                "createdAt": iso(utc_now()), "prototype": True, "tables": tables,
                "source": summary or {"kind": "supplied-sqlite", "file": source.name}, "assets": assets}
    (output / "manifest.json").write_bytes(json_bytes(manifest))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--sqlite", type=Path)
    source.add_argument("--tcgdex-set")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="tcger-pricing-") as directory:
        database = Path(directory) / "catalog.sqlite"
        snapshot, summary = None, None
        if args.sqlite:
            copy_database(args.sqlite, database)
            summary = {"kind": "supplied-sqlite", "file": args.sqlite.name}
        else:
            snapshot, summary = build_set(args.tcgdex_set, database)
        result = package(database, args.out, snapshot, summary)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
