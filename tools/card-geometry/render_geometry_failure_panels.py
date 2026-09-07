#!/usr/bin/env python3
"""Render pinned labels, predictions and recognition crop diagnostics."""

import argparse
import hashlib
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image
import numpy as np

from benchmark_geometry import _truth_geometry
from crop_parity import warp_reference


def points(result):
    return [(c["point"]["x"], c["point"]["y"]) for c in result["corners"]]


def paint(ax, image, polygons, color):
    ax.imshow(image)
    w, h = image.size
    for i, poly in enumerate(polygons):
        if not poly:
            continue
        pts = list(poly) + [poly[0]]
        ax.plot([p[0] * w for p in pts], [p[1] * h for p in pts], color=color, lw=1.2)
        ax.text(
            poly[0][0] * w,
            poly[0][1] * h,
            str(i + 1),
            color=color,
            fontsize=7,
            bbox=dict(facecolor="black", alpha=0.6, pad=1),
        )
    ax.axis("off")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--images", type=Path, required=True)
    args = parser.parse_args()
    samples = json.loads((args.audit / "audit-inputs.json").read_text())["samples"]
    samples = {s["recordId"]: s for s in samples if s["scope"] == "evaluation"}
    reports = {
        name: {
            r["recordId"]: r
            for r in json.loads((args.audit / f"{short}-raw-audit.json").read_text())[
                "rows"
            ]
            if r["scope"] == "evaluation"
        }
        for short, name in [("yolox", "YOLOX"), ("yolo11s", "YOLO11s")]
    }
    selected = {}

    def image_for(s):
        path = args.images / s["imagePath"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == s["imageSha256"]
        return Image.open(path).convert("RGB")

    for scene in ["binder_page", "duel_field"]:
        chosen = sorted(
            (s for s in samples.values() if s["sceneSlice"] == scene),
            key=lambda s: s["recordId"],
        )[:3]
        selected[scene] = [s["recordId"] for s in chosen]
        fig, axes = plt.subplots(len(chosen), 3, figsize=(12, 13))
        for row, s in enumerate(chosen):
            image = image_for(s)
            paint(
                axes[row, 0],
                image,
                [_truth_geometry(i) for i in s["instances"]],
                "#00ff88",
            )
            axes[row, 0].set_title(
                f"Saved labels: {len(s['instances'])} cards\n{s['recordId'][-16:]}",
                fontsize=9,
            )
            for col, (name, report) in enumerate(reports.items(), 1):
                r = report[s["recordId"]]
                paint(
                    axes[row, col], image, [points(x) for x in r["accepted"]], "#ff69cc"
                )
                axes[row, col].set_title(
                    f"{name}: {len(r['native'])} native boxes → {len(r['accepted'])} final outlines",
                    fontsize=9,
                )
        fig.suptitle(
            f"{scene.replace('_', ' ').title()} — original frozen predictions",
            fontsize=16,
        )
        fig.tight_layout()
        fig.savefig(args.audit / f"{scene}-comparison.jpg", dpi=150)
        plt.close(fig)
    replay = {
        name: {
            r["recordId"]: r
            for r in json.loads(
                (
                    args.audit
                    / "frozen-outputs"
                    / candidate
                    / "recognition-replay.json"
                ).read_text()
            )["frames"]
        }
        for name, candidate in [("YOLOX", "yolox-pose"), ("YOLO11s", "yolo11s-pose")]
    }
    chosen = sorted(
        (
            s
            for key, s in samples.items()
            if replay["YOLO11s"].get(key, {}).get("expectation") == "identify"
        ),
        key=lambda s: (
            replay["YOLO11s"][s["recordId"]]["outcome"] != "wrong",
            s["recordId"],
        ),
    )[:3]
    selected["recognition"] = [s["recordId"] for s in chosen]
    fig, axes = plt.subplots(3, 4, figsize=(12, 12))
    for row, s in enumerate(chosen):
        image = image_for(s)
        truths = [_truth_geometry(i) for i in s["instances"]]
        paint(axes[row, 0], image, truths, "#00ff88")
        axes[row, 0].set_title(s["recordId"][-16:], fontsize=9)
        crops = [("Label crop (not recognition-scored)", truths[0])]
        for name in reports:
            preds = reports[name][s["recordId"]]["accepted"]
            top = max(preds, key=lambda p: p["confidence"]) if preds else None
            r = replay[name][s["recordId"]]
            crops.append(
                (
                    f"{name}: {r['outcome']}\n{r.get('acceptedFamily') or 'no accepted identity'}",
                    points(top) if top else None,
                )
            )
        for col, (label, q) in enumerate(crops, 1):
            if q and len(q) == 4:
                warped = warp_reference(
                    np.asarray(image),
                    q,
                    mapping="imageEdge",
                    kernel="bilinear",
                    inset=0,
                    border="black",
                )
                axes[row, col].imshow(warped)
            axes[row, col].axis("off")
            axes[row, col].set_title(label, fontsize=9)
    fig.suptitle(
        "Verified-identity frames — label crop vs highest-confidence model crop\nReplay also tries 180° rotation; displayed crops use original corner order",
        fontsize=13,
    )
    fig.tight_layout()
    fig.savefig(args.audit / "recognition-crops.jpg", dpi=150)
    plt.close(fig)
    (args.audit / "visual-samples.json").write_text(
        json.dumps(selected, indent=2) + "\n"
    )


if __name__ == "__main__":
    main()
