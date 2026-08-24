#!/usr/bin/env python3
"""Write FiftyOne verdicts back into each session's results.json.

Mapping (verdict field set by the tcger-card-labeler plugin):
  true / true_margin   -> expectedCardId = the prediction that was shown
                          (device accept if identified, else top-1 candidate)
  false / false_margin -> expectedCardId = corrected_card_id (skipped with a
                          warning when no ID was entered — second-pass work)
  no_card              -> expectedNoMatch = true
  *_margin             -> additionally needsMarginEdit = true on the frame
                          (Swift's JSONDecoder ignores unknown keys, so this
                          rides along in results.json harmlessly)

Frames already labeled in the curated tables inside
DevModeSessionReplayTests.swift are never overwritten here; conflicts between
a verdict and a curated label are reported for manual resolution.

Run with --dry-run first. Then sync the sessions dir back to Drive yourself:
  rsync -a ~/Downloads/Reference/TCGer-Session-Reference/sessions/ \
      "/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/TCG/Reference/TCGer-Session-Reference/sessions/"
"""

import argparse
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DEFAULT_METADATA = REPO / "ios/TCGer/TCGer/Resources/ScanIndex/CardsIndexMetadata.json"

MARGIN = {"true_margin", "false_margin"}
WRONG = {"false", "false_margin"}
POSITIVE = {"true", "true_margin"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset-name", default="tcger-sessions")
    ap.add_argument("--metadata", default=str(DEFAULT_METADATA))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    valid_ids = {c["cardId"] for c in json.load(open(args.metadata))}

    import fiftyone as fo
    from fiftyone import ViewField as F

    dataset = fo.load_dataset(args.dataset_name)
    sessions_dir = Path(dataset.info["sessions_dir"])
    view = dataset.match(F("verdict") != None)

    edits = {}          # session -> {imageFile -> {field: value}}
    applied, skipped_no_id, conflicts, bad_ids = [], [], [], []

    binder_skipped = []
    for sample in view.iter_samples():
        verdict = sample["verdict"]
        key = sample["key"]
        if sample["frame_type"] == "binder":
            # Binder pages replay through their own harness; a single-card
            # expectedCardId on the whole page would be meaningless.
            binder_skipped.append(key)
            continue
        session, image_file = key.split("/", 1)

        if verdict == "no_card":
            target = {"expectedNoMatch": True, "expectedCardId": None}
            expected = None
        elif verdict in POSITIVE:
            expected = sample["device_card_id"] or sample["top1_card_id"]
            if expected is None:
                skipped_no_id.append(f"{key}: '{verdict}' but frame has no prediction "
                                     f"to confirm — label the card ID explicitly")
                continue
            target = {"expectedCardId": expected, "expectedNoMatch": None}
        elif verdict in WRONG:
            expected = sample["corrected_card_id"]
            if not expected:
                skipped_no_id.append(f"{key}: wrong-card verdict without an actual ID")
                continue
            target = {"expectedCardId": expected, "expectedNoMatch": None}
        else:
            continue

        if expected is not None and expected not in valid_ids:
            bad_ids.append(f"{key}: '{expected}' is not in the card index")
            continue

        if sample["label_source"] == "curated":
            cur = sample["existing_expected_card_id"]
            cur_nm = sample["existing_expected_no_match"]
            agrees = (verdict == "no_card" and cur_nm) or (expected is not None and expected == cur)
            if not agrees:
                conflicts.append(f"{key}: curated says "
                                 f"{cur or ('noMatch' if cur_nm else '?')}, verdict says "
                                 f"{expected or 'noMatch'} — resolve in the Swift table")
            continue  # curated table stays authoritative either way

        if verdict in MARGIN:
            target["needsMarginEdit"] = True
        edits.setdefault(session, {})[image_file] = target
        applied.append(f"{key}: {verdict} -> {expected or 'noMatch'}")

    for session, frames in sorted(edits.items()):
        results_path = sessions_dir / session / "results.json"
        bundle = json.load(open(results_path))
        by_file = {f["imageFile"]: f for f in bundle.get("frames", [])}
        for image_file, target in frames.items():
            frame = by_file.get(image_file)
            if frame is None:
                print(f"  !! {session}/{image_file} not in results.json — skipped")
                continue
            for field, value in target.items():
                if value is None:
                    frame.pop(field, None)
                else:
                    frame[field] = value
        if not args.dry_run:
            results_path.write_text(json.dumps(bundle, indent=2, sort_keys=True))

    mode = "DRY RUN — " if args.dry_run else ""
    print(f"{mode}{len(applied)} labels -> {len(edits)} session results.json files")
    for line in applied:
        print(f"  {line}")
    for title, items in (("needs card ID (second pass)", skipped_no_id),
                         ("invalid card IDs", bad_ids),
                         ("curated-table conflicts", conflicts),
                         ("binder pages skipped", binder_skipped)):
        if items:
            print(f"\n{title}: {len(items)}")
            for line in items:
                print(f"  {line}")
    if not args.dry_run and edits:
        print("\nRemember to rsync the sessions dir back to Drive (see module docstring).")


if __name__ == "__main__":
    main()
