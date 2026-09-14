#!/usr/bin/env python3
"""Inspect up to 12 daily archives for one exact product and printing."""
import argparse
from datetime import date
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

from sync_tcgcsv import Client, FIELDS, atomic_json, response_rows


def select_price(payload, product_id, printing):
    matches = [row for row in response_rows(payload)
               if row.get("productId") == product_id and row.get("subTypeName") == printing]
    if len(matches) > 1:
        raise ValueError("Ambiguous historical product/printing")
    return {field: matches[0].get(field) for field in FIELDS} if matches else None


def inspect(args):
    dates = sorted(set(args.dates))
    if not 1 <= len(dates) <= 12:
        raise ValueError("Choose 1–12 sample dates; this is not a full-history backfill")
    for day in dates:
        if date.fromisoformat(day).isoformat() != day or date.fromisoformat(day) < date(2024, 2, 8):
            raise ValueError("Invalid archive date")
    if args.group < 1 or args.product < 1:
        raise ValueError("Invalid group/product ID")
    executable = shutil.which("7zz") or shutil.which("7z")
    if not executable:
        raise RuntimeError("Install 7-Zip to inspect TCGCSV archives")
    cache = args.cache.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    history = cache / "history"
    history.mkdir(exist_ok=True)
    samples = []
    with (cache / "sync.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        client = Client(cache)
        for day in dates:
            filename = f"prices-{day}.ppmd.7z"
            path = f"archive/tcgplayer/{filename}"
            archive = history / filename
            if not archive.exists():
                data = client.fetch(path)
                if data is None:
                    samples.append({"date": day, "status": "archive_unavailable", "url": "https://tcgcsv.com/" + path})
                    continue
                if not data.startswith(b"7z\xbc\xaf\x27\x1c"):
                    raise ValueError("Response is not a 7-Zip archive")
                archive.write_bytes(data)
            # Only the exact member is emitted; no archive paths are extracted
            # onto the filesystem. 7-Zip checks the member's CRC while decoding.
            member = f"{day}/3/{args.group}/prices"
            decoded = subprocess.run([executable, "x", "-so", str(archive), member],
                                     check=True, capture_output=True, timeout=60)
            row = select_price(json.loads(decoded.stdout), args.product, args.printing) if decoded.stdout else None
            samples.append({"date": day, "status": "found" if row else "product_or_printing_absent",
                            "prices": row, "member": member, "url": "https://tcgcsv.com/" + path,
                            "archiveBytes": archive.stat().st_size,
                            "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest()})
            print(f"{day}: {row}", flush=True)
    result = {"schema": "tcger-price-history-sample-v1", "categoryId": 3, "groupId": args.group,
              "productId": args.product, "printing": args.printing, "currency": "USD",
              "dateMeaning": "daily archive date, not a sale timestamp", "samples": samples}
    atomic_json(args.out, result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dates", nargs="+", required=True)
    parser.add_argument("--group", type=int, required=True)
    parser.add_argument("--product", type=int, required=True)
    parser.add_argument("--printing", required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    inspect(args)


if __name__ == "__main__":
    main()
