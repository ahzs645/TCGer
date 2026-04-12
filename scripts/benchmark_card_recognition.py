#!/usr/bin/env python3

from __future__ import annotations

import argparse
import io
import json
import os
import random
import re
import signal
import subprocess
import sys
import time
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable

import numpy as np
import requests
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter


DEFAULT_TCGER_URL = "http://127.0.0.1:3300/cards/scan?tcg=pokemon"
DEFAULT_KUBECONFIG = "/Users/ahmadjalil/github/personalprox/kubeconfig.yml"
DEFAULT_TRADING_SCANNER_ROOT = "/Users/ahmadjalil/Downloads/Trading-Card-Scanner-main"
DEFAULT_IMAGES_DIR = (
    "/Users/ahmadjalil/Downloads/Trading-Card-Scanner-main/image-hashing-trial/images-subset"
)


def normalize_card_id(raw: str | None) -> str | None:
    if not raw:
        return None
    raw = raw.strip().lower().replace("\\", "/")
    raw = Path(raw).stem
    return re.sub(r"\d+", lambda match: str(int(match.group(0))), raw)


def load_retriever(trading_scanner_root: Path):
    sys.path.insert(0, str(trading_scanner_root / "src"))
    from retriever import Retriever  # type: ignore

    previous_cwd = Path.cwd()
    try:
        os.chdir(trading_scanner_root)
        return Retriever(str(trading_scanner_root / "res" / "classfication_embeddings" / "ResNet18_embeddings.pt"))
    finally:
        os.chdir(previous_cwd)


def pil_to_jpeg_bytes(image: Image.Image, quality: int) -> bytes:
    if image.mode != "RGB":
        image = image.convert("RGB")
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality, optimize=True)
    return buffer.getvalue()


def textured_background(width: int, height: int, rng: random.Random) -> Image.Image:
    base = np.zeros((height, width, 3), dtype=np.uint8)
    c0 = np.array([rng.randint(145, 185), rng.randint(120, 155), rng.randint(85, 120)], dtype=np.float32)
    c1 = np.array([rng.randint(85, 120), rng.randint(105, 145), rng.randint(130, 165)], dtype=np.float32)

    for y in range(height):
        t = y / max(1, height - 1)
        row = (c0 * (1 - t) + c1 * t).astype(np.uint8)
        base[y, :, :] = row

    noise = rng.random()  # keep sequence stable before numpy noise
    rs = np.random.default_rng(int(noise * 1_000_000))
    grain = rs.normal(0, 10, size=base.shape).astype(np.int16)
    textured = np.clip(base.astype(np.int16) + grain, 0, 255).astype(np.uint8)
    return Image.fromarray(textured, mode="RGB")


def make_clean_variant(card: Image.Image, rng: random.Random) -> tuple[Image.Image, int]:
    width = rng.randint(340, 420)
    height = int(width * 1.4)
    canvas = Image.new("RGB", (width, height), color=(248, 248, 246))
    resized = card.resize((width, height), Image.Resampling.LANCZOS)
    canvas.paste(resized, (0, 0))
    return canvas, 92


def make_scene_variant(card: Image.Image, rng: random.Random) -> tuple[Image.Image, int]:
    base_width = rng.randint(360, 420)
    base_height = int(base_width * 1.4)
    card = card.resize((base_width, base_height), Image.Resampling.LANCZOS).convert("RGBA")

    rotation = rng.uniform(-5.5, 5.5)
    rotated = card.rotate(rotation, resample=Image.Resampling.BICUBIC, expand=True)

    pad_x = rng.randint(18, 42)
    pad_y = rng.randint(22, 48)
    canvas_w = rotated.width + pad_x * 2
    canvas_h = rotated.height + pad_y * 2
    background = textured_background(canvas_w, canvas_h, rng)
    offset = (
        rng.randint(max(4, pad_x - 8), pad_x + 8),
        rng.randint(max(4, pad_y - 8), pad_y + 8),
    )
    background.paste(rotated, offset, rotated)

    background = ImageEnhance.Contrast(background).enhance(rng.uniform(0.92, 1.08))
    background = ImageEnhance.Brightness(background).enhance(rng.uniform(0.93, 1.07))
    if rng.random() < 0.55:
        background = background.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.2, 0.6)))
    return background, 82


