#!/usr/bin/env python3
"""Build a FiftyOne dataset for hand-labeling exported scan sessions.

Each sample IS the real frame image (frame-NNNN.jpg — full zoom/pan in the
app), with the decisive detection quad attached as a native polyline overlay
(toggleable in the sidebar; the hook for future in-app margin editing). The
pipeline crop and the top-5 retrieval candidates are shown as separate
elements inside the "Card Verdict" panel (see the tcger-card-labeler plugin),
which also carries the five verdict buttons. Verdicts are written back into
each session's results.json by writeback.py.

Usage:
  ~/.venvs/tcger-label/bin/python build_dataset.py \
      --sessions-dir ~/Downloads/Reference/TCGer-Session-Reference/sessions
  ~/.venvs/tcger-label/bin/fiftyone app launch tcger-sessions
"""

import argparse
import json
import re
import sys
from pathlib import Path

import requests

SCRIPT_DIR = Path(__file__).resolve().parent
REPO = SCRIPT_DIR.parents[2]
DEFAULT_METADATA = (
    REPO / "ios/TCGer/TCGer/Resources/ScanIndex/CardsIndexMetadata.json"
)
DEFAULT_CURATED = (
    REPO / "ios/TCGer/TCGerTests/DevModeSessionReplayTests.swift"
)


def parse_curated_labels(swift_path: Path):
    """Extract the hand-curated ground-truth tables from the replay test."""
    expected, no_match = {}, set()
    if not swift_path.exists():
        return expected, no_match
    text = swift_path.read_text()
    for m in re.finditer(r'"(scan-session-[\w-]+/frame-\d+\.jpg)":\s*"([\w.-]+)"', text):
        expected[m.group(1)] = m.group(2)
    nm_block = re.search(r"expectedNoMatch:\s*Set<String>\s*=\s*\[(.*?)\]", text, re.S)
    if nm_block:
        no_match = set(re.findall(r'"(scan-session-[\w-]+/frame-\d+\.jpg)"', nm_block.group(1)))
    return expected, no_match


def fetch_card_thumb(card_id, url, cache_dir: Path):
    """Download the catalog image for a card into the cache; path or None."""
    if not url:
        return None
    cached = cache_dir / f"{card_id.replace('/', '_')}.webp"
    if not cached.exists():
        try:
            resp = requests.get(url, timeout=15)
            resp.raise_for_status()
            cached.write_bytes(resp.content)
        except Exception:
            return None
    return cached


def decisive_attempt(record):
    """The attempt whose candidates decided the frame: the accepted one, else
    the attempt with the strongest top candidate."""
    attempts = record.get("attempts") or []
    for a in attempts:
        if a.get("outcome") == "accepted":
            return a
    best = None
    for a in attempts:
        cands = a.get("topCandidates") or []
        if not cands:
            continue
        if best is None or cands[0]["similarity"] > (best.get("topCandidates") or [{}])[0].get("similarity", -1):
            best = a
    return best


def quad_polylines(record, attempt):
    """Detection quads as a FiftyOne overlay (Vision bottom-left origin ->
    FiftyOne top-left). Decisive attempt highlighted; other distinct quads dim."""
    import fiftyone as fo

    def to_points(quad, fit_rect=None):
        pts = []
        for x, y in quad:
            if fit_rect:  # pocket quad relative to the page-fit rect
                x = fit_rect[0] + x * fit_rect[2]
                y = fit_rect[1] + y * fit_rect[3]
            pts.append((x, 1.0 - y))
        return [pts]

    def fit_rect_of(a):
        rect = a.get("binderPageFitRect")
        if isinstance(rect, dict):
            return [rect.get("x", 0), rect.get("y", 0), rect.get("width", 1), rect.get("height", 1)]
        if isinstance(rect, (list, tuple)) and len(rect) == 4:
            return list(rect)
        return None

    lines, seen = [], set()
    for a in (record or {}).get("attempts") or []:
        quad = a.get("quad")
        if not quad:
            continue
        key = json.dumps(quad)
        if key in seen:
            continue
        seen.add(key)
        try:
            lines.append(fo.Polyline(
                label=("decisive" if a is attempt else a.get("kind", "attempt")),
                points=to_points(quad, fit_rect_of(a)),
                closed=True,
                filled=False,
            ))
        except Exception:
            continue
    return fo.Polylines(polylines=lines) if lines else None


