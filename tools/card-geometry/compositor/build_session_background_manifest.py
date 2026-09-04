#!/usr/bin/env python3
"""Extract detector-cleared backgrounds from non-evaluation capture sessions."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from PIL import Image

PARENT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PARENT))

from corpus_release import pretty_json, sha256_bytes, sha256_file  # noqa: E402

from compositor.compositor import ASSET_MANIFEST_SCHEMA, CompositorError  # noqa: E402


POSITIONS = (
    (0.0, 0.0),
    (1.0, 0.0),
    (0.0, 1.0),
    (1.0, 1.0),
    (0.5, 0.0),
    (0.5, 1.0),
    (0.0, 0.5),
    (1.0, 0.5),
)


def session_split(session_id: str) -> str:
    digest = sha256_bytes(f"geometry-background-split-v2:{session_id}".encode())
    return "validation" if int(digest[:8], 16) % 3 == 0 else "train"


def quad_boxes(evidence: dict[str, Any]) -> list[tuple[float, float, float, float]]:
    boxes = []
    for attempt in evidence.get("attempts", []):
        quad = attempt.get("quad") if isinstance(attempt, dict) else None
        if not isinstance(quad, list) or len(quad) != 4:
            continue
        try:
            xs = [float(point[0]) for point in quad]
            ys = [float(point[1]) for point in quad]
        except (TypeError, ValueError, IndexError):
            continue
        margin = 0.08
        boxes.append(
            (
                max(0.0, min(xs) - margin),
                max(0.0, min(ys) - margin),
                min(1.0, max(xs) + margin),
                min(1.0, max(ys) + margin),
            )
        )
    return boxes


def overlap_fraction(
    crop: tuple[float, float, float, float], box: tuple[float, float, float, float]
) -> float:
    left = max(crop[0], box[0])
    top = max(crop[1], box[1])
    right = min(crop[2], box[2])
    bottom = min(crop[3], box[3])
    if right <= left or bottom <= top:
        return 0.0
    return ((right - left) * (bottom - top)) / (
        (crop[2] - crop[0]) * (crop[3] - crop[1])
    )


def choose_crops(
    width: int,
    height: int,
    boxes: list[tuple[float, float, float, float]],
    order_key: str,
) -> list[tuple[int, int, int, int]]:
    if not boxes:
        return []
    # Session captures usually put the card near the centre of the frame.  A
    # full 640 px square can cover most of a portrait capture and leave no
    # genuinely clear candidate.  Keep the crop large enough to retain useful
    # texture while limiting it to 25% of the short side so corner/edge crops
    # can avoid a central card.
    side = min(width, height, 640, max(224, round(min(width, height) * 0.25)))
    norm_w = side / width
    norm_h = side / height
    candidates = []
    for anchor_x, anchor_y in POSITIONS:
        left = anchor_x * (1.0 - norm_w)
        top = anchor_y * (1.0 - norm_h)
        crop = (left, top, left + norm_w, top + norm_h)
        if max((overlap_fraction(crop, box) for box in boxes), default=0.0) > 0.001:
            continue
        digest = sha256_bytes(
            f"geometry-background-crop-v2:{order_key}:{anchor_x}:{anchor_y}".encode()
        )
        candidates.append((digest, crop))
    result = []
    for _, crop in sorted(candidates):
        x0 = round(crop[0] * width)
        y0 = round(crop[1] * height)
        result.append((x0, y0, x0 + side, y0 + side))
    return result


def choose_crop(
    width: int,
    height: int,
    boxes: list[tuple[float, float, float, float]],
    order_key: str,
) -> tuple[int, int, int, int] | None:
    """Return the first stable clear crop for callers that only need one."""
    crops = choose_crops(width, height, boxes, order_key)
    return crops[0] if crops else None


def build_manifest(
    *,
    sessions_root: Path,
    release_manifest: Path,
    train_count: int,
    validation_count: int,
    max_per_session: int,
    output: Path,
) -> dict[str, Any]:
    if output.exists() and any(output.iterdir()):
        raise CompositorError(f"refusing to replace non-empty output: {output}")
    release = json.loads(release_manifest.read_text(encoding="utf-8"))
    denylist = set(release.get("evaluationSessionDenylist", []))
    if not denylist:
        raise CompositorError("release manifest has no evaluation session denylist")
    requested = {"train": train_count, "validation": validation_count}
    candidates: dict[str, list[dict[str, Any]]] = {"train": [], "validation": []}
    per_session: Counter[str] = Counter()
    for session in sorted(sessions_root.glob("scan-session-*")):
        if not session.is_dir() or session.name in denylist:
            continue
        split = session_split(session.name)
        evidence_path = session / "evidence.json"
        if not evidence_path.is_file():
            continue
        value = json.loads(evidence_path.read_text(encoding="utf-8"))
        if not isinstance(value, list):
            continue
        for frame in value:
            if per_session[session.name] >= max_per_session:
                break
            if not isinstance(frame, dict):
                continue
            name = frame.get("imageFile")
            metadata = frame.get("imageMetadata", {})
            source = session / str(name)
            if not name or not source.is_file():
                continue
            try:
                width = int(metadata["pixelWidth"])
                height = int(metadata["pixelHeight"])
            except (KeyError, TypeError, ValueError):
                continue
            crops = choose_crops(width, height, quad_boxes(frame), f"{session.name}/{name}")
            for crop in crops:
                if per_session[session.name] >= max_per_session:
                    break
                candidates[split].append(
                    {
                        "sessionId": session.name,
                        "source": source,
                        "sourceName": str(name),
                        "crop": crop,
                    }
                )
                per_session[session.name] += 1
    for split, count in requested.items():
        candidates[split].sort(
            key=lambda row: sha256_bytes(
                f"geometry-background-order-v1:{row['sessionId']}:{row['sourceName']}".encode()
            )
        )
        if len(candidates[split]) < count:
            raise CompositorError(
                f"need {count} {split} backgrounds but found {len(candidates[split])}"
            )

    output.mkdir(parents=True, exist_ok=True)
    assets_dir = output / "assets"
    assets_dir.mkdir()
    assets = []
    for split, count in requested.items():
        for row in candidates[split][:count]:
            source = row["source"]
            source_sha = sha256_file(source)
            with Image.open(source) as opened:
                crop_image = opened.convert("RGB").crop(row["crop"])
            crop_key = json.dumps(row["crop"], separators=(",", ":"))
            asset_id = (
                f"capture-bg-{row['sessionId']}-"
                f"{sha256_bytes((source_sha + crop_key).encode())[:20]}"
            )
            destination = assets_dir / f"{asset_id}.jpg"
            crop_image.save(destination, "JPEG", quality=92, optimize=False, progressive=False)
            assets.append(
                {
                    "assetId": asset_id,
                    "path": destination.relative_to(output).as_posix(),
                    "sha256": sha256_file(destination),
                    "split": split,
                    "licenseId": "TCGer-self-captured",
                    "provenance": {
                        "author": "TCGer project capture",
                        "sourceSessionId": row["sessionId"],
                        "sourceImage": row["sourceName"],
                        "sourceImageSha256": source_sha,
                        "cropPixels": list(row["crop"]),
                        "clearanceRule": "no overlap with any detected quad bbox expanded by 8 percent",
                        "redistributionStatus": "private-training-only",
                    },
                }
            )
    document = {
        "schema": ASSET_MANIFEST_SCHEMA,
        "role": "background",
        "assets": sorted(assets, key=lambda row: row["assetId"]),
    }
    (output / "background-assets.json").write_text(pretty_json(document), encoding="utf-8")
    return document


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sessions-root", type=Path, required=True)
    parser.add_argument("--release-manifest", type=Path, required=True)
    parser.add_argument("--train-count", type=int, default=80)
    parser.add_argument("--validation-count", type=int, default=20)
    parser.add_argument("--max-per-session", type=int, default=3)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        document = build_manifest(
            sessions_root=args.sessions_root,
            release_manifest=args.release_manifest,
            train_count=args.train_count,
            validation_count=args.validation_count,
            max_per_session=args.max_per_session,
            output=args.output,
        )
    except (CompositorError, OSError, ValueError) as error:
        print(f"background extraction failed: {error}", file=sys.stderr)
        return 2
    print(pretty_json({"assets": len(document["assets"]), "output": str(args.output)}), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