def make_hard_variant(card: Image.Image, rng: random.Random) -> tuple[Image.Image, int]:
    image, _ = make_scene_variant(card, rng)
    image = image.convert("RGBA")
    draw = ImageDraw.Draw(image, "RGBA")

    glare_count = rng.randint(1, 3)
    for _ in range(glare_count):
        x0 = rng.randint(0, image.width // 2)
        x1 = x0 + rng.randint(image.width // 5, image.width // 2)
        alpha = rng.randint(40, 90)
        draw.polygon(
            [
                (x0, 0),
                (x1, 0),
                (min(image.width, x1 + rng.randint(30, 120)), image.height),
                (min(image.width, x0 + rng.randint(30, 120)), image.height),
            ],
            fill=(255, 255, 255, alpha),
        )

    occ_h = rng.randint(image.height // 10, image.height // 5)
    occ_w = rng.randint(image.width // 10, image.width // 5)
    if rng.random() < 0.5:
        draw.rounded_rectangle(
            [(0, image.height - occ_h), (occ_w, image.height)],
            radius=12,
            fill=(88, 74, 58, 210),
        )
    else:
        draw.rounded_rectangle(
            [(image.width - occ_w, image.height - occ_h), (image.width, image.height)],
            radius=12,
            fill=(88, 74, 58, 210),
        )

    image = image.convert("RGB")
    image = image.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.7, 1.6)))
    image = ImageEnhance.Contrast(image).enhance(rng.uniform(0.82, 1.16))
    image = ImageEnhance.Brightness(image).enhance(rng.uniform(0.85, 1.15))

    arr = np.array(image, dtype=np.int16)
    rs = np.random.default_rng(rng.randint(0, 2**32 - 1))
    arr += rs.normal(0, 8, size=arr.shape).astype(np.int16)
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, mode="RGB"), 62


def build_variant(card: Image.Image, variant: str, seed: int) -> tuple[bytes, int]:
    rng = random.Random(seed)
    if variant == "clean":
        image, quality = make_clean_variant(card, rng)
    elif variant == "scene":
        image, quality = make_scene_variant(card, rng)
    elif variant == "hard":
        image, quality = make_hard_variant(card, rng)
    else:
        raise ValueError(f"Unsupported variant: {variant}")
    return pil_to_jpeg_bytes(image, quality=quality), quality


class PortForward:
    def __init__(self, kubeconfig: str, namespace: str, service: str, local_port: int):
        self.kubeconfig = kubeconfig
        self.namespace = namespace
        self.service = service
        self.local_port = local_port
        self.process: subprocess.Popen[str] | None = None

    def __enter__(self):
        cmd = [
            "kubectl",
            "--kubeconfig",
            self.kubeconfig,
            "port-forward",
            "-n",
            self.namespace,
            self.service,
            f"{self.local_port}:3000",
        ]
        self.process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        start = time.time()
        assert self.process.stdout is not None
        while True:
            line = self.process.stdout.readline()
            if "Forwarding from" in line:
                return self
            if self.process.poll() is not None:
                raise RuntimeError(f"kubectl port-forward exited early: {line.strip()}")
            if time.time() - start > 20:
                raise TimeoutError("Timed out waiting for kubectl port-forward")

    def __exit__(self, exc_type, exc, tb):
        if self.process and self.process.poll() is None:
            self.process.send_signal(signal.SIGINT)
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()


@dataclass
class QueryResult:
    expected_id: str
    source_file: str
    variant: str
    jpeg_quality: int
    tcger_top1: str | None
    tcger_top5: list[str]
    tcger_latency_ms: float | None
    tcger_error: str | None
    retriever_top1: str | None
    retriever_top5: list[str]
    retriever_latency_ms: float | None
    retriever_error: str | None


