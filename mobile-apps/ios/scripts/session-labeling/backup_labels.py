#!/usr/bin/env python3
"""Snapshot every human label in the dataset to a timestamped JSON file.

Cheap insurance: verdicts, corrections, fix boundaries, and manual quads are
the only unrecoverable state in the labeling workflow (everything else is
derived). Run any time; restore with --restore <file> (only fills fields that
are currently empty unless --force).

  ~/.venvs/tcger-label/bin/python backup_labels.py
  ~/.venvs/tcger-label/bin/python backup_labels.py --restore backups/labels-....json
"""

import argparse
import datetime
import json
from pathlib import Path

BACKUP_DIR = (
    Path.home() / "Downloads/Reference/TCGer-Session-Reference/labeling/backups"
)
FIELDS = ("verdict", "corrected_card_id", "fixed_quad_json",
          "fixed_quad_source", "rerun_top5_json", "binder_rerun_json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset-name", default="tcger-sessions")
    ap.add_argument("--restore", metavar="FILE")
    ap.add_argument("--force", action="store_true",
                    help="restore over non-empty fields too")
    args = ap.parse_args()

    import fiftyone as fo

    dataset = fo.load_dataset(args.dataset_name)

    if args.restore:
        if args.restore.endswith(".jsonl"):
            # append-only journal: last record per key wins
            by_key = {}
            for line in open(args.restore):
                line = line.strip()
                if line:
                    rec = json.loads(line)
                    by_key[rec["key"]] = rec
        else:
            records = json.load(open(args.restore))
            by_key = {r["key"]: r for r in records}
        n = 0
        for sample in dataset.iter_samples():
            rec = by_key.get(sample["key"])
            if not rec:
                continue
            changed = False
            for f in FIELDS:
                if rec.get(f) is not None and (args.force or sample[f] is None):
                    sample[f] = rec[f]
                    changed = True
            if rec.get("manual_quad_points") and (
                args.force or not sample["manual_quad"]
            ):
                sample["manual_quad"] = fo.Polylines(polylines=[fo.Polyline(
                    label="card", points=[rec["manual_quad_points"]],
                    closed=True, filled=False,
                )])
                changed = True
            if changed:
                if sample["verdict"] and "verdict-applied" not in sample.tags:
                    sample.tags.append("verdict-applied")
                sample.save()
                n += 1
        print(f"restored labels onto {n} samples from {args.restore}")
        return

    records = []
    for sample in dataset.iter_samples():
        rec = {f: sample[f] for f in FIELDS if sample[f] is not None}
        mq = sample["manual_quad"]
        if mq and mq.polylines and mq.polylines[-1].points:
            rec["manual_quad_points"] = [
                [float(x), float(y)] for x, y in mq.polylines[-1].points[0]
            ]
        if rec:
            rec["key"] = sample["key"]
            records.append(rec)

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    out = BACKUP_DIR / f"labels-{stamp}.json"
    out.write_text(json.dumps(records, indent=1))
    print(f"{len(records)} labeled samples -> {out}")


if __name__ == "__main__":
    main()
