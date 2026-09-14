#!/usr/bin/env python3
"""Build the complete category-3 TCGCSV snapshot, with resumable daily pulls."""
import argparse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import fcntl
import hashlib
import json
import math
from pathlib import Path
import sqlite3
import tempfile
import time
import urllib.error
import urllib.request

from build_snapshot import iso, json_bytes, package, utc_now

BASE = "https://tcgcsv.com/"
FIELDS = ("marketPrice", "lowPrice", "midPrice", "highPrice", "directLowPrice")


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(json_bytes(value))
    temporary.replace(path)


def date(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Source timestamp must specify its timezone")
    return parsed


def retry_delay(value, attempt):
    if value:
        try:
            delay = float(value)
        except ValueError:
            delay = (parsedate_to_datetime(value) - utc_now()).total_seconds()
    else:
        delay = 2 ** (attempt + 1)
    if not math.isfinite(delay) or delay > 60:
        raise RuntimeError("Upstream requested a longer pause; resume this run later")
    return max(1, delay)


class Client:
    def __init__(self, cache):
        self.cache = cache
        self.last_request = 0
        self.requests = 0

    def fetch(self, path):
        # Reserve before every attempt, including retries. The enclosing flock
        # serializes this ledger and prevents duplicate local syncs.
        for attempt in range(3):
            ledger_path = self.cache / "request-budget.json"
            ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {}
            today = utc_now().date().isoformat()
            used = ledger.get("requests", 0) if ledger.get("day") == today else 0
            if used >= 2000 or self.requests >= 1500:
                raise RuntimeError("TCGCSV request budget exhausted; resume later")
            atomic_json(ledger_path, {"day": today, "requests": used + 1})
            time.sleep(max(0, .25 - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            self.requests += 1
            request = urllib.request.Request(BASE + path, headers={
                "User-Agent": "TCGer-PricingSync/1.0", "Accept": "application/json,text/plain",
            })
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    data = response.read(30_000_001)
                if len(data) > 30_000_000:
                    raise ValueError("Upstream response exceeds size limit")
                return data
            except urllib.error.HTTPError as error:
                if error.code == 404:
                    return None
                if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                    raise
                time.sleep(retry_delay(error.headers.get("Retry-After"), attempt))
            except (urllib.error.URLError, TimeoutError):
                if attempt == 2:
                    raise
                time.sleep(2 ** (attempt + 1))

    def stamp(self):
        data = self.fetch("last-updated.txt")
        if data is None:
            raise ValueError("Source update stamp unavailable")
        stamp = data.decode().strip()
        if date(stamp) > utc_now():
            raise ValueError("Source update stamp is in the future")
        return stamp

    def rows(self, path, directory):
        cached = directory / (hashlib.sha256(path.encode()).hexdigest() + ".json")
        if cached.exists():
            record = json.loads(cached.read_text())
        else:
            data = self.fetch(path)
            record = {"path": path, "retrievedAt": iso(utc_now()),
                      "payload": json.loads(data) if data is not None else None}
            # Validate before caching, so an error response cannot poison resume.
            response_rows(record["payload"])
            atomic_json(cached, record)
        if record["path"] != path:
            raise ValueError("Cache path mismatch")
        return response_rows(record["payload"]), record["retrievedAt"], record["payload"] is None


def response_rows(payload):
    # Empty TCGplayer collections can be represented by 404; callers must check
    # both products and prices before treating a group as empty.
    if payload is None:
        return []
    if not isinstance(payload, dict) or payload.get("success") is not True or payload.get("errors"):
        raise ValueError("Invalid upstream response")
    rows = payload.get("results")
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("Invalid upstream rows")
    if "totalItems" in payload and payload["totalItems"] != len(rows):
        raise ValueError("Incomplete upstream collection")
    return rows


def identifier(value):
    if type(value) is not int or value < 1:
        raise ValueError("Invalid provider ID")
    return value


def prices_for_group(group_id, products, prices):
    product_ids = set()
    for product in products:
        product_id = identifier(product.get("productId"))
        if product_id in product_ids or product.get("groupId") != group_id or product.get("categoryId") != 3:
            raise ValueError("Duplicate or mismatched product identity")
        product_ids.add(product_id)
    seen = set()
    for row in prices:
        product_id = identifier(row.get("productId"))
        printing = row.get("subTypeName")
        if product_id not in product_ids:
            raise ValueError(f"Price references a missing product in group {group_id}: {product_id}")
        if not isinstance(printing, str) or not printing.strip() or len(printing) > 120:
            raise ValueError("Missing printing identity")
        key = (product_id, printing)
        if key in seen:
            raise ValueError("Duplicate product/printing price")
        seen.add(key)
        for field in FIELDS:
            amount = row.get(field)
            if amount is not None and (isinstance(amount, bool) or not isinstance(amount, (int, float))
                                       or not math.isfinite(amount) or amount < 0):
                raise ValueError("Invalid price amount")
    return prices


def validate_coverage(summary, previous, allow_drop=False):
    if not previous or previous.get("kind") != "tcgcsv-full-pokemon" or allow_drop:
        return
    for field in ("groupCount", "productCount", "pricedRows"):
        if summary[field] < previous[field] * .9:
            raise ValueError(f"Coverage dropped more than 10% for {field}; previous snapshot retained")


SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE groups(group_id INTEGER PRIMARY KEY, name TEXT NOT NULL, abbreviation TEXT, raw_json TEXT NOT NULL);
CREATE TABLE products(group_id INTEGER NOT NULL REFERENCES groups(group_id), product_id INTEGER NOT NULL,
  name TEXT NOT NULL, collector_number TEXT, raw_json TEXT NOT NULL, PRIMARY KEY(group_id,product_id));
CREATE TABLE prices(group_id INTEGER NOT NULL, product_id INTEGER NOT NULL, printing TEXT NOT NULL,
  market_price REAL, low_price REAL, mid_price REAL, high_price REAL, direct_low_price REAL,
  currency TEXT NOT NULL DEFAULT 'USD', source_as_of TEXT NOT NULL, retrieved_at TEXT NOT NULL,
  PRIMARY KEY(group_id,product_id,printing), FOREIGN KEY(group_id,product_id) REFERENCES products(group_id,product_id));
CREATE TABLE source_files(path TEXT PRIMARY KEY, retrieved_at TEXT NOT NULL, was_404 INTEGER NOT NULL);
CREATE INDEX products_provider_id ON products(product_id);
CREATE INDEX products_name ON products(name);
CREATE INDEX prices_provider_id ON prices(product_id,printing);
"""


def build(client, stamp, directory, database, previous=None, allow_drop=False):
    started = iso(utc_now())
    groups, groups_retrieved, missing = client.rows("tcgplayer/3/groups", directory)
    if missing or not 1 <= len(groups) <= 500:
        raise ValueError("Expected 1–500 Pokémon groups")
    ids = [identifier(group.get("groupId")) for group in groups]
    if len(set(ids)) != len(ids) or any(group.get("categoryId") != 3 for group in groups):
        raise ValueError("Invalid Pokémon group identities")
    all_products, all_prices, empty = [], [], []
    source_as_of = iso(date(stamp))
    with sqlite3.connect(database) as db:
        db.executescript(SCHEMA)
        db.execute("INSERT INTO source_files VALUES (?,?,0)", ("tcgplayer/3/groups", groups_retrieved))
        for index, group in enumerate(sorted(groups, key=lambda g: g["groupId"]), 1):
            group_id = group["groupId"]
            path = f"tcgplayer/3/{group_id}"
            products, product_time, product_missing = client.rows(path + "/products", directory)
            prices, price_time, price_missing = client.rows(path + "/prices", directory)
            if products and price_missing:
                raise ValueError(f"Missing prices file for populated group {group_id}")
            prices_for_group(group_id, products, prices)
            if not products:
                empty.append(group_id)
            db.execute("INSERT INTO groups VALUES (?,?,?,?)", (group_id, group["name"], group.get("abbreviation"), json_bytes(group).decode()))
            for suffix, retrieved, absent in [("products", product_time, product_missing), ("prices", price_time, price_missing)]:
                db.execute("INSERT INTO source_files VALUES (?,?,?)", (path + "/" + suffix, retrieved, absent))
            for product in products:
                extended = product.get("extendedData") or []
                number = next((item.get("value") for item in extended if item.get("name") == "Number"), None)
                db.execute("INSERT INTO products VALUES (?,?,?,?,?)", (group_id, product["productId"], product["name"], number, json_bytes(product).decode()))
                all_products.append(product)
            for row in prices:
                db.execute("INSERT INTO prices VALUES (?,?,?,?,?,?,?,?,?,?,?)", (
                    group_id, row["productId"], row["subTypeName"], *(row.get(field) for field in FIELDS),
                    "USD", source_as_of, price_time))
                all_prices.append({**row, "groupId": group_id, "sourceAsOf": source_as_of, "retrievedAt": price_time})
            if index % 20 == 0 or index == len(groups):
                print(f"Groups {index}/{len(groups)}; products {len(all_products)}; price rows {len(all_prices)}", flush=True)
        if not all_products or not all_prices:
            raise ValueError("Empty price catalog")
        if client.stamp() != stamp:
            raise ValueError("Source changed during download; rerun for the new build")
        summary = {"kind": "tcgcsv-full-pokemon", "categoryId": 3, "updateStamp": stamp,
                   "sourceAsOf": source_as_of, "pullStartedAt": started, "completedAt": iso(utc_now()), "groupCount": len(groups),
                   "productCount": len(all_products), "priceRows": len(all_prices),
                   "pricedRows": sum(any(row.get(field) is not None for field in FIELDS) for row in all_prices),
                   "marketPricedRows": sum(row.get("marketPrice") is not None for row in all_prices),
                   "emptyGroups": empty, "sourceUrl": BASE + "tcgplayer/3/groups"}
        validate_coverage(summary, previous, allow_drop)
        for key, value in summary.items():
            db.execute("INSERT INTO metadata VALUES (?,?)", (key, json.dumps(value)))
        if db.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("Broken price/product references")
    exported = {"schema": "tcger-tcgcsv-raw-prices-v1", "categoryId": 3, "currency": "USD",
                "sourceAsOf": source_as_of, "groups": groups, "products": all_products, "prices": all_prices}
    return exported, summary


def sync(args):
    cache, output = args.cache.resolve(), args.out.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    with (cache / "sync.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        client = Client(cache)
        previous = args.previous or (output / "manifest.json")
        manifest = json.loads(previous.read_text()) if previous.exists() else {}
        prior = manifest.get("source", {})
        stamp = client.stamp()
        if prior.get("kind") == "tcgcsv-full-pokemon":
            if date(stamp) <= date(prior["updateStamp"]):
                return {"changed": False, "reason": "source_unchanged", "source": prior, "requests": client.requests}
            if (utc_now() - date(prior.get("pullStartedAt", prior["completedAt"]))).total_seconds() < 86400:
                return {"changed": False, "reason": "daily_pull_cooldown", "source": prior, "requests": client.requests}
        directory = cache / hashlib.sha256(stamp.encode()).hexdigest()
        directory.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="tcger-tcgcsv-") as temporary:
            database = Path(temporary) / "catalog.sqlite"
            exported, summary = build(client, stamp, directory, database, prior, args.allow_coverage_drop)
            result = package(database, output, exported, summary)
        return {"changed": True, "source": summary, "snapshotId": result["snapshotId"], "requests": client.requests}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--previous", type=Path, help="Previously published R2 manifest for conditional sync/coverage checks")
    parser.add_argument("--result", type=Path)
    parser.add_argument("--allow-coverage-drop", action="store_true")
    args = parser.parse_args()
    result = sync(args)
    if args.result:
        atomic_json(args.result, result)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