@dataclass
class SystemSummary:
    queries: int = 0
    top1: int = 0
    top5: int = 0
    failures: int = 0
    latency_ms: list[float] = field(default_factory=list)
    examples: list[dict[str, str | list[str] | None]] = field(default_factory=list)

    def add(self, result: QueryResult, system: str):
        self.queries += 1
        if system == "tcger":
            top1 = result.tcger_top1
            top5 = result.tcger_top5
            latency = result.tcger_latency_ms
            error = result.tcger_error
        else:
            top1 = result.retriever_top1
            top5 = result.retriever_top5
            latency = result.retriever_latency_ms
            error = result.retriever_error

        if error:
            self.failures += 1
            return

        if top1 == result.expected_id:
            self.top1 += 1
        else:
            if len(self.examples) < 5:
                self.examples.append(
                    {
                        "expected": result.expected_id,
                        "variant": result.variant,
                        "source_file": result.source_file,
                        "top1": top1,
                        "top5": top5,
                    }
                )

        if result.expected_id in top5:
            self.top5 += 1
        if latency is not None:
            self.latency_ms.append(latency)

    def to_dict(self) -> dict[str, object]:
        avg_latency = sum(self.latency_ms) / len(self.latency_ms) if self.latency_ms else None
        return {
            "queries": self.queries,
            "top1": self.top1,
            "top5": self.top5,
            "top1_accuracy": self.top1 / self.queries if self.queries else 0.0,
            "top5_accuracy": self.top5 / self.queries if self.queries else 0.0,
            "failures": self.failures,
            "average_latency_ms": avg_latency,
            "sample_misses": self.examples,
        }


def evaluate_tcger(image_bytes: bytes, tcger_url: str) -> tuple[list[str], float]:
    start = time.perf_counter()
    response = requests.post(
        tcger_url,
        files={"image": ("query.jpg", image_bytes, "image/jpeg")},
        timeout=120,
    )
    latency_ms = (time.perf_counter() - start) * 1000
    response.raise_for_status()
    payload = response.json()
    ids = [normalize_card_id(payload.get("match", {}).get("externalId"))] if payload.get("match") else []
    for candidate in payload.get("candidates", []):
        normalized = normalize_card_id(candidate.get("externalId"))
        if normalized and normalized not in ids:
            ids.append(normalized)
    return ids[:5], latency_ms


def evaluate_retriever(image_bytes: bytes, retriever) -> tuple[list[str], float]:
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    start = time.perf_counter()
    matches = retriever.get_card_id(image)
    latency_ms = (time.perf_counter() - start) * 1000
    ids = [normalize_card_id(match) for match in matches if normalize_card_id(match)]
    return ids[:5], latency_ms


def choose_files(images_dir: Path, cards: int, seed: int) -> list[Path]:
    files = sorted(images_dir.glob("*.png"))
    if cards >= len(files):
        return files
    rng = random.Random(seed)
    return sorted(rng.sample(files, cards))


def summarize(results: Iterable[QueryResult]) -> dict[str, dict[str, dict[str, object]]]:
    summary: dict[str, dict[str, dict[str, SystemSummary]]] = defaultdict(
        lambda: defaultdict(lambda: {"tcger": SystemSummary(), "retriever": SystemSummary()})
    )
    for result in results:
        summary["overall"]["overall"]["tcger"].add(result, "tcger")
        summary["overall"]["overall"]["retriever"].add(result, "retriever")
        summary["variant"][result.variant]["tcger"].add(result, "tcger")
        summary["variant"][result.variant]["retriever"].add(result, "retriever")
    return {
        section: {
            key: {system: stats.to_dict() for system, stats in systems.items()}
            for key, systems in section_data.items()
        }
        for section, section_data in summary.items()
    }