def resolve_crop(session_dir, frame, record, attempt, derived_dir, key):
    """Path to the decisive attempt's crop: the recorded attempt JPEG when
    present, else derived on the spot from geometry (derive_crops.py)."""
    attempt_files = (record or {}).get("attemptImageFiles") or []
    if attempt is not None and attempt.get("imageIndex") is not None:
        idx = attempt["imageIndex"]
        if 0 <= idx < len(attempt_files) and (session_dir / attempt_files[idx]).exists():
            return str(session_dir / attempt_files[idx])
    if attempt_files and (session_dir / attempt_files[0]).exists():
        return str(session_dir / attempt_files[0])
    if attempt is None:
        return None
    out = derived_dir / (key.replace("/", "__") + ".jpg")
    if out.exists():
        return str(out)
    try:
        import cv2

        sys.path.insert(0, str(SCRIPT_DIR))
        import derive_crops as dc

        attempts = record.get("attempts") or []
        flags = dc.orientation_flags(attempts)
        bgr = dc.load_bgr(session_dir / record["imageFile"])
        derived = dc.derive_attempt(bgr, attempt, flags[attempts.index(attempt)]) \
            if bgr is not None else None
        if derived is None:
            return None
        cv2.imwrite(str(out), derived, [cv2.IMWRITE_JPEG_QUALITY, 90])
        return str(out)
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sessions-dir", required=True)
    ap.add_argument("--dataset-name", default="tcger-sessions")
    ap.add_argument("--metadata", default=str(DEFAULT_METADATA))
    ap.add_argument("--curated-swift", default=str(DEFAULT_CURATED))
    ap.add_argument("--out-dir", default=None,
                    help="card cache / derived crops (default: <sessions-dir>/../labeling)")
    args = ap.parse_args()

    sessions_dir = Path(args.sessions_dir).expanduser()
    out_dir = Path(args.out_dir).expanduser() if args.out_dir else sessions_dir.parent / "labeling"
    cache_dir = out_dir / "card-cache"
    derived_dir = out_dir / "derived-crops"
    cache_dir.mkdir(parents=True, exist_ok=True)
    derived_dir.mkdir(parents=True, exist_ok=True)

    card_meta = {c["cardId"]: c for c in json.load(open(args.metadata))}
    curated_expected, curated_no_match = parse_curated_labels(Path(args.curated_swift))
    print(f"catalog: {len(card_meta)} cards; curated labels: "
          f"{len(curated_expected)} + {len(curated_no_match)} noMatch")

    import fiftyone as fo

    if fo.dataset_exists(args.dataset_name):
        existing = fo.load_dataset(args.dataset_name)
        from fiftyone import ViewField as F
        n_verdicts = len(existing.match(F("verdict") != None))
        if n_verdicts:
            print(f"REFUSING to rebuild: {n_verdicts} unsaved verdicts in "
                  f"'{args.dataset_name}'. Run writeback.py first, or delete "
                  f"the dataset manually.")
            sys.exit(1)
        fo.delete_dataset(args.dataset_name)
    dataset = fo.Dataset(args.dataset_name, persistent=True)

    samples = []
    n_sessions = 0
    for session_dir in sorted(sessions_dir.glob("scan-session-*")):
        results_path = session_dir / "results.json"
        if not results_path.exists():
            continue
        n_sessions += 1
        bundle = json.load(open(results_path))
        try:
            evidence = json.load(open(session_dir / "evidence.json"))
        except Exception:
            evidence = []
        by_image = {r["imageFile"]: r for r in evidence if isinstance(r, dict)}

        for frame in bundle.get("frames", []):
            frame_path = session_dir / frame["imageFile"]
            if not frame_path.exists():
                continue
            record = by_image.get(frame["imageFile"])
            key = f"{session_dir.name}/{frame['imageFile']}"
            is_binder = bool(record and str(record.get("outcome", "")).startswith("binderPage"))

            attempt = decisive_attempt(record) if record else None
            cands = (attempt or {}).get("topCandidates") or []
            for c in cands[:5]:  # warm the card cache for the panel
                meta = card_meta.get(c["cardID"]) or {}
                fetch_card_thumb(c["cardID"], meta.get("imageURL"), cache_dir)
            device_id = frame.get("bestMatchCardId") if frame.get("identified") else None
            existing_label = (
                curated_expected.get(key)
                or (None if key in curated_no_match else frame.get("expectedCardId"))
            )
            existing_no_match = key in curated_no_match or bool(frame.get("expectedNoMatch"))

            sample = fo.Sample(
                filepath=str(frame_path),
                key=key,
                session=session_dir.name,
                frame_file=frame["imageFile"],
                frame_index=frame.get("index"),
                frame_type="binder" if is_binder else "single",
                device_card_id=device_id,
                device_identified=bool(frame.get("identified")),
                device_confidence=frame.get("confidence"),
                outcome=(record or {}).get("outcome"),
                crop_path=resolve_crop(session_dir, frame, record, attempt, derived_dir, key),
                top1_card_id=cands[0]["cardID"] if cands else None,
                top1_similarity=cands[0]["similarity"] if cands else None,
                top5_card_ids=[c["cardID"] for c in cands[:5]],
                top5_similarities=[c["similarity"] for c in cands[:5]],
                top5_names=[c.get("name") for c in cands[:5]],
                existing_expected_card_id=existing_label,
                existing_expected_no_match=existing_no_match,
                label_source=(
                    "curated" if key in curated_expected or key in curated_no_match
                    else "recorded" if existing_label or existing_no_match
                    else None
                ),
                verdict=None,
                corrected_card_id=None,
            )
            overlay = quad_polylines(record, attempt)
            if overlay is not None:
                sample["detection_quads"] = overlay
            sample.tags.append("binder" if is_binder else "single")
            if existing_label or existing_no_match:
                sample.tags.append("already-labeled")
            elif not is_binder:
                sample.tags.append("device-accepted" if device_id else "device-abstained")
            samples.append(sample)

    dataset.add_samples(samples)
    dataset.info["sessions_dir"] = str(sessions_dir)
    dataset.info["card_cache_dir"] = str(cache_dir)
    dataset.save()

    from fiftyone import ViewField as F
    dataset.save_view("to-label: accepts", dataset.match_tags("device-accepted"))
    dataset.save_view("to-label: abstains", dataset.match_tags("device-abstained"))
    dataset.save_view("already labeled", dataset.match_tags("already-labeled"))
    dataset.save_view("binder pages", dataset.match_tags("binder"))
    dataset.save_view("verdict applied", dataset.match(F("verdict") != None))

    print(f"\n{len(samples)} frames from {n_sessions} sessions -> dataset '{args.dataset_name}'")
    for tag in ("device-accepted", "device-abstained", "already-labeled", "binder"):
        print(f"  {tag}: {len(dataset.match_tags(tag))}")
    print("\nLaunch:  ~/.venvs/tcger-label/bin/fiftyone app launch " + args.dataset_name)


if __name__ == "__main__":
    main()
