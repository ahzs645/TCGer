#!/usr/bin/env python3
"""Build a FiftyOne dataset for hand-labeling exported scan sessions.

Each sample IS the real frame image (frame-NNNN.jpg — full zoom/pan in the
app), with the decisive detection quad attached as a native polyline overlay
(toggleable in the sidebar; the hook for future in-app margin editing). The
pipeline crop and the top-5 retrieval candidates are shown as separate
elements inside the "Card Verdict" panel (see the tcger-card-labeler plugin),
which also carries single-card verdicts and independent per-pocket binder
labels. Single-card verdicts are written back into each session's results.json
by writeback.py; binder labels remain in the dataset, journal, and backups
until the session format has a stable per-pocket ground-truth schema.

Usage:
  ~/.venvs/tcger-label/bin/python build_dataset.py \
      --sessions-dir "$TCGER_REFERENCE_LIBRARY/sessions"
  ~/.venvs/tcger-label/bin/fiftyone app launch tcger-sessions
"""

import argparse
import datetime
import json
import os
import re
import sys
from pathlib import Path

import requests

SCRIPT_DIR = Path(__file__).resolve().parent
IMAGE_REQUEST_HEADERS = {
    "User-Agent": "TCGer/1.0 (+https://tcger.ahmadjalil.com)",
    "Accept": "image/*",
}
REPO = SCRIPT_DIR.parents[2]
PROJECT_ROOT = REPO.parent
DEFAULT_METADATA = (
    REPO / "ios/TCGer/TCGer/Resources/ScanIndex/CardsIndexMetadata.json"
)
DEFAULT_MAGIC_METADATA = (
    PROJECT_ROOT
    / ".artifacts/scanner-release/magic-visual-style-v2-5c27e506-r2"
    / "exports/magic/full/visual-style-v2-5c27e506-r2/CardsIndexMetadata.json"
)
DEFAULT_MAGIC_PRINTINGS_METADATA = (
    PROJECT_ROOT
    / ".artifacts/two-stage-catalog-family-v3/magic/CardsIndexMetadata.json"
)
DEFAULT_CURATED = (
    REPO / "ios/TCGer/TCGerTests/DevModeSessionReplayTests.swift"
)


def default_labeling_cache_dir():
    """Keep reproducible thumbnails/crops out of the synced reference data."""
    override = os.environ.get("TCGER_LABELING_CACHE_DIR")
    if override:
        return Path(override).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library/Caches/TCGer/session-labeling"
    cache_home = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return cache_home / "tcger/session-labeling"


def default_labeling_state_dir(sessions_dir: Path):
    """Locate irreplaceable labels separately from captured session bytes."""
    override = os.environ.get("TCGER_LABELING_STATE_DIR")
    if override:
        return Path(override).expanduser()
    session_root = sessions_dir.parent
    if session_root.name == "TCGer-Session-Reference":
        return session_root.parent / "TCGer-Labeling/fiftyone-sessions"
    # Portable fallback for ad-hoc libraries that do not use the canonical
    # Reference/TCGer-* layout.
    return session_root / "labeling"


def normalized_game(mode):
    """Return the platform-neutral game identifier used by labeler filters."""
    value = str(mode or "").strip().lower()
    aliases = {
        "mtg": "magic",
        "magic-the-gathering": "magic",
        "pokémon": "pokemon",
        "ygo": "yugioh",
        "yu-gi-oh": "yugioh",
    }
    return aliases.get(value, value) or None


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
    safe_id = card_id.replace("/", "_")
    cached = cache_dir / f"{safe_id}.webp"
    failure = cache_dir / ".failures" / f"{safe_id}.json"
    if failure.exists():
        age = datetime.datetime.now().timestamp() - failure.stat().st_mtime
        if age < 24 * 60 * 60:
            return None
    if not cached.exists():
        try:
            resp = requests.get(url, timeout=15, headers=IMAGE_REQUEST_HEADERS)
            resp.raise_for_status()
            cached.write_bytes(resp.content)
            failure.unlink(missing_ok=True)
        except Exception as exc:
            failure.parent.mkdir(parents=True, exist_ok=True)
            failure.write_text(
                json.dumps(
                    {
                        "card_id": card_id,
                        "url": url,
                        "attempted_at": datetime.datetime.now().isoformat(
                            timespec="seconds"
                        ),
                        "error": f"{type(exc).__name__}: {exc}",
                    },
                    indent=2,
                )
            )
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


def attempt_crop_path(session_dir, record, attempt, derived_dir, name):
    """Path to one attempt's crop: the recorded attempt JPEG when present,
    else derived on the spot from geometry (derive_crops.py)."""
    attempt_files = (record or {}).get("attemptImageFiles") or []
    idx = attempt.get("imageIndex")
    if idx is not None and 0 <= idx < len(attempt_files) \
            and (session_dir / attempt_files[idx]).exists():
        return str(session_dir / attempt_files[idx])
    out = derived_dir / (name + ".jpg")
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


