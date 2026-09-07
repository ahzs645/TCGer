#!/usr/bin/env python3
"""Render deterministic per-archive panels of repaired whole-card targets.

For every canonical archive in a category-aware release, draw the first N
records (sorted by record id): retained card targets in green (box, known
corners numbered TL/TR/BR/BL when present), and the canonical auxiliary/context
annotations that were deliberately not imported as cards in dashed orange
(slab) or magenta (regions). The panel is a review aid for nested labels,
corner order and polygon-fit quality; it changes no data.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw

TILE = 320
COLORS = {"primary": (40, 200, 60), "context": (255, 140, 0), "auxiliary": (230, 40, 200)}


def _dashed(draw, points, fill, dash=6):
    for start, end in zip(points, points[1:] + points[:1]):
        dx, dy = end[0] - start[0], end[1] - start[1]
        length = max((dx * dx + dy * dy) ** 0.5, 1e-6)
        steps = int(length // dash)
        for step in range(0, steps, 2):
            a = (start[0] + dx * step / steps, start[1] + dy * step / steps)
            b = (start[0] + dx * min(step + 1, steps) / steps, start[1] + dy * min(step + 1, steps) / steps)
            draw.line([a, b], fill=fill, width=2)


def render(release: Path, canonical: Path, output: Path, per_archive: int) -> dict:
    manifest = json.loads((release / "manifest.json").read_text())
    roles = {
        item["name"]: item["role"]
        for item in manifest["targetSemantics"] and [
            *[{"name": n, "role": "primary"} for n in manifest["targetSemantics"]["primaryCategories"]],
            *[{"name": n, "role": "auxiliary"} for n in manifest["targetSemantics"]["auxiliaryCategories"]],
            *[{"name": n, "role": "context"} for n in manifest["targetSemantics"]["contextCategories"]],
        ]
    }
    with canonical.open() as stream:
        source_rows = {row["sha256"]: row for row in map(json.loads, stream)}
    by_archive = defaultdict(list)
    for entry in sorted(manifest["records"], key=lambda item: item["recordId"]):
        if entry["recordId"].startswith("coco-"):
            by_archive[entry["leakageKeys"]["sourceArchiveId"]].append(entry)
    output.mkdir(parents=True, exist_ok=True)
    index = {}
    for archive, entries in sorted(by_archive.items()):
        chosen = entries[:per_archive]
        panel = Image.new("RGB", (TILE * len(chosen), TILE + 18), (20, 20, 20))
        draw = ImageDraw.Draw(panel)
        for column, entry in enumerate(chosen):
            record = json.loads((release / entry["path"]).read_text())
            source = source_rows[record["source"]["sha256"]]
            with Image.open(release / record["source"]["path"]) as opened:
                image = opened.convert("RGB")
            scale = TILE / max(image.size)
            tile = image.resize((max(1, int(image.width * scale)), max(1, int(image.height * scale))))
            ox, oy = column * TILE, 18
            panel.paste(tile, (ox, oy))
            w, h = tile.size
            for annotation in source["annotations"]:
                role = roles.get(annotation["category"], "auxiliary")
                if role == "primary":
                    continue
                x, y, bw, bh = annotation["bbox"]
                sx, sy = w / source["width"], h / source["height"]
                pts = [(ox + x * sx, oy + y * sy), (ox + (x + bw) * sx, oy + y * sy),
                       (ox + (x + bw) * sx, oy + (y + bh) * sy), (ox + x * sx, oy + (y + bh) * sy)]
                _dashed(draw, pts, COLORS[role])
            for instance in record["instances"]:
                box = instance["box"]
                draw.rectangle(
                    [ox + box["left"] * w, oy + box["top"] * h, ox + box["right"] * w, oy + box["bottom"] * h],
                    outline=COLORS["primary"], width=2,
                )
                if all(c.get("coordinateKnown") for c in instance["corners"]):
                    pts = [(ox + c["point"]["x"] * w, oy + c["point"]["y"] * h) for c in instance["corners"]]
                    draw.polygon(pts, outline=(255, 255, 0))
                    for number, (px, py) in enumerate(pts):
                        draw.text((px + 2, py + 2), str(number), fill=(255, 255, 0))
            label = f"{entry['split']} {record['recordId'][5:17]} cards={len(record['instances'])} " \
                    f"cats={record['source']['annotationCategories']}"
            draw.text((ox + 2, 2), label[: TILE // 6], fill=(255, 255, 255))
        name = archive.replace(":", "_").replace(".", "_") + ".jpg"
        panel.save(output / name, quality=82)
        index[archive] = {"panel": name, "records": [entry["recordId"] for entry in chosen]}
    (output / "index.json").write_text(json.dumps(index, indent=2, sort_keys=True) + "\n")
    return index


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--canonical", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--per-archive", type=int, default=6)
    args = parser.parse_args()
    index = render(args.release, args.canonical, args.output, args.per_archive)
    print(json.dumps({archive: item["panel"] for archive, item in index.items()}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
