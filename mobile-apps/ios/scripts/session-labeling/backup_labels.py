#!/usr/bin/env python3
"""Snapshot every human label in the dataset to a timestamped JSON file.

Cheap insurance: single-card verdicts, per-pocket binder labels, corrections,
fix boundaries, and manual quads are the only unrecoverable state in the
labeling workflow (everything else is derived). Run any time; restore with
--restore <file> (only fills fields that are currently empty unless --force).

  ~/.venvs/tcger-label/bin/python backup_labels.py
  ~/.venvs/tcger-label/bin/python backup_labels.py --restore backups/labels-....json
"""

import argparse
import datetime
import json
from pathlib import Path

FIELDS = ("verdict", "corrected_card_id", "fixed_quad_json",
          "fixed_quad_source", "rerun_top5_json", "binder_rerun_json",
          "binder_labels_json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset-name", default="tcger-sessions")
    ap.add_argument("--restore", metavar="FILE")
    ap.add_argument(
        "--out-dir",
        help=(
            "backup directory (default: <dataset labeling_state_dir>/backups)"
        ),
    )
    ap.add_argument("--force", action="store_true",
                    help="restore over non-empty fields too")
    args = ap.parse_args()

    import fiftyone as fo

    dataset = fo.load_dataset(args.dataset_name)

    if args.out_dir:
        backup_dir = Path(args.out_dir).expanduser()
    else:
        labeling_state_dir = dataset.info.get("labeling_state_dir")
        sessions_dir = dataset.info.get("sessions_dir")
        if labeling_state_dir:
            backup_dir = Path(labeling_state_dir).expanduser() / "backups"
        elif sessions_dir:
            session_root = Path(sessions_dir).expanduser().parent
            if session_root.name == "TCGer-Session-Reference":
                backup_dir = (
                    session_root.parent
                    / "TCGer-Labeling/fiftyone-sessions/backups"
                )
            else:
                backup_dir = session_root / "labeling/backups"
        else:
            raise RuntimeError(
                "dataset has no labeling_state_dir or sessions_dir; "
                "pass --out-dir explicitly"
            )

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
        for field in FIELDS:
            if not dataset.has_sample_field(field) and any(
                record.get(field) is not None for record in by_key.values()
            ):
                dataset.add_sample_field(field, fo.StringField)
        n = 0
        for sample in dataset.iter_samples():
            rec = by_key.get(sample["key"])
            if not rec:
                continue
            changed = False
            for f in FIELDS:
                existing = sample[f] if sample.has_field(f) else None
                if rec.get(f) is not None and (args.force or existing is None):
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
                if (
                    sample.has_field("binder_labels_json")
                    and sample["binder_labels_json"]
                    and "binder-labels-applied" not in sample.tags
                ):
                    sample.tags.append("binder-labels-applied")
                sample.save()
                n += 1
        print(f"restored labels onto {n} samples from {args.restore}")
        return

    records = []
    for sample in dataset.iter_samples():
        rec = {
            f: sample[f]
            for f in FIELDS
            if sample.has_field(f) and sample[f] is not None
        }
        mq = sample["manual_quad"]
        if mq and mq.polylines and mq.polylines[-1].points:
            rec["manual_quad_points"] = [
                [float(x), float(y)] for x, y in mq.polylines[-1].points[0]
            ]
        if rec:
            rec["key"] = sample["key"]
            records.append(rec)

    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    out = backup_dir / f"labels-{stamp}.json"
    out.write_text(json.dumps(records, indent=1))
    print(f"{len(records)} labeled samples -> {out}")


if __name__ == "__main__":
    main()
