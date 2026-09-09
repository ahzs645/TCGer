#!/usr/bin/env python3
"""Read-only audit of corner identity and a diagnostic cyclic-loss experiment.

The experimental loss below is deliberately not installed in a trainer. It
uses the installed Ultralytics criterion to test the proposed semantics.
"""
import argparse
import copy
import json
from collections import Counter
from pathlib import Path

from corpus_release import corpus_hash, sha256_bytes, sha256_file, write_json
from reference_geometry import quad_iou
from train_yolo_pose import yolo_line
from training_geometry import context_margins, has_corner_supervision


def cyclic_loss_probe(criterion, prediction, target, mask, area, orientation_known):
    """Diagnostic only: choose a clockwise cyclic phase per unknown instance.

    Per-instance calls use the real criterion without duplicating its formula.
    Masks follow coordinates; reversal and corner permutations are not options.
    """
    import torch

    if prediction.ndim != 3 or prediction.shape[1] != 4:
        raise ValueError("expected a batch of four-corner predictions")
    if target.shape[:2] != prediction.shape[:2] or mask.shape != prediction.shape[:2]:
        raise ValueError("target and mask must match the prediction batch")
    if len(orientation_known) != len(prediction):
        raise ValueError("one orientation flag is required per instance")
    if not len(prediction):
        return prediction.sum() * 0
    losses = []
    for index, known in enumerate(orientation_known):
        phases = (0,) if bool(known) else range(4)
        candidates = [criterion(
            prediction[index:index+1], target[index:index+1].roll(phase, dims=1),
            mask[index:index+1].roll(phase, dims=1), area[index:index+1],
        ) for phase in phases]
        losses.append(torch.stack(candidates).min())
    return torch.stack(losses).mean()


def loss_probe(instance, width, height, margins):
    import torch
    from ultralytics.utils.loss import KeypointLoss

    row = list(map(float, yolo_line(instance, width, height, margins).split()))
    # Restore padded pixels, then apply the same isotropic scale as letterbox.
    padded_width = width + margins["left"] + margins["right"]
    padded_height = height + margins["top"] + margins["bottom"]
    scale = 640 / max(padded_width, padded_height)
    target = torch.tensor(row[5:], dtype=torch.float32).reshape(1, 4, 3)
    target[..., 0] *= padded_width * scale
    target[..., 1] *= padded_height * scale
    mask = target[..., 2] != 0
    area = torch.tensor([[row[3] * row[4] * padded_width * padded_height * scale**2]])
    criterion = KeypointLoss(torch.full((4,), .25))
    variants = []
    for phase in range(4):
        prediction = target[..., :2].roll(phase, dims=1).clone().requires_grad_(True)
        fixed = criterion(prediction, target, mask, area)
        gradient, = torch.autograd.grad(fixed, prediction)
        variants.append({
            "cyclicShift": phase,
            "borderIou": quad_iou(target[0, :, :2].tolist(), prediction[0].detach().tolist()),
            "currentFixedOrderLoss": float(fixed.detach()),
            "currentGradientNorm": float(gradient.norm()),
            "experimentalUnknownOrientationLoss": float(cyclic_loss_probe(
                criterion, prediction, target, mask, area, [False]).detach()),
            "experimentalKnownOrientationLoss": float(cyclic_loss_probe(
                criterion, prediction, target, mask, area, [True]).detach()),
        })
    changed = copy.deepcopy(instance)
    changed["orientationKnown"] = not instance["orientationKnown"]
    return {"exportIgnoresOrientationFlag": yolo_line(instance, width, height, margins)
            == yolo_line(changed, width, height, margins), "variants": variants}


