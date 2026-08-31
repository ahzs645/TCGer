#!/usr/bin/env python3
"""Validate a Yu-Gi-Oh field corpus and emit bench_localizers sessions.

The manifest deliberately records expected rejection cases. A face-down card,
an unknown card, or a crop that cannot be identified is not assigned a fake
catalog label; the acceptance benchmark must count an asserted identity there
as a wrong accept.
"""
from __future__ import annotations

import argparse
import collections
import json
import re
from pathlib import Path

KIND = "tcger-yugioh-acceptance-v1"
SLICES = {"single_handheld", "steep_playmat", "duel_field"}
FACES = {"face_up", "face_down", "partial"}
EXPECTATIONS = {"identify", "reject"}
PASSCODE = re.compile(r"^[0-9]{8}$")


def _passcode(value: object, field: str, key: str) -> str:
    normalized = str(value or "").strip()
    if not PASSCODE.fullmatch(normalized):
        raise ValueError(f"{key}: {field} must be an 8-digit Yu-Gi-Oh passcode")
    return normalized


def validate_manifest(path: Path, minimum_per_slice: int = 1) -> tuple[list[dict], dict]:
    manifest_path = path.resolve()
    data = json.loads(manifest_path.read_text())
    if data.get("kind") != KIND:
        raise ValueError(f"kind must be {KIND!r}")
    raw_frames = data.get("frames")
    if not isinstance(raw_frames, list) or not raw_frames:
        raise ValueError("frames must be a non-empty array")

    seen: set[str] = set()
    counts: collections.Counter[str] = collections.Counter()
    expected_counts: collections.Counter[str] = collections.Counter()
    frames: list[dict] = []
    for position, raw in enumerate(raw_frames):
        if not isinstance(raw, dict):
            raise ValueError(f"frame {position}: must be an object")
        key = str(raw.get("key") or "").strip()
        if not key:
            raise ValueError(f"frame {position}: key is required")
        if key in seen:
            raise ValueError(f"duplicate frame key: {key}")
        seen.add(key)

        slice_name = str(raw.get("slice") or "")
        face = str(raw.get("face") or "face_up")
        expected = str(raw.get("expected") or "identify")
        if slice_name not in SLICES:
            raise ValueError(f"{key}: slice must be one of {sorted(SLICES)}")
        if face not in FACES:
            raise ValueError(f"{key}: face must be one of {sorted(FACES)}")
        if expected not in EXPECTATIONS:
            raise ValueError(f"{key}: expected must be one of {sorted(EXPECTATIONS)}")
        if face == "face_down" and expected != "reject":
            raise ValueError(f"{key}: face-down cards must use expected='reject'")

        image_path = Path(str(raw.get("path") or ""))
        if not image_path.is_absolute():
            image_path = manifest_path.parent / image_path
        image_path = image_path.resolve()
        if not image_path.is_file():
            raise ValueError(f"{key}: image does not exist: {image_path}")

        target_quad = raw.get("targetQuad")
        if slice_name == "duel_field" and target_quad is None:
            raise ValueError(f"{key}: duel_field instances require a pixel-space targetQuad")
        if target_quad is not None:
            if (
                not isinstance(target_quad, list)
                or len(target_quad) != 4
                or any(
                    not isinstance(point, list)
                    or len(point) != 2
                    or any(not isinstance(value, (int, float)) or value < 0 for value in point)
                    for point in target_quad
                )
            ):
                raise ValueError(f"{key}: targetQuad must contain four non-negative [x, y] pixel points")

        label = None
        if expected == "identify":
            label = _passcode(raw.get("label"), "label", key)
        elif raw.get("label") not in (None, ""):
            raise ValueError(f"{key}: reject cases must not provide a label")

        raw_deck = raw.get("deckExternalIds") or []
        if not isinstance(raw_deck, list):
            raise ValueError(f"{key}: deckExternalIds must be an array")
        deck_ids = sorted({_passcode(value, "deckExternalIds entry", key) for value in raw_deck})
        if deck_ids and label is not None and label not in deck_ids:
            raise ValueError(f"{key}: identify label must be included in deckExternalIds")

        counts[slice_name] += 1
        expected_counts[expected] += 1
        frames.append(
            {
                "key": key,
                "path": str(image_path),
                "mode": "yugioh",
                "label": label,
                "expected": expected,
                "slice": slice_name,
                "face": face,
                "deckExternalIds": deck_ids,
                "targetQuad": target_quad,
                "notes": str(raw.get("notes") or "").strip(),
            }
        )

    missing = [name for name in sorted(SLICES) if counts[name] < minimum_per_slice]
    if missing:
        raise ValueError(
            f"each acceptance slice needs at least {minimum_per_slice} frame(s); missing: {', '.join(missing)}"
        )
    summary = {
        "kind": KIND,
        "frames": len(frames),
        "slices": dict(sorted(counts.items())),
        "expectations": dict(sorted(expected_counts.items())),
        "deckScopedFrames": sum(bool(frame["deckExternalIds"]) for frame in frames),
    }
    return frames, summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path, help="bench_localizers-compatible sessions JSON")
    parser.add_argument("--minimum-per-slice", type=int, default=1)
    args = parser.parse_args()
    if args.minimum_per_slice < 1:
        parser.error("--minimum-per-slice must be at least 1")
    try:
        frames, summary = validate_manifest(args.manifest, args.minimum_per_slice)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        parser.error(str(error))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(frames, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
