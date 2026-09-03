#!/usr/bin/env python3
"""Build and score the shared 720x1000 card-crop parity experiment."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import cv2
import numpy as np
from PIL import Image, ImageOps


SCHEMA_ID = "https://tcger.app/reports/card-crop-parity/v1"
CASES_SCHEMA_ID = "https://tcger.app/fixtures/card-crop-parity-cases/v1"
WIDTH = 720
HEIGHT = 1000
MAPPINGS = ("pixelCenter", "imageEdge")
KERNELS = ("bilinear", "bicubic", "lanczos3")
INSETS = (0.0, 0.01, 0.02)
BORDERS = ("replicate", "black")


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def config_id(mapping: str, kernel: str, inset: float, border: str) -> str:
    return f"{mapping}-{kernel}-inset{int(round(inset * 100)):02d}-{border}"


def grid() -> list[dict[str, Any]]:
    return [
        {
            "id": config_id(mapping, kernel, inset, border),
            "normalizedToPixel": mapping,
            "kernel": kernel,
            "insetFraction": inset,
            "border": border,
            "color": "srgb8-rgb",
            "destinationSize": {"width": WIDTH, "height": HEIGHT},
            "destinationPixelCenters": [
                [0, 0],
                [WIDTH - 1, 0],
                [WIDTH - 1, HEIGHT - 1],
                [0, HEIGHT - 1],
            ],
        }
        for mapping in MAPPINGS
        for kernel in KERNELS
        for inset in INSETS
        for border in BORDERS
    ]


def normalized_quad_to_pixels(
    quad: Iterable[Iterable[float]], width: int, height: int, mapping: str
) -> np.ndarray:
    points = np.asarray(list(quad), dtype=np.float64)
    if points.shape != (4, 2):
        raise ValueError("quad must contain four x/y points")
    if mapping == "pixelCenter":
        scale = np.array([width - 1, height - 1], dtype=np.float64)
    elif mapping == "imageEdge":
        scale = np.array([width, height], dtype=np.float64)
    else:
        raise ValueError(f"unknown normalized-to-pixel mapping: {mapping}")
    return points * scale


def inset_quad(quad: np.ndarray, fraction: float) -> np.ndarray:
    """Inset a TL/TR/BR/BL quad using its bilinear card coordinates."""
    if not 0 <= fraction < 0.5:
        raise ValueError("inset fraction must be in [0, 0.5)")
    tl, tr, br, bl = np.asarray(quad, dtype=np.float64)

    def point(u: float, v: float) -> np.ndarray:
        return (
            (1 - u) * (1 - v) * tl
            + u * (1 - v) * tr
            + u * v * br
            + (1 - u) * v * bl
        )

    f = fraction
    return np.asarray(
        [point(f, f), point(1 - f, f), point(1 - f, 1 - f), point(f, 1 - f)],
        dtype=np.float64,
    )


def warp_reference(
    image_rgb: np.ndarray,
    quad_normalized: Iterable[Iterable[float]],
    *,
    mapping: str,
    kernel: str,
    inset: float,
    border: str,
) -> np.ndarray:
    if image_rgb.ndim != 3 or image_rgb.shape[2] != 3:
        raise ValueError("source image must be uint8 RGB")
    source = normalized_quad_to_pixels(
        quad_normalized, image_rgb.shape[1], image_rgb.shape[0], mapping
    )
    source = inset_quad(source, inset).astype(np.float32)
    destination = np.asarray(
        [[0, 0], [WIDTH - 1, 0], [WIDTH - 1, HEIGHT - 1], [0, HEIGHT - 1]],
        dtype=np.float32,
    )
    interpolation = {
        "bilinear": cv2.INTER_LINEAR,
        "bicubic": cv2.INTER_CUBIC,
        "lanczos3": cv2.INTER_LANCZOS4,
    }.get(kernel)
    if interpolation is None:
        raise ValueError(f"unknown kernel: {kernel}")
    border_mode = {
        "replicate": cv2.BORDER_REPLICATE,
        "black": cv2.BORDER_CONSTANT,
    }.get(border)
    if border_mode is None:
        raise ValueError(f"unknown border: {border}")
    transform = cv2.getPerspectiveTransform(source, destination)
    return cv2.warpPerspective(
        image_rgb,
        transform,
        (WIDTH, HEIGHT),
        flags=interpolation,
        borderMode=border_mode,
        borderValue=(0, 0, 0),
    )


def warp_bench_current(
    image_rgb: np.ndarray, quad_normalized: Iterable[Iterable[float]]
) -> np.ndarray:
    """Exact current bench_localizers warp, including W/H edge destinations."""
    source = normalized_quad_to_pixels(
        quad_normalized, image_rgb.shape[1], image_rgb.shape[0], "imageEdge"
    ).astype(np.float32)
    destination = np.asarray(
        [[0, 0], [WIDTH, 0], [WIDTH, HEIGHT], [0, HEIGHT]], dtype=np.float32
    )
    transform = cv2.getPerspectiveTransform(source, destination)
    return cv2.warpPerspective(
        image_rgb, transform, (WIDTH, HEIGHT), flags=cv2.INTER_CUBIC
    )


def pixel_metrics(actual: np.ndarray, reference: np.ndarray) -> dict[str, float]:
    if actual.shape != reference.shape:
        raise ValueError(f"crop shape mismatch: {actual.shape} != {reference.shape}")
    delta = actual.astype(np.float64) - reference.astype(np.float64)
    mae = float(np.mean(np.abs(delta)) / 255.0)
    mse = float(np.mean(delta * delta))
    psnr = math.inf if mse == 0 else float(20 * math.log10(255.0 / math.sqrt(mse)))
    return {"mae": mae, "psnrDb": psnr}


def comparable_pixel_metrics(
    actual: np.ndarray, reference: np.ndarray
) -> dict[str, float] | None:
    """Return pixel metrics only when both crops honor the same dimensions."""
    if actual.shape != reference.shape:
        return None
    return pixel_metrics(actual, reference)


def normalize_query_colors(image: Image.Image, mode: str) -> Image.Image:
    """Apply the released per-game query policy before encoder preprocessing."""
    if mode == "none":
        return image
    if mode != "grey-world-autocontrast":
        raise ValueError(f"unknown query normalization: {mode}")
    pixels = np.asarray(image.convert("RGB"), dtype=np.float32)
    means = pixels.reshape(-1, 3).mean(axis=0)
    gains = np.where(
        means > 0,
        means.mean() / np.where(means > 0, means, 1.0),
        1.0,
    )
    balanced = Image.fromarray(np.clip(pixels * gains, 0, 255).astype(np.uint8))
    return ImageOps.autocontrast(balanced, cutoff=1)


def load_cases(path: Path) -> dict[str, Any]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("schema") != CASES_SCHEMA_ID:
        raise ValueError(f"unsupported cases schema: {document.get('schema')}")
    return document


def _known_metric_quad(record: dict[str, Any]) -> list[list[float]] | None:
    if len(record["instances"]) != 1:
        return None
    corners = record["instances"][0]["corners"]
    if not all(
        corner.get("coordinateKnown")
        and corner.get("cornerSource") in {"human", "synthetic"}
        for corner in corners
    ):
        return None
    return [[corner["point"]["x"], corner["point"]["y"]] for corner in corners]


def _release_cases(root: Path, source_kind: str, limit: int | None) -> list[dict[str, Any]]:
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    cases = []
    for entry in sorted(manifest["records"], key=lambda item: item["recordId"]):
        if source_kind == "synthetic" and entry["sceneSlice"] != "single_handheld":
            continue
        record = json.loads((root / entry["path"]).read_text(encoding="utf-8"))
        quad = _known_metric_quad(record)
        if quad is None or record["source"]["kind"] != source_kind:
            continue
        source_path = (root / record["source"]["path"]).resolve()
        cases.append(
            {
                "caseId": record["recordId"],
                "sourceKind": source_kind,
                "sceneSlice": entry["sceneSlice"],
                "sourcePath": str(source_path),
                "sourceSha256": record["source"]["sha256"],
                "sourceWidth": record["source"]["width"],
                "sourceHeight": record["source"]["height"],
                "quad": quad,
            }
        )
        if limit is not None and len(cases) >= limit:
            break
    return cases


def build_cases(real_release: Path, synthetic_release: Path) -> dict[str, Any]:
    real_manifest = json.loads((real_release / "manifest.json").read_text())
    synthetic_manifest = json.loads((synthetic_release / "manifest.json").read_text())
    cases = _release_cases(real_release, "real", None)
    cases.extend(_release_cases(synthetic_release, "synthetic", 10))
    return {
        "schema": CASES_SCHEMA_ID,
        "destinationSize": {"width": WIDTH, "height": HEIGHT},
        "sourceReleases": [
            {
                "kind": "real",
                "releaseId": real_manifest["releaseId"],
                "corpusHash": real_manifest["corpusHash"],
            },
            {
                "kind": "synthetic",
                "releaseId": synthetic_manifest["releaseId"],
                "corpusHash": synthetic_manifest["corpusHash"],
            },
        ],
        "cases": cases,
    }


def stage_cases(cases_path: Path, output: Path) -> None:
    """Copy the selected source bytes into a relocatable private-job bundle."""
    document = load_cases(cases_path)
    output.mkdir(parents=True, exist_ok=True)
    sources = output / "sources"
    sources.mkdir(exist_ok=True)
    for case in document["cases"]:
        source = Path(case["sourcePath"])
        if sha256_file(source) != case["sourceSha256"]:
            raise ValueError(f"source hash mismatch: {case['caseId']}")
        suffix = source.suffix.lower() or ".img"
        relative = Path("sources") / f"{case['caseId']}{suffix}"
        shutil.copyfile(source, output / relative)
        case["sourcePath"] = relative.as_posix()
    (output / "cases.json").write_bytes(canonical_json(document))


def write_reference_grid(cases_path: Path, output: Path) -> None:
    cases = load_cases(cases_path)["cases"]
    output.mkdir(parents=True, exist_ok=True)
    for case in cases:
        source_path = Path(case["sourcePath"])
        if sha256_file(source_path) != case["sourceSha256"]:
            raise ValueError(f"source hash mismatch: {case['caseId']}")
        image = np.asarray(Image.open(source_path).convert("RGB"))
        for configuration in grid():
            crop = warp_reference(
                image,
                case["quad"],
                mapping=configuration["normalizedToPixel"],
                kernel=configuration["kernel"],
                inset=configuration["insetFraction"],
                border=configuration["border"],
            )
            destination = output / configuration["id"] / f"{case['caseId']}.png"
            destination.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(crop, "RGB").save(destination, format="PNG")


def write_bench_crops(cases_path: Path, output: Path) -> None:
    cases = load_cases(cases_path)["cases"]
    output.mkdir(parents=True, exist_ok=True)
    for case in cases:
        source = np.asarray(Image.open(case["sourcePath"]).convert("RGB"))
        crop = warp_bench_current(source, case["quad"])
        Image.fromarray(crop, "RGB").save(output / f"{case['caseId']}.png")


@dataclass
class EncoderRuntime:
    name: str
    threshold: float
    session: Any
    input_name: str
    vectors: np.ndarray
    families: list[str]
    query_normalization: str

    @classmethod
    def load(
        cls,
        name: str,
        onnx_path: Path,
        runtime_dir: Path,
        threshold: float,
        query_normalization: str = "none",
    ) -> "EncoderRuntime":
        import onnxruntime as ort

        rows = json.loads((runtime_dir / "CardsIndexMetadata.json").read_text())
        raw = (runtime_dir / "CardsIndexVectors-arcface.bin").read_bytes()
        count, dimension = struct.unpack("<II", raw[:8])
        vectors = np.frombuffer(raw[8:], dtype=np.int8).reshape(count, dimension)
        vectors = vectors.astype(np.float32)
        vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
        if count != len(rows):
            raise ValueError(f"{name}: vector and metadata row counts differ")
        session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
        families = [row.get("recognitionFamilyId") or row["cardId"] for row in rows]
        if query_normalization not in {"none", "grey-world-autocontrast"}:
            raise ValueError(f"unknown query normalization: {query_normalization}")
        return cls(
            name,
            threshold,
            session,
            session.get_inputs()[0].name,
            vectors,
            families,
            query_normalization,
        )

    def embed(self, image: Image.Image) -> np.ndarray:
        image = normalize_query_colors(image.convert("RGB"), self.query_normalization)
        scale = 256 / min(image.size)
        resized = image.resize(
            (math.ceil(image.width * scale), math.ceil(image.height * scale)),
            Image.Resampling.BICUBIC,
        )
        left = (resized.width - 224) // 2
        top = (resized.height - 224) // 2
        crop = resized.crop((left, top, left + 224, top + 224))
        tensor = np.asarray(crop, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
        result = self.session.run(None, {self.input_name: tensor})[0][0]
        return result / np.linalg.norm(result)

    def decision(self, embedding: np.ndarray) -> tuple[str, bool]:
        scores = self.vectors @ embedding
        order = np.argsort(-scores)
        first = int(order[0])
        rival = next(
            int(index)
            for index in order[1:]
            if self.families[int(index)] != self.families[first]
        )
        accepted = bool(
            scores[first] >= self.threshold and scores[first] - scores[rival] >= 0.05
        )
        return self.families[first], accepted


def parse_encoder(value: str) -> EncoderRuntime:
    parts = value.split("=", 1)
    if len(parts) != 2:
        raise argparse.ArgumentTypeError("encoder must be name=onnx,runtime,threshold")
    fields = parts[1].split(",")
    if len(fields) not in {3, 4}:
        raise argparse.ArgumentTypeError(
            "encoder must be name=onnx,runtime,threshold[,queryNormalization]"
        )
    normalization = fields[3] if len(fields) == 4 else "none"
    return EncoderRuntime.load(
        parts[0], Path(fields[0]), Path(fields[1]), float(fields[2]), normalization
    )


def _mean(values: list[float]) -> float | None:
    return float(np.mean(values)) if values else None


def _case_cohort(case: dict[str, Any]) -> str:
    return (
        "outsideFrame"
        if any(not 0 <= coordinate <= 1 for point in case["quad"] for coordinate in point)
        else "fullyInside"
    )


def _encoder_bucket(encoders: list[EncoderRuntime]) -> dict[str, dict[str, Any]]:
    return {
        runtime.name: {
            "cosines": [],
            "top1Agreement": 0,
            "acceptAgreement": 0,
            "evaluated": 0,
        }
        for runtime in encoders
    }


def _summarize_encoder_buckets(
    values: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    summary = {}
    for name, bucket in values.items():
        evaluated = int(bucket["evaluated"])
        summary[name] = {
            "evaluated": evaluated,
            "queryNormalization": bucket.get("queryNormalization"),
            "meanCosine": _mean(bucket["cosines"]),
            "top1Agreement": (
                bucket["top1Agreement"] / evaluated if evaluated else None
            ),
            "acceptAgreement": (
                bucket["acceptAgreement"] / evaluated if evaluated else None
            ),
        }
    return summary


def analyze(
    cases_path: Path,
    references: Path,
    platforms: list[tuple[str, Path]],
    encoders: list[EncoderRuntime],
) -> dict[str, Any]:
    document = load_cases(cases_path)
    cases = document["cases"]
    report_platforms: dict[str, Any] = {}
    reference_embeddings: dict[tuple[str, str, str], np.ndarray] = {}
    reference_decisions: dict[tuple[str, str, str], tuple[str, bool]] = {}
    actual_embeddings: dict[tuple[str, str, str], np.ndarray] = {}
    actual_decisions: dict[tuple[str, str, str], tuple[str, bool]] = {}
    for platform_name, platform_root in platforms:
        rows = []
        missing = []
        pixel_size_mismatches = []
        for configuration in grid():
            pixel_values: dict[str, dict[str, list[float]]] = {
                cohort: {"maes": [], "psnrs": []}
                for cohort in ("all", "outsideFrame", "fullyInside")
            }
            encoder_values = {
                cohort: _encoder_bucket(encoders)
                for cohort in ("all", "outsideFrame", "fullyInside")
            }
            for cohort in encoder_values.values():
                for runtime in encoders:
                    cohort[runtime.name]["queryNormalization"] = (
                        runtime.query_normalization
                    )
            for case in cases:
                actual_path = platform_root / f"{case['caseId']}.png"
                reference_path = (
                    references / configuration["id"] / f"{case['caseId']}.png"
                )
                if not actual_path.is_file():
                    missing.append(case["caseId"])
                    continue
                actual_image = Image.open(actual_path).convert("RGB")
                reference_image = Image.open(reference_path).convert("RGB")
                case_cohort = _case_cohort(case)
                metrics = comparable_pixel_metrics(
                    np.asarray(actual_image), np.asarray(reference_image)
                )
                if metrics is None:
                    pixel_size_mismatches.append(case["caseId"])
                else:
                    for cohort_name in ("all", case_cohort):
                        pixel_values[cohort_name]["maes"].append(metrics["mae"])
                        if math.isfinite(metrics["psnrDb"]):
                            pixel_values[cohort_name]["psnrs"].append(metrics["psnrDb"])
                for runtime in encoders:
                    actual_key = (platform_name, runtime.name, case["caseId"])
                    reference_key = (
                        runtime.name,
                        configuration["id"],
                        case["caseId"],
                    )
                    if actual_key not in actual_embeddings:
                        actual_embeddings[actual_key] = runtime.embed(actual_image)
                        actual_decisions[actual_key] = runtime.decision(
                            actual_embeddings[actual_key]
                        )
                    if reference_key not in reference_embeddings:
                        reference_embeddings[reference_key] = runtime.embed(
                            reference_image
                        )
                        reference_decisions[reference_key] = runtime.decision(
                            reference_embeddings[reference_key]
                        )
                    actual_embedding = actual_embeddings[actual_key]
                    reference_embedding = reference_embeddings[reference_key]
                    actual_top1, actual_accept = actual_decisions[actual_key]
                    reference_top1, reference_accept = reference_decisions[reference_key]
                    for cohort_name in ("all", case_cohort):
                        bucket = encoder_values[cohort_name][runtime.name]
                        bucket["cosines"].append(
                            float(actual_embedding @ reference_embedding)
                        )
                        bucket["top1Agreement"] += int(actual_top1 == reference_top1)
                        bucket["acceptAgreement"] += int(
                            actual_accept == reference_accept
                        )
                        bucket["evaluated"] += 1
            cohorts = {}
            for cohort_name, values in pixel_values.items():
                cohorts[cohort_name] = {
                    "evaluated": len(values["maes"]),
                    "meanAbsoluteError": _mean(values["maes"]),
                    "meanPsnrDb": _mean(values["psnrs"]),
                    "encoders": _summarize_encoder_buckets(
                        encoder_values[cohort_name]
                    ),
                }
            rows.append(
                {
                    "configId": configuration["id"],
                    **cohorts["all"],
                    "cohorts": {
                        name: value for name, value in cohorts.items() if name != "all"
                    },
                }
            )
        report_platforms[platform_name] = {
            "cropRoot": str(platform_root),
            "missingCaseIds": sorted(set(missing)),
            "pixelSizeMismatchCaseIds": sorted(set(pixel_size_mismatches)),
            "comparisons": rows,
        }
    return {
        "schema": SCHEMA_ID,
        "casesSha256": sha256_file(cases_path),
        "caseCount": len(cases),
        "referenceGrid": grid(),
        "platforms": report_platforms,
        "notes": {
            "halfPixel": (
                "Destination samples are pixel centers 0..719 and 0..999. Under OpenCV's "
                "sampling convention, the represented output edges lie at -0.5 and 719.5 "
                "(and -0.5 and 999.5), so destination geometry includes the half-pixel effect."
            ),
            "color": "All comparisons decode to untagged sRGB 8-bit RGB before inference.",
        },
    }


def parse_platform(value: str) -> tuple[str, Path]:
    parts = value.split("=", 1)
    if len(parts) != 2:
        raise argparse.ArgumentTypeError("platform must be name=directory")
    return parts[0], Path(parts[1])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    cases_parser = subparsers.add_parser("build-cases")
    cases_parser.add_argument("--real-release", type=Path, required=True)
    cases_parser.add_argument("--synthetic-release", type=Path, required=True)
    cases_parser.add_argument("--output", type=Path, required=True)

    reference_parser = subparsers.add_parser("write-reference-grid")
    reference_parser.add_argument("--cases", type=Path, required=True)
    reference_parser.add_argument("--output", type=Path, required=True)

    bench_parser = subparsers.add_parser("write-bench-crops")
    bench_parser.add_argument("--cases", type=Path, required=True)
    bench_parser.add_argument("--output", type=Path, required=True)

    stage_parser = subparsers.add_parser("stage-cases")
    stage_parser.add_argument("--cases", type=Path, required=True)
    stage_parser.add_argument("--output", type=Path, required=True)

    analyze_parser = subparsers.add_parser("analyze")
    analyze_parser.add_argument("--cases", type=Path, required=True)
    analyze_parser.add_argument("--references", type=Path, required=True)
    analyze_parser.add_argument(
        "--platform", action="append", type=parse_platform, default=[]
    )
    analyze_parser.add_argument("--encoder", action="append", default=[])
    analyze_parser.add_argument("--output", type=Path, required=True)

    args = parser.parse_args(argv)
    if args.command == "build-cases":
        result = build_cases(args.real_release, args.synthetic_release)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(canonical_json(result))
    elif args.command == "write-reference-grid":
        write_reference_grid(args.cases, args.output)
    elif args.command == "write-bench-crops":
        write_bench_crops(args.cases, args.output)
    elif args.command == "stage-cases":
        stage_cases(args.cases, args.output)
    else:
        encoders = [parse_encoder(value) for value in args.encoder]
        result = analyze(args.cases, args.references, args.platform, encoders)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(canonical_json(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
