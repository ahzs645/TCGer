#!/usr/bin/env python3
"""Build a pseudo-labeled real-camera corpus for one game's scanner.

"Synthetic-from-real": the pixels are real photographs (Roboflow card-detection
archives, Dev Mode sessions, folder-labeled sets); the labels are derived by
running the SAME evidence rules the app uses — exact printed title (Apple
Vision OCR via ocr-titles.swift), footer collector number, and the shipped
encoder's own top-1 — and keeping only crops where independent signals agree.
Disagreements go to a review queue; crops with no evidence and no plausible
neighbour become hard-negative candidates.

Inputs are the release runtime (packed int8 vectors + CardsIndexMetadata.json +
the fp32 ONNX encoder) so similarities are the runtime's similarities, and one
or more sources:

  --coco NAME=ANNOTATIONS.json:IMAGE_DIR[:CATEGORY]   card boxes -> crops
  --whole NAME=IMAGE_DIR                             each image IS the card
  --folder-classes NAME=ROOT                         ROOT/<card name>/*.jpg (ground truth)

Roboflow archives carry ~5 augmented copies per source image (`.rf.<hash>`);
they are de-duplicated by base name so a photo contributes one crop per box.

Outputs (OUT/):
  crops/<source>/<id>.jpg     rectified? no — axis-aligned crops, native size
  corpus.jsonl                accepted pseudo-labels (family + optional exact printing)
  review.jsonl                evidence conflicts for human review
  negatives.jsonl             hard-negative candidates (no evidence, low similarity)
  report.json / report.md     coverage, agreement, similarity distributions
  augmentation-bank.json      camera-vs-render statistics from accepted crops

Example (Magic):
  ~/.venvs/tcger-label/bin/python tools/camera-corpus/build_camera_corpus.py \
    --game magic --runtime .artifacts/scanner-release/magic-visual-style-v2-5c27e506-r2/runtime-test \
    --onnx .artifacts/scanner-release/magic-visual-style-v2-5c27e506-r2/android/card-embeddings-arcface-fp32.onnx \
    --coco mtg-6klau=/tmp/mtg-6klau/train/_annotations.coco.json:/tmp/mtg-6klau/train \
    --whole mtg-detection-light-photos=/tmp/mdl-photos \
    --folder-classes magic-classification=/tmp/magic-classification/train \
    --out .artifacts/camera-corpus/magic
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import io
import json
import os
import re
import struct
import subprocess
import sys
import unicodedata
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

REPO_ROOT = Path(__file__).resolve().parents[2]
OCR_SCRIPT = Path(__file__).resolve().parent / "ocr-titles.swift"
EVIDENCE_FLOOR = 0.55
AMBIGUITY_MARGIN = 0.05
MIN_CROP_SIDE = 96


# ---------- text normalisation (mirrors CardTitleOCR.normalizedName) ----------

def normalized_name(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return "".join(ch for ch in stripped.lower() if ch.isalnum())


def normalize_collector(raw: str) -> str:
    trimmed = raw.strip().lower().lstrip("0")
    return trimmed or ("0" if raw.strip() else "")


def edit_distance_at_most_one(left: str, right: str) -> bool:
    if abs(len(left) - len(right)) > 1:
        return False
    i = j = edits = 0
    while i < len(left) and j < len(right):
        if left[i] == right[j]:
            i += 1
            j += 1
            continue
        edits += 1
        if edits > 1:
            return False
        if len(left) > len(right):
            i += 1
        elif len(right) > len(left):
            j += 1
        else:
            i += 1
            j += 1
    return edits + (len(left) - i) + (len(right) - j) <= 1


# ---------- runtime ----------

class Runtime:
    def __init__(self, runtime_dir: Path, onnx_path: Path):
        import onnxruntime as ort

        rows = json.loads((runtime_dir / "CardsIndexMetadata.json").read_text())
        self.rows = rows
        raw = (runtime_dir / "CardsIndexVectors-arcface.bin").read_bytes()
        count, dim = struct.unpack("<II", raw[:8])
        vectors = np.frombuffer(raw[8:], dtype=np.int8).reshape(count, dim).astype(np.float32)
        self.vectors = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
        if count != len(rows):
            raise SystemExit(f"vector rows {count} != metadata rows {len(rows)}")
        self.session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.names_by_key: dict[str, set[int]] = collections.defaultdict(set)
        self.printings_by_key: dict[str, int] = collections.Counter()
        for index, row in enumerate(rows):
            key = normalized_name(row["name"])
            self.names_by_key[key].add(index)
            self.printings_by_key[key] += max(len(row.get("printings") or []), 1)

    @staticmethod
    def preprocess(image: Image.Image) -> np.ndarray:
        # Training/export contract: shortest edge -> 256 (other edge rounded
        # up), bicubic, center-crop 224, [0,1] RGB CHW; ImageNet normalisation
        # is baked into the ONNX graph.
        image = image.convert("RGB")
        width, height = image.size
        scale = 256 / min(width, height)
        resized = image.resize(
            (int(np.ceil(width * scale)), int(np.ceil(height * scale))), Image.BICUBIC
        )
        left = (resized.width - 224) // 2
        top = (resized.height - 224) // 2
        cropped = resized.crop((left, top, left + 224, top + 224))
        array = np.asarray(cropped, dtype=np.float32) / 255.0
        return array.transpose(2, 0, 1)[None]

    def embed(self, image: Image.Image) -> np.ndarray:
        output = self.session.run(None, {self.input_name: self.preprocess(image)})[0][0]
        return output / np.linalg.norm(output)

    def nearest(self, embedding: np.ndarray, limit: int = 10, allowed: set[int] | None = None):
        scores = self.vectors @ embedding
        if allowed is not None:
            mask = np.full(scores.shape, -np.inf)
            idx = np.fromiter(allowed, dtype=np.int64)
            mask[idx] = scores[idx]
            scores = mask
        order = np.argpartition(-scores, min(limit, len(scores) - 1))[:limit]
        order = order[np.argsort(-scores[order])]
        return [(int(i), float(scores[i])) for i in order if np.isfinite(scores[i])]

    def family_of(self, index: int) -> str:
        return self.rows[index].get("recognitionFamilyId") or self.rows[index]["cardId"]

    def printing_options(self, index: int):
        row = self.rows[index]
        options = row.get("printings") or [row]
        def number(printing):
            # Printed collector number, else the `SET-NUM` suffix of legacy ids
            # (Pokémon runtimes carry only the id) — same fallback as the app.
            value = printing.get("collectorNumber")
            if value:
                return value
            card_id = printing.get("cardId") or ""
            return card_id.split("-", 1)[1] if "-" in card_id else None

        return [
            (p.get("exactPrintingId") or p.get("cardId"), p.get("setCode"), number(p))
            for p in options
        ]


# ---------- sources ----------

def dedupe_roboflow(names: list[str]) -> dict[str, str]:
    """One representative per source photo (drops Roboflow augmentation copies)."""
    chosen: dict[str, str] = {}
    for name in sorted(names):
        base = re.sub(r"\.rf\.[0-9a-f]+(\.\w+)$", r"\1", name)
        chosen.setdefault(base, name)
    return chosen


def iter_coco(source: str, annotations: Path, image_dir: Path, category: str | None):
    data = json.loads(annotations.read_text())
    categories = {c["id"]: c["name"] for c in data["categories"]}
    # Roboflow COCO exports carry a synthetic parent category (supercategory
    # "none") that owns no boxes; it may share its NAME with the real class,
    # so select by id: every category that actually has annotations.
    annotated = {a["category_id"] for a in data["annotations"]}
    wanted = {cid for cid, name in categories.items() if cid in annotated and (category is None or name == category)}
    images = {i["id"]: i for i in data["images"]}
    representative = dedupe_roboflow([i["file_name"] for i in data["images"]])
    keep = set(representative.values())
    boxes = collections.defaultdict(list)
    for annotation in data["annotations"]:
        if annotation["category_id"] in wanted:
            boxes[annotation["image_id"]].append(annotation["bbox"])
    for image_id, image in images.items():
        if image["file_name"] not in keep:
            continue
        path = image_dir / image["file_name"]
        if not path.exists():
            continue
        with Image.open(path) as im:
            im.load()
            for n, (x, y, w, h) in enumerate(boxes.get(image_id, [])):
                if min(w, h) < MIN_CROP_SIDE:
                    continue
                pad_x, pad_y = w * 0.03, h * 0.03
                crop = im.crop((
                    max(0, x - pad_x), max(0, y - pad_y),
                    min(im.width, x + w + pad_x), min(im.height, y + h + pad_y),
                ))
                yield {
                    "source": source,
                    "origin": image["file_name"],
                    "box": [x, y, w, h],
                    "crop": crop.convert("RGB"),
                    "truth_name": None,
                }


def iter_whole(source: str, image_dir: Path):
    names = [p.name for p in image_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
    for name in sorted(set(dedupe_roboflow(names).values())):
        with Image.open(image_dir / name) as im:
            im.load()
            if min(im.size) < MIN_CROP_SIDE:
                continue
            yield {"source": source, "origin": name, "box": None, "crop": im.convert("RGB"), "truth_name": None}


def iter_folder_classes(source: str, root: Path):
    for class_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        names = [p.name for p in class_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"}]
        for name in sorted(set(dedupe_roboflow(names).values())):
            with Image.open(class_dir / name) as im:
                im.load()
                yield {
                    "source": source,
                    "origin": f"{class_dir.name}/{name}",
                    "box": None,
                    "crop": im.convert("RGB"),
                    "truth_name": class_dir.name,
                }


# ---------- OCR ----------

def run_ocr(paths: list[Path]) -> dict[str, dict]:
    if not paths:
        return {}
    process = subprocess.run(
        ["swift", str(OCR_SCRIPT)],
        input="\n".join(str(p) for p in paths),
        capture_output=True, text=True, check=False,
    )
    if process.returncode != 0:
        sys.stderr.write(process.stderr)
        raise SystemExit("ocr-titles.swift failed")
    results = {}
    for line in process.stdout.splitlines():
        if line.strip():
            record = json.loads(line)
            results[record["path"]] = record
    return results


def title_candidates(lines: list[dict]) -> list[str]:
    # Vision returns bottom-left origin boxes; the title is the highest line
    # on an upright card, but photos may be inverted, so consider every line
    # and adjacent pairs, longest first — exact catalog match is the filter.
    texts = [l["text"] for l in lines if l.get("confidence", 0) >= 0.25]
    pairs = [f"{a} {b}" for a, b in zip(texts, texts[1:])]
    keys = {normalized_name(t) for t in texts + pairs}
    return sorted((k for k in keys if len(k) >= 4), key=len, reverse=True)


def footer_pairs(lines: list[dict]) -> list[str]:
    text = " ".join(l["text"] for l in lines)
    return [normalize_collector(m.group(1)) for m in re.finditer(r"(\d{1,4})\s*/\s*(\d{1,4})", text)]


# ---------- augmentation statistics ----------

def image_stats(image: Image.Image) -> dict:
    gray = np.asarray(image.convert("L"), dtype=np.float32)
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    lap = np.asarray(image.convert("L").filter(ImageFilter.FIND_EDGES), dtype=np.float32)
    # Noise: residual after a small median filter, robust sigma.
    smooth = np.asarray(image.convert("L").filter(ImageFilter.MedianFilter(3)), dtype=np.float32)
    residual = gray - smooth
    noise = 1.4826 * float(np.median(np.abs(residual - np.median(residual))))
    return {
        "mean_rgb": [float(v) for v in rgb.reshape(-1, 3).mean(axis=0)],
        "contrast": float(gray.std()),
        "sharpness": float(lap.var()),
        "noise_sigma": noise,
        "saturation": float(np.asarray(image.convert("HSV"))[..., 1].mean()),
    }


def fetch_render(url: str, cache: Path) -> Image.Image | None:
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / (hashlib.sha256(url.encode()).hexdigest()[:16] + ".jpg")
    if not target.exists():
        try:
            with urllib.request.urlopen(url, timeout=20) as response:
                target.write_bytes(response.read())
        except Exception:
            return None
    try:
        with Image.open(target) as im:
            im.load()
            return im.convert("RGB")
    except Exception:
        return None


# ---------- main ----------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--game", required=True)
    parser.add_argument("--runtime", required=True, type=Path, help="dir with CardsIndexVectors-arcface.bin + CardsIndexMetadata.json")
    parser.add_argument("--onnx", required=True, type=Path)
    parser.add_argument("--coco", action="append", default=[], help="NAME=ANNOTATIONS:IMAGE_DIR[:CATEGORY]")
    parser.add_argument("--whole", action="append", default=[], help="NAME=IMAGE_DIR")
    parser.add_argument("--folder-classes", action="append", default=[], help="NAME=ROOT")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--render-samples", type=int, default=200, help="accepted crops to pair with their catalog render for augmentation statistics")
    parser.add_argument("--limit", type=int, default=0, help="debug: stop after N crops per source")
    args = parser.parse_args()

    runtime = Runtime(args.runtime, args.onnx)
    out = args.out
    crops_dir = out / "crops"
    crops_dir.mkdir(parents=True, exist_ok=True)

    sources = []
    for spec in args.coco:
        name, rest = spec.split("=", 1)
        parts = rest.split(":")
        sources.append(("coco", name, iter_coco(name, Path(parts[0]), Path(parts[1]), parts[2] if len(parts) > 2 else None)))
    for spec in args.whole:
        name, path = spec.split("=", 1)
        sources.append(("whole", name, iter_whole(name, Path(path))))
    for spec in args.folder_classes:
        name, path = spec.split("=", 1)
        sources.append(("folder", name, iter_folder_classes(name, Path(path))))

    # Pass 1: crop + embed + write crops (OCR runs as one batch afterwards).
    records = []
    for _, name, iterator in sources:
        count = 0
        for item in iterator:
            count += 1
            if args.limit and count > args.limit:
                break
            crop = item["crop"]
            embedding = runtime.embed(crop)
            neighbours = runtime.nearest(embedding, limit=10)
            crop_id = hashlib.sha256(f"{name}/{item['origin']}/{item['box']}".encode()).hexdigest()[:16]
            crop_path = crops_dir / name / f"{crop_id}.jpg"
            crop_path.parent.mkdir(parents=True, exist_ok=True)
            crop.save(crop_path, quality=92)
            records.append({
                "id": crop_id,
                "source": name,
                "origin": item["origin"],
                "box": item["box"],
                "crop_path": str(crop_path),
                "crop_size": list(crop.size),
                "truth_name": item["truth_name"],
                "neighbours": [
                    {"index": i, "name": runtime.rows[i]["name"], "family": runtime.family_of(i),
                     "cardId": runtime.rows[i]["cardId"], "similarity": s}
                    for i, s in neighbours
                ],
                "embedding": embedding.astype(np.float32),
            })
        print(f"{name}: {min(count, args.limit) if args.limit else count} crops", file=sys.stderr)

    # Pass 2: OCR.
    ocr = run_ocr([Path(r["crop_path"]) for r in records])

    # Pass 3: decide.
    corpus, review, negatives = [], [], []
    decisions = collections.Counter()
    for record in records:
        lines = ocr.get(record["crop_path"], {}).get("lines", [])
        top = record["neighbours"][0] if record["neighbours"] else None
        top_key = normalized_name(top["name"]) if top else None
        # Rival = nearest neighbour from a DIFFERENT family (the app's
        # ambiguity rule); a same-name rival still counts for games whose
        # families are single printings (Pokémon), where "Pikachu" is many cards.
        rival = next((n for n in record["neighbours"][1:] if n["family"] != top["family"]), None) if top else None
        titles = title_candidates(lines)
        matched_key = next((t for t in titles if t in runtime.names_by_key), None)
        if matched_key is None:
            # Bounded one-edit repair against strong visual neighbours only.
            strong = {normalized_name(n["name"]) for n in record["neighbours"] if n["similarity"] >= 0.75}
            repairs = {c for t in titles if len(t) >= 8 for c in strong if len(c) >= 8 and edit_distance_at_most_one(t, c)}
            if len(repairs) == 1:
                matched_key = repairs.pop()
        pairs = footer_pairs(lines)
        truth_key = normalized_name(record["truth_name"]) if record["truth_name"] else None

        # Title-constrained ranking (the app's exactNameMatch + ANN over those rows).
        title_ranked = runtime.nearest(record["embedding"], limit=5, allowed=runtime.names_by_key[matched_key]) if matched_key else []
        printing = None
        if title_ranked:
            for index, _ in title_ranked:
                for exact_id, set_code, number in runtime.printing_options(index):
                    if number and normalize_collector(number) in pairs:
                        printing = {"exactPrintingId": exact_id, "setCode": set_code, "collectorNumber": number, "family": runtime.family_of(index)}
                        break
                if printing:
                    break

        base = {k: v for k, v in record.items() if k != "embedding"}
        base["ocr_titles"] = titles[:5]
        base["ocr_footer_pairs"] = pairs
        base["matched_name_key"] = matched_key
        base["top1"] = top
        base["top1_rival_gap"] = (top["similarity"] - rival["similarity"]) if (top and rival) else None

        if truth_key:
            # Ground-truth source: measure, do not pseudo-label.
            family_rows = runtime.names_by_key.get(truth_key, set())
            correct_rank = next((k for k, n in enumerate(record["neighbours"]) if n["index"] in family_rows), None)
            base["truth_rank"] = correct_rank
            base["truth_similarity"] = next((n["similarity"] for n in record["neighbours"] if n["index"] in family_rows), None)
            base["decision"] = "ground-truth"
            base["label"] = {"nameKey": truth_key, "family": runtime.family_of(next(iter(family_rows))) if family_rows else None}
            corpus.append(base)
            decisions["ground-truth"] += 1
            continue

        if printing:
            base["decision"] = "footer-verified"
            base["label"] = {"nameKey": matched_key, "family": printing["family"], "exactPrintingId": printing["exactPrintingId"]}
            corpus.append(base)
            decisions["footer-verified"] += 1
        elif matched_key and top and top_key == matched_key and top["similarity"] >= EVIDENCE_FLOOR \
                and (rival is None or top["similarity"] - rival["similarity"] >= AMBIGUITY_MARGIN):
            base["decision"] = "title-agreement"
            base["label"] = {"nameKey": matched_key, "family": top["family"]}
            corpus.append(base)
            decisions["title-agreement"] += 1
        elif matched_key and runtime.printings_by_key[matched_key] == 1 and title_ranked and title_ranked[0][1] >= EVIDENCE_FLOOR:
            index, score = title_ranked[0]
            base["decision"] = "unique-title"
            base["label"] = {"nameKey": matched_key, "family": runtime.family_of(index)}
            base["title_similarity"] = score
            corpus.append(base)
            decisions["unique-title"] += 1
        elif matched_key:
            base["decision"] = "review:title-vs-visual"
            base["title_ranked"] = [(runtime.rows[i]["cardId"], s) for i, s in title_ranked]
            review.append(base)
            decisions["review:title-vs-visual"] += 1
        elif top and top["similarity"] >= 0.70 and (rival is None or top["similarity"] - rival["similarity"] >= AMBIGUITY_MARGIN):
            base["decision"] = "review:visual-only"
            review.append(base)
            decisions["review:visual-only"] += 1
        elif top is None or top["similarity"] < EVIDENCE_FLOOR:
            base["decision"] = "hard-negative-candidate"
            negatives.append(base)
            decisions["hard-negative-candidate"] += 1
        else:
            base["decision"] = "review:weak"
            review.append(base)
            decisions["review:weak"] += 1

    for name, rows in (("corpus.jsonl", corpus), ("review.jsonl", review), ("negatives.jsonl", negatives)):
        with (out / name).open("w") as handle:
            for row in rows:
                handle.write(json.dumps(row) + "\n")

    # Augmentation bank: accepted real crops paired with their catalog render.
    bank = []
    cache = out / "render-cache"
    for row in corpus:
        if len(bank) >= args.render_samples:
            break
        family = row["label"].get("family")
        index = next((n["index"] for n in row["neighbours"] if n["family"] == family), None)
        if index is None:
            continue
        url = runtime.rows[index].get("imageURL")
        if not url:
            continue
        render = fetch_render(url, cache)
        if render is None:
            continue
        with Image.open(row["crop_path"]) as crop:
            crop.load()
            camera = image_stats(crop)
        catalog = image_stats(render)
        bank.append({
            "id": row["id"], "source": row["source"], "family": family,
            "camera": camera, "render": catalog,
            "ratios": {
                "mean_rgb": [c / max(r, 1e-6) for c, r in zip(camera["mean_rgb"], catalog["mean_rgb"])],
                "contrast": camera["contrast"] / max(catalog["contrast"], 1e-6),
                "sharpness": camera["sharpness"] / max(catalog["sharpness"], 1e-6),
                "saturation": camera["saturation"] / max(catalog["saturation"], 1e-6),
                "noise_sigma_delta": camera["noise_sigma"] - catalog["noise_sigma"],
            },
        })

    def percentiles(values):
        if not values:
            return None
        arr = np.asarray(values, dtype=np.float64)
        return {"p10": float(np.percentile(arr, 10)), "p50": float(np.percentile(arr, 50)), "p90": float(np.percentile(arr, 90)), "n": int(arr.size)}

    bank_summary = {
        "schema": "tcger-camera-augmentation-bank-v1",
        "game": args.game,
        "samples": len(bank),
        "ratios": {
            key: percentiles([b["ratios"][key] for b in bank])
            for key in ("contrast", "sharpness", "saturation", "noise_sigma_delta")
        },
        "mean_rgb_ratio": [percentiles([b["ratios"]["mean_rgb"][c] for b in bank]) for c in range(3)],
        "pairs": bank,
    }
    (out / "augmentation-bank.json").write_text(json.dumps(bank_summary, indent=1))

    # Report.
    accepted_sims = [r["top1"]["similarity"] for r in corpus if r["decision"] != "ground-truth" and r.get("top1")]
    truth = [r for r in corpus if r["decision"] == "ground-truth"]
    families = {r["label"]["family"] for r in corpus if r["label"].get("family")}
    per_source = collections.defaultdict(collections.Counter)
    for r in corpus + review + negatives:
        per_source[r["source"]][r["decision"]] += 1
    report = {
        "game": args.game,
        "crops": len(records),
        "decisions": dict(decisions),
        "per_source": {k: dict(v) for k, v in per_source.items()},
        "accepted": len(corpus) - len(truth),
        "families_covered": len(families),
        "accepted_top1_similarity": percentiles(accepted_sims),
        "ground_truth": {
            "n": len(truth),
            "top1_correct": sum(1 for r in truth if r.get("truth_rank") == 0),
            "top5_correct": sum(1 for r in truth if r.get("truth_rank") is not None and r["truth_rank"] < 5),
            "correct_similarity": percentiles([r["truth_similarity"] for r in truth if r.get("truth_similarity") is not None]),
        },
        "augmentation_bank_samples": len(bank),
    }
    (out / "report.json").write_text(json.dumps(report, indent=1))
    lines = [f"# Camera corpus report — {args.game}", "",
             f"- crops: {report['crops']}", f"- accepted pseudo-labels: {report['accepted']} across {report['families_covered']} families",
             f"- decisions: {json.dumps(report['decisions'])}",
             f"- accepted top-1 similarity p10/p50/p90: {report['accepted_top1_similarity']}",
             f"- ground-truth sources: {report['ground_truth']}", "", "## Per source", ""]
    for source, counts in report["per_source"].items():
        lines.append(f"- {source}: {json.dumps(counts)}")
    (out / "report.md").write_text("\n".join(lines) + "\n")
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