def render_examples(rows, output):
    """Analytical contact sheet; numbered dots are stored targets, not new labels."""
    from PIL import Image, ImageDraw, ImageFont

    try:
        font = ImageFont.truetype("/System/Library/Fonts/Monaco.ttf", 16)
    except OSError:
        font = ImageFont.load_default()
    sheet = Image.new("RGB", (1200, 440 * ((len(rows) + 2) // 3)), "#101923")
    draw = ImageDraw.Draw(sheet)
    colors = ("#ff5565", "#68d5ff", "#77ed9d", "#e6abff")
    for index, row in enumerate(rows):
        x, y = index % 3 * 400, index // 3 * 440
        with Image.open(row["imagePath"]) as source:
            image = source.convert("RGB")
        image.thumbnail((380, 340))
        left, top = x + (400-image.width)//2, y + 66 + (340-image.height)//2
        sheet.paste(image, (left, top))
        draw.text((x+10, y+8), f"Example {index+1} / {row['instanceId']}", fill="white", font=font)
        draw.text((x+10, y+32), f"{row['cornerSource']} / top unknown", fill="#f7d999", font=font)
        points = [(left+p[0]*image.width, top+p[1]*image.height) for p in row["corners"]]
        draw.line(points + points[:1], fill="#ffe395", width=2)
        for number, (px, py) in enumerate(points):
            draw.ellipse((px-5, py-5, px+5, py+5), fill=colors[number])
            tx, ty = max(x+4, min(x+370, px+6)), max(y+56, min(y+386, py+4))
            draw.text((tx, ty), str(number), fill=colors[number], font=font, stroke_width=2, stroke_fill="black")
        draw.text((x+10, y+415), row["recordId"][:30], fill="#a6bacd", font=font)
    sheet.save(output)


def run(args):
    import ultralytics

    manifest = json.loads((args.release / "manifest.json").read_text())
    if corpus_hash(manifest) != manifest["corpusHash"]:
        raise ValueError("manifest corpus hash mismatch")
    counts, starts = Counter(), Counter()
    examples = {"wide": [], "tall": []}
    checked = 0
    for entry in manifest["records"]:
        if entry["split"] != "train":
            continue
        raw = (args.release / entry["path"]).read_bytes()
        if sha256_bytes(raw) != entry["sha256"]:
            raise ValueError(f"record hash mismatch: {entry['recordId']}")
        record = json.loads(raw)
        checked += 1
        source = record["source"]
        width, height = source["width"], source["height"]
        for instance in record["instances"]:
            known = has_corner_supervision(instance)
            origin = "+".join(sorted({c.get("cornerSource", "unknown") for c in instance.get("corners", [])}))
            group = (source["kind"], origin, known, instance["orientationKnown"])
            counts[group] += 1
            if not known:
                continue
            points = [(c["point"]["x"], c["point"]["y"]) for c in instance["corners"]]
            image_start = min(range(4), key=lambda i: points[i][0]*width + points[i][1]*height)
            starts[group + (image_start,)] += 1
            if source["kind"] != "real" or instance["orientationKnown"] or len(record["instances"]) != 1:
                continue
            span_x = (max(p[0] for p in points)-min(p[0] for p in points))*width
            span_y = (max(p[1] for p in points)-min(p[1] for p in points))*height
            bucket = "wide" if span_x > span_y*1.15 else "tall"
            if len(examples[bucket]) >= (6 if bucket == "wide" else 3):
                continue
            image_path = args.release / source["path"]
            image_binding = next(im for im in entry["images"] if im["path"] == source["path"])
            if sha256_file(image_path) != image_binding["sha256"]:
                raise ValueError(f"image hash mismatch: {entry['recordId']}")
            examples[bucket].append({
                "recordId": record["recordId"], "recordSha256": entry["sha256"],
                "instanceId": instance["instanceId"], "cornerSource": origin,
                "imagePath": str(image_path.resolve()), "imageSha256": image_binding["sha256"],
                "corners": points, "orientationKnown": False,
                "probe": loss_probe(instance, width, height, context_margins(record, args.context_policy)),
            })
    def key_fields(key):
        return dict(source=key[0], cornerSource=key[1], coordinatesKnown=key[2], orientationKnown=key[3])
    selected = examples["wide"] + examples["tall"]
    result = {
        "release": str(args.release.resolve()), "corpusHash": manifest["corpusHash"],
        "trainRecordsVerified": checked, "ultralyticsVersion": ultralytics.__version__,
        "toolSha256": sha256_file(Path(__file__)),
        "counts": [dict(key_fields(k), cards=v) for k,v in sorted(counts.items())],
        "imageUpperLeftIndex": [dict(key_fields(k), index=k[4], cards=v) for k,v in sorted(starts.items())],
        "exampleSelection": "First six wide and first three other single-card, real, orientation-unknown train records in manifest order. Illustrative, not a prevalence estimate.",
        "examples": selected,
        "scope": "No labels, checkpoints, trainer behavior or benchmark results changed. Cyclic loss is an isolated diagnostic prototype, not an integrated trainer.",
    }
    args.output.mkdir(parents=True, exist_ok=False)
    write_json(args.output / "audit.json", result)
    if selected:
        render_examples(selected, args.output / "training-examples.png")
    print(json.dumps({k:result[k] for k in ("corpusHash", "trainRecordsVerified", "counts")}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.context_policy = json.loads(args.config.read_text())["fairness"]["realContextMarginPolicy"]
    run(args)