def resolve_crop(session_dir, frame, record, attempt, derived_dir, key):
    if attempt is not None:
        path = attempt_crop_path(
            session_dir, record, attempt, derived_dir, key.replace("/", "__")
        )
        if path:
            return path
    attempt_files = (record or {}).get("attemptImageFiles") or []
    if attempt_files and (session_dir / attempt_files[0]).exists():
        return str(session_dir / attempt_files[0])
    return None


def binder_pockets(session_dir, record, derived_dir, key):
    """Per-pocket summaries for a binder-page frame.

    New-schema attempts carry pocketIndex (with upright/180 pairs per pocket);
    old-schema binder frames have exactly one attempt per detected pocket, so
    each attempt IS a pocket."""
    attempts = (record or {}).get("attempts") or []
    groups = {}
    if any(a.get("pocketIndex") is not None for a in attempts):
        for a in attempts:
            groups.setdefault(a.get("pocketIndex"), []).append(a)
        groups.pop(None, None)
    else:
        groups = {i: [a] for i, a in enumerate(attempts)}

    pockets = []
    for pocket_idx in sorted(groups):
        group = groups[pocket_idx]
        decisive = next((a for a in group if a.get("outcome") == "accepted"), None)
        if decisive is None:
            decisive = max(
                group,
                key=lambda a: (a.get("topCandidates") or [{}])[0].get("similarity", -1),
            )
        cands = (decisive.get("topCandidates") or [])[:3]
        crop = attempt_crop_path(
            session_dir, record, decisive, derived_dir,
            f"{key.replace('/', '__')}__pocket{pocket_idx}",
        )
        pockets.append({
            "pocket": pocket_idx,
            "outcome": decisive.get("binderStatus") or decisive.get("outcome"),
            "matched_card_id": cands[0]["cardID"]
            if cands and decisive.get("outcome") == "accepted" else None,
            "crop_path": crop,
            "cands": [
                {"id": c["cardID"], "sim": round(c["similarity"], 4)} for c in cands
            ],
        })
    return pockets


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sessions-dir", required=True)
    ap.add_argument("--dataset-name", default="tcger-sessions")
    ap.add_argument(
        "--metadata",
        action="append",
        default=None,
        help=(
            "card metadata JSON; repeat for multiple games (default: bundled "
            "Pokémon plus local Magic exact-print and v2 release artifacts "
            "when present)"
        ),
    )
    ap.add_argument("--curated-swift", default=str(DEFAULT_CURATED))
    ap.add_argument(
        "--out-dir",
        default=None,
        help=(
            "card cache / derived crops (default: TCGER_LABELING_CACHE_DIR or "
            "the platform user cache)"
        ),
    )
    args = ap.parse_args()

    sessions_dir = Path(args.sessions_dir).expanduser()
    out_dir = (
        Path(args.out_dir).expanduser()
        if args.out_dir
        else default_labeling_cache_dir()
    )
    cache_dir = out_dir / "card-cache"
    derived_dir = out_dir / "derived-crops"
    cache_dir.mkdir(parents=True, exist_ok=True)
    derived_dir.mkdir(parents=True, exist_ok=True)

    metadata_paths = (
        [Path(value).expanduser() for value in args.metadata]
        if args.metadata
        else [DEFAULT_METADATA]
        + (
            [DEFAULT_MAGIC_PRINTINGS_METADATA]
            if DEFAULT_MAGIC_PRINTINGS_METADATA.exists()
            else []
        )
        + ([DEFAULT_MAGIC_METADATA] if DEFAULT_MAGIC_METADATA.exists() else [])
    )
    card_meta = {}
    for metadata_path in metadata_paths:
        with open(metadata_path, encoding="utf-8") as source:
            card_meta.update({c["cardId"]: c for c in json.load(source)})
    curated_expected, curated_no_match = parse_curated_labels(Path(args.curated_swift))
    print(f"catalog: {len(card_meta)} cards from {len(metadata_paths)} files; curated labels: "
          f"{len(curated_expected)} + {len(curated_no_match)} noMatch")

    import fiftyone as fo

    saved_verdicts = {}
    if fo.dataset_exists(args.dataset_name):
        existing = fo.load_dataset(args.dataset_name)
        from fiftyone import ViewField as F
        if existing.has_sample_field("verdict"):
            has_fix = existing.has_sample_field("fixed_quad_json")
            has_rerun = existing.has_sample_field("rerun_top5_json")
            has_rescan = existing.has_sample_field("binder_rerun_json")
            has_binder_labels = existing.has_sample_field("binder_labels_json")
            has_manual_instances = existing.has_sample_field("manual_instances_json")
            keep = F("verdict") != None
            if has_rescan:
                # Binder pages carry re-scans without ever having a verdict.
                keep = keep | (F("binder_rerun_json") != None)
            if has_binder_labels:
                # Per-pocket judgments are separate from page-level verdicts.
                keep = keep | (F("binder_labels_json") != None)
            if has_manual_instances:
                keep = keep | (F("manual_instances_json") != None)
            for s in existing.match(keep).iter_samples():
                saved_verdicts[s["key"]] = (
                    s["verdict"], s["corrected_card_id"],
                    s["fixed_quad_json"] if has_fix else None,
                    s["fixed_quad_source"] if has_fix else None,
                    s["rerun_top5_json"] if has_rerun else None,
                    s["binder_rerun_json"] if has_rescan else None,
                    s["binder_labels_json"] if has_binder_labels else None,
                    s["manual_instances_json"] if has_manual_instances else None,
                )
        if saved_verdicts:
            print(f"carrying {len(saved_verdicts)} applied verdicts across the rebuild")
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
            pockets = binder_pockets(session_dir, record, derived_dir, key) if is_binder else []
            for pocket in pockets:
                for candidate in pocket["cands"]:
                    meta = card_meta.get(candidate["id"]) or {}
                    candidate["name"] = meta.get("name")
                    candidate["setName"] = meta.get("setName")
                    candidate["collectorNumber"] = meta.get("collectorNumber")
            warm = [c["cardID"] for c in cands[:5]] + [
                c["id"] for p in pockets for c in p["cands"]
            ]
            for cid in warm:  # warm the card cache for the panel
                meta = card_meta.get(cid) or {}
                fetch_card_thumb(cid, meta.get("imageURL"), cache_dir)
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
                game=normalized_game(frame.get("mode")),
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
                top5_names=[
                    c.get("name") or (card_meta.get(c["cardID"]) or {}).get("name")
                    for c in cands[:5]
                ],
                top5_set_names=[
                    (card_meta.get(c["cardID"]) or {}).get("setName")
                    for c in cands[:5]
                ],
                top5_collector_numbers=[
                    (card_meta.get(c["cardID"]) or {}).get("collectorNumber")
                    for c in cands[:5]
                ],
                existing_expected_card_id=existing_label,
                existing_expected_no_match=existing_no_match,
                label_source=(
                    "curated" if key in curated_expected or key in curated_no_match
                    else "recorded" if existing_label or existing_no_match
                    else None
                ),
                binder_pockets_json=json.dumps(pockets) if pockets else None,
                n_pockets=len(pockets) if pockets else None,
                verdict=saved_verdicts.get(key, (None,) * 8)[0],
                corrected_card_id=saved_verdicts.get(key, (None,) * 8)[1],
                fixed_quad_json=saved_verdicts.get(key, (None,) * 8)[2],
                fixed_quad_source=saved_verdicts.get(key, (None,) * 8)[3],
                rerun_top5_json=saved_verdicts.get(key, (None,) * 8)[4],
                binder_rerun_json=saved_verdicts.get(key, (None,) * 8)[5],
                binder_labels_json=saved_verdicts.get(key, (None,) * 8)[6],
                manual_instances_json=saved_verdicts.get(key, (None,) * 8)[7],
            )
            if key in saved_verdicts and saved_verdicts[key][0] is not None:
                sample.tags.append("verdict-applied")
            if key in saved_verdicts and saved_verdicts[key][6] is not None:
                sample.tags.append("binder-labels-applied")
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
    # All-None at build time, so add_samples drops them from the schema;
    # declare them explicitly or the panel/writeback can't read them.
    dataset.add_sample_field("verdict", fo.StringField)
    dataset.add_sample_field("corrected_card_id", fo.StringField)
    dataset.add_sample_field("fixed_quad_json", fo.StringField)
    dataset.add_sample_field("fixed_quad_source", fo.StringField)
    dataset.add_sample_field("rerun_top5_json", fo.StringField)
    dataset.add_sample_field("binder_rerun_json", fo.StringField)
    dataset.add_sample_field("binder_labels_json", fo.StringField)
    dataset.add_sample_field("manual_instances_json", fo.StringField)
    dataset.info["sessions_dir"] = str(sessions_dir)
    dataset.info["card_cache_dir"] = str(cache_dir)
    dataset.info["labeling_state_dir"] = str(
        default_labeling_state_dir(sessions_dir)
    )
    dataset.info["card_metadata_paths"] = [str(path) for path in metadata_paths]
    dataset.save()

    from fiftyone import ViewField as F
    dataset.save_view("to-label: accepts", dataset.match_tags("device-accepted"))
    dataset.save_view("to-label: abstains", dataset.match_tags("device-abstained"))
    dataset.save_view("already labeled", dataset.match_tags("already-labeled"))
    dataset.save_view("binder pages", dataset.match_tags("binder"))
    dataset.save_view(
        "binder labeled", dataset.match(F("binder_labels_json") != None)
    )
    dataset.save_view("verdict applied", dataset.match(F("verdict") != None))
    game_labels = {
        "pokemon": "Pokémon",
        "magic": "Magic",
        "yugioh": "Yu-Gi-Oh!",
    }
    for game in sorted({s.game for s in samples if s.game}):
        label = game_labels.get(game, game.replace("-", " ").title())
        dataset.save_view(f"game: {label}", dataset.match(F("game") == game))

    print(f"\n{len(samples)} frames from {n_sessions} sessions -> dataset '{args.dataset_name}'")
    for tag in ("device-accepted", "device-abstained", "already-labeled", "binder"):
        print(f"  {tag}: {len(dataset.match_tags(tag))}")
    print("\nLaunch:  ~/.venvs/tcger-label/bin/fiftyone app launch " + args.dataset_name)


if __name__ == "__main__":
    main()