def print_summary(summary: dict[str, dict[str, dict[str, object]]]) -> None:
    overall = summary["overall"]["overall"]
    print("\nOverall")
    for system in ("tcger", "retriever"):
        stats = overall[system]
        print(
            f"  {system:10s} top1={stats['top1_accuracy']:.3f} "
            f"top5={stats['top5_accuracy']:.3f} "
            f"avg_ms={(stats['average_latency_ms'] or 0):.1f} "
            f"failures={stats['failures']}"
        )

    print("\nBy Variant")
    for variant, systems in summary["variant"].items():
        print(f"  {variant}")
        for system in ("tcger", "retriever"):
            stats = systems[system]
            print(
                f"    {system:10s} top1={stats['top1_accuracy']:.3f} "
                f"top5={stats['top5_accuracy']:.3f} "
                f"avg_ms={(stats['average_latency_ms'] or 0):.1f} "
                f"failures={stats['failures']}"
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark TCGer vs Trading-Card-Scanner retrieval")
    parser.add_argument("--trading-scanner-root", default=DEFAULT_TRADING_SCANNER_ROOT)
    parser.add_argument("--images-dir", default=DEFAULT_IMAGES_DIR)
    parser.add_argument("--cards", type=int, default=80)
    parser.add_argument("--variants", default="clean,scene,hard")
    parser.add_argument("--seed", type=int, default=20260411)
    parser.add_argument("--tcger-url", default=None)
    parser.add_argument("--kubeconfig", default=DEFAULT_KUBECONFIG)
    parser.add_argument("--namespace", default="tcger")
    parser.add_argument("--service", default="svc/tcger-backend")
    parser.add_argument("--local-port", type=int, default=3300)
    parser.add_argument("--output-json", default="/tmp/tcger-card-benchmark-results.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    trading_scanner_root = Path(args.trading_scanner_root)
    images_dir = Path(args.images_dir)
    variants = [variant.strip() for variant in args.variants.split(",") if variant.strip()]

    retriever = load_retriever(trading_scanner_root)
    files = choose_files(images_dir, args.cards, args.seed)
    results: list[QueryResult] = []

    tcger_url = args.tcger_url or f"http://127.0.0.1:{args.local_port}/cards/scan?tcg=pokemon"
    port_forward_cm = (
        PortForward(args.kubeconfig, args.namespace, args.service, args.local_port)
        if args.tcger_url is None
        else None
    )

    with port_forward_cm or nullcontext():
        for index, file_path in enumerate(files, start=1):
            expected_id = normalize_card_id(file_path.name)
            if not expected_id:
                continue
            card = Image.open(file_path).convert("RGB")

            for variant_index, variant in enumerate(variants):
                variant_seed = args.seed + index * 1000 + variant_index
                image_bytes, jpeg_quality = build_variant(card, variant, variant_seed)

                tcger_top5: list[str] = []
                tcger_latency_ms: float | None = None
                tcger_error: str | None = None
                try:
                    tcger_top5, tcger_latency_ms = evaluate_tcger(image_bytes, tcger_url)
                except Exception as exc:  # noqa: BLE001
                    tcger_error = str(exc)

                retriever_top5: list[str] = []
                retriever_latency_ms: float | None = None
                retriever_error: str | None = None
                try:
                    retriever_top5, retriever_latency_ms = evaluate_retriever(image_bytes, retriever)
                except Exception as exc:  # noqa: BLE001
                    retriever_error = str(exc)

                result = QueryResult(
                    expected_id=expected_id,
                    source_file=file_path.name,
                    variant=variant,
                    jpeg_quality=jpeg_quality,
                    tcger_top1=tcger_top5[0] if tcger_top5 else None,
                    tcger_top5=tcger_top5,
                    tcger_latency_ms=tcger_latency_ms,
                    tcger_error=tcger_error,
                    retriever_top1=retriever_top5[0] if retriever_top5 else None,
                    retriever_top5=retriever_top5,
                    retriever_latency_ms=retriever_latency_ms,
                    retriever_error=retriever_error,
                )
                results.append(result)
                if len(results) <= 5 or len(results) % 20 == 0 or tcger_error or retriever_error:
                    print(
                        f"[{len(results):03d}] {file_path.name} {variant:5s} | "
                        f"tcger={result.tcger_top1} retriever={result.retriever_top1}"
                    )

    summary = summarize(results)
    payload = {
        "config": {
            "cards": args.cards,
            "variants": variants,
            "seed": args.seed,
            "images_dir": str(images_dir),
            "trading_scanner_root": str(trading_scanner_root),
            "tcger_url": tcger_url,
        },
        "summary": summary,
        "results": [asdict(result) for result in results],
    }
    output_path = Path(args.output_json)
    output_path.write_text(json.dumps(payload, indent=2))
    print_summary(summary)
    print(f"\nWrote results to {output_path}")
    return 0


class nullcontext:
    def __enter__(self):
        return None

    def __exit__(self, exc_type, exc, tb):
        return False


if __name__ == "__main__":
    raise SystemExit(main())
