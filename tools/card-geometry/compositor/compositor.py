#!/usr/bin/env python3
"""Generate a deterministic synthetic card-geometry smoke release."""

from __future__ import annotations

import argparse
import copy
import io
import json
import math
import shutil
import sys
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

PARENT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PARENT))

from corpus_release import (  # noqa: E402
    MANIFEST_SCHEMA_ID,
    POLICY_SCHEMA_ID,
    RECORD_SCHEMA_ID,
    canonical_json,
    corpus_hash,
    leakage_keys_from_record,
    pretty_json,
    sha256_bytes,
    sha256_file,
)

ASSET_MANIFEST_SCHEMA = "https://tcger.app/manifests/card-geometry-compositor-assets/v1"
BUILD_SUMMARY_SCHEMA = "https://tcger.app/reports/card-geometry-compositor-build/v1"
SCENE_SLICES = (
    "single_handheld",
    "single_handheld_distractor_free",
    "binder_page",
    "duel_field",
    "steep_playmat",
)
SPLITS = ("train", "validation")


class CompositorError(ValueError):
    pass


@dataclass(frozen=True)
class Asset:
    asset_id: str
    path: Path
    sha256: str
    split: str
    license_id: str
    role: str
    game: str | None
    side: str | None
    width: int
    height: int
    provenance: dict[str, Any]


@dataclass(frozen=True)
class SceneCard:
    asset: Asset
    quad: tuple[tuple[float, float], ...]
    side: str
    sleeve_tint: tuple[int, int, int, int] | None


_WORKER_CONFIG: dict[str, Any] | None = None
_WORKER_CARD_ASSETS: list[Asset] | None = None
_WORKER_BACKGROUND_ASSETS: list[Asset] | None = None


def _initialize_worker(
    config: dict[str, Any], card_manifest_path: str, background_manifest_path: str
) -> None:
    global _WORKER_CONFIG, _WORKER_CARD_ASSETS, _WORKER_BACKGROUND_ASSETS
    _WORKER_CONFIG = config
    _WORKER_CARD_ASSETS = load_assets(Path(card_manifest_path), "card")
    _WORKER_BACKGROUND_ASSETS = load_assets(Path(background_manifest_path), "background")


def _render_worker(task: tuple[str, str, int, str]) -> tuple[dict[str, Any], bytes]:
    if _WORKER_CONFIG is None or _WORKER_CARD_ASSETS is None or _WORKER_BACKGROUND_ASSETS is None:
        raise RuntimeError("compositor worker was not initialized")
    split, scene_slice, ordinal, revision = task
    return render_record(
        split=split,
        scene_slice=scene_slice,
        ordinal=ordinal,
        revision=revision,
        config=_WORKER_CONFIG,
        card_assets=_WORKER_CARD_ASSETS,
        background_assets=_WORKER_BACKGROUND_ASSETS,
    )


def _deep_merge(base: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(base)
    for key, value in update.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def load_resolved_config(
    path: Path, *, card_manifest_sha256: str, background_manifest_sha256: str
) -> dict[str, Any]:
    config = json.loads(path.read_text(encoding="utf-8"))
    required = {"schema", "canvas", "generation", "photometrics", "scenes"}
    missing = sorted(required - set(config))
    if missing:
        raise CompositorError(f"config missing fields: {missing}")
    if config["schema"] != "https://tcger.app/config/card-geometry-compositor/v1":
        raise CompositorError("unsupported compositor config schema")
    config = _deep_merge(
        config,
        {
            "assetManifestSha256": {
                "backgrounds": background_manifest_sha256,
                "cards": card_manifest_sha256,
            }
        },
    )
    records = config["generation"]["recordsPerSplitScene"]
    if set(records) - set(SPLITS):
        raise CompositorError("synthetic releases may contain only train/validation")
    for split, slices in records.items():
        unknown = set(slices) - set(SCENE_SLICES)
        if unknown:
            raise CompositorError(f"unknown scene slices for {split}: {sorted(unknown)}")
        if any(not isinstance(count, int) or count < 0 for count in slices.values()):
            raise CompositorError("scene record counts must be non-negative integers")
    return config


def compositor_revision(git_sha: str, resolved_config: dict[str, Any]) -> tuple[str, str]:
    if len(git_sha) != 40 or any(char not in "0123456789abcdef" for char in git_sha):
        raise CompositorError("--compositor-git-sha must be a lowercase 40-hex commit")
    config_sha = sha256_bytes(canonical_json(resolved_config))
    revision = sha256_bytes(
        canonical_json({"compositorGitSha": git_sha, "resolvedConfigSha256": config_sha})
    )
    return revision, config_sha


def _safe_relative(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    try:
        path.relative_to(root.resolve())
    except ValueError as error:
        raise CompositorError(f"asset path escapes manifest directory: {relative}") from error
    return path


def load_assets(path: Path, expected_role: str) -> list[Asset]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("schema") != ASSET_MANIFEST_SCHEMA:
        raise CompositorError(f"unsupported asset manifest schema: {path}")
    if document.get("role") != expected_role:
        raise CompositorError(f"expected {expected_role} assets in {path}")
    rows = document.get("assets")
    if not isinstance(rows, list) or not rows:
        raise CompositorError(f"asset manifest is empty: {path}")
    assets = []
    seen = set()
    for row in rows:
        required = {"assetId", "path", "sha256", "split", "licenseId"}
        if not isinstance(row, dict) or required - set(row):
            raise CompositorError(f"invalid asset row in {path}")
        asset_id = row["assetId"]
        if asset_id in seen:
            raise CompositorError(f"duplicate assetId {asset_id}")
        seen.add(asset_id)
        if row["split"] not in SPLITS:
            raise CompositorError(f"asset {asset_id} has forbidden split {row['split']}")
        asset_path = _safe_relative(path.parent, row["path"])
        if not asset_path.is_file():
            raise CompositorError(f"asset missing: {asset_path}")
        digest = sha256_file(asset_path)
        if digest != row["sha256"]:
            raise CompositorError(f"asset hash mismatch: {asset_id}")
        with Image.open(asset_path) as image:
            width, height = image.size
            image.verify()
        side = row.get("side")
        if expected_role == "card" and side not in {"faceUp", "faceDown"}:
            raise CompositorError(f"card asset {asset_id} needs faceUp/faceDown side")
        assets.append(
            Asset(
                asset_id=asset_id,
                path=asset_path,
                sha256=digest,
                split=row["split"],
                license_id=row["licenseId"],
                role=expected_role,
                game=row.get("game"),
                side=side,
                width=width,
                height=height,
                provenance=row.get("provenance", {}),
            )
        )
    splits_by_hash: dict[str, set[str]] = {}
    for asset in assets:
        splits_by_hash.setdefault(asset.sha256, set()).add(asset.split)
    leaked_hashes = sorted(
        digest for digest, splits in splits_by_hash.items() if len(splits) > 1
    )
    if leaked_hashes:
        raise CompositorError(
            f"identical asset bytes assigned across splits: {leaked_hashes}"
        )
    return sorted(assets, key=lambda asset: asset.asset_id)


def seeded_generator(
    revision: str, scene_seed: int, transformation_seed: int
) -> np.random.Generator:
    material = canonical_json(
        [revision, int(scene_seed), int(transformation_seed)]
    )
    seed = int.from_bytes(bytes.fromhex(sha256_bytes(material))[:16], "big")
    return np.random.Generator(np.random.PCG64(seed))


def _triangular(rng: np.random.Generator, values: dict[str, float]) -> float:
    return float(rng.triangular(values["minimum"], values["mode"], values["maximum"]))


def _camera_quad(
    *,
    center: tuple[float, float],
    long_side: float,
    aspect: float,
    tilt_degrees: float,
    yaw_degrees: float,
    roll_degrees: float,
) -> tuple[tuple[float, float], ...]:
    points = np.array(
        [
            [-aspect / 2, -0.5, 0.0],
            [aspect / 2, -0.5, 0.0],
            [aspect / 2, 0.5, 0.0],
            [-aspect / 2, 0.5, 0.0],
        ],
        dtype=np.float64,
    )
    pitch = math.radians(tilt_degrees)
    yaw = math.radians(yaw_degrees)
    roll = math.radians(roll_degrees)
    rx = np.array(
        [[1, 0, 0], [0, math.cos(pitch), -math.sin(pitch)], [0, math.sin(pitch), math.cos(pitch)]],
        dtype=np.float64,
    )
    ry = np.array(
        [[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]],
        dtype=np.float64,
    )
    rz = np.array(
        [[math.cos(roll), -math.sin(roll), 0], [math.sin(roll), math.cos(roll), 0], [0, 0, 1]],
        dtype=np.float64,
    )
    rotated = points @ (rz @ ry @ rx).T
    depth = 2.6
    projected = rotated[:, :2] / (1.0 + rotated[:, 2:3] / depth)
    span = max(float(np.ptp(projected[:, 0])), float(np.ptp(projected[:, 1])))
    projected *= long_side / max(span, 1e-9)
    projected[:, 0] += center[0]
    projected[:, 1] += center[1]
    return tuple((float(x), float(y)) for x, y in projected)


def _fit_quad(
    quad: tuple[tuple[float, float], ...], width: int, height: int, padding: float = 3
) -> tuple[tuple[float, float], ...]:
    xs = [point[0] for point in quad]
    ys = [point[1] for point in quad]
    dx = max(padding - min(xs), min(0.0, width - padding - max(xs)))
    dy = max(padding - min(ys), min(0.0, height - padding - max(ys)))
    return tuple((x + dx, y + dy) for x, y in quad)


def _layout(
    scene_slice: str,
    rng: np.random.Generator,
    config: dict[str, Any],
    padded_width: int,
    padded_height: int,
    capture_width: int,
    capture_height: int,
    margins: dict[str, int],
) -> tuple[list[tuple[tuple[float, float], ...]], bool]:
    scene = config["scenes"][scene_slice]
    origin_x = margins["left"]
    origin_y = margins["top"]

    def make(center, long_side, tilt, roll):
        quad = _camera_quad(
            center=center,
            long_side=long_side,
            aspect=0.714,
            tilt_degrees=tilt,
            yaw_degrees=float(rng.uniform(-tilt / 2, tilt / 2)),
            roll_degrees=roll,
        )
        return _fit_quad(quad, padded_width, padded_height)

    quads = []
    hand = False
    if scene_slice == "binder_page":
        page_roll = float(rng.uniform(-10, 10))
        tilt = float(rng.uniform(*scene["tiltDegrees"]))
        long_side = float(rng.uniform(*scene["longSidePixels"]))
        for row in range(3):
            for column in range(3):
                center = (
                    origin_x + (column + 0.5) * capture_width / 3 + float(rng.uniform(-12, 12)),
                    origin_y + (row + 0.5) * capture_height / 3 + float(rng.uniform(-16, 16)),
                )
                quads.append(make(center, long_side, tilt, page_roll + float(rng.uniform(-2, 2))))
    elif scene_slice == "duel_field":
        count = int(rng.integers(scene["instances"][0], scene["instances"][1] + 1))
        prior = None
        for index in range(count):
            if prior is not None and rng.random() < 0.55:
                center = (prior[0] + float(rng.uniform(25, 100)), prior[1] + float(rng.uniform(18, 80)))
            else:
                center = (
                    origin_x + float(rng.uniform(0.12, 0.88)) * capture_width,
                    origin_y + float(rng.uniform(0.12, 0.88)) * capture_height,
                )
            prior = center
            quads.append(
                make(
                    center,
                    float(rng.uniform(*scene["longSidePixels"])),
                    float(rng.uniform(*scene["tiltDegrees"])),
                    float(rng.uniform(0, 360)),
                )
            )
    else:
        outside_probability = float(scene.get("outsideFrameProbability", 0))
        long_side = float(rng.uniform(*scene["longSidePixels"]))
        if rng.random() < outside_probability:
            edge = int(rng.integers(0, 4))
            centers = [
                (origin_x + float(rng.uniform(-0.08, 0.08)) * capture_width, origin_y + float(rng.uniform(0.2, 0.8)) * capture_height),
                (origin_x + float(rng.uniform(0.92, 1.08)) * capture_width, origin_y + float(rng.uniform(0.2, 0.8)) * capture_height),
                (origin_x + float(rng.uniform(0.2, 0.8)) * capture_width, origin_y + float(rng.uniform(-0.08, 0.08)) * capture_height),
                (origin_x + float(rng.uniform(0.2, 0.8)) * capture_width, origin_y + float(rng.uniform(0.92, 1.08)) * capture_height),
            ]
            center = centers[edge]
        else:
            center = (
                origin_x + float(rng.uniform(0.25, 0.75)) * capture_width,
                origin_y + float(rng.uniform(0.25, 0.75)) * capture_height,
            )
        quads.append(
            make(
                center,
                long_side,
                float(rng.uniform(*scene["tiltDegrees"])),
                float(rng.uniform(0, 360)),
            )
        )
        hand = scene_slice == "single_handheld" and rng.random() < float(scene.get("handOccluderProbability", 0))
    return quads, hand


def _perspective_coefficients(
    destination: tuple[tuple[float, float], ...], source: tuple[tuple[float, float], ...]
) -> tuple[float, ...]:
    matrix = []
    values = []
    for (x, y), (u, v) in zip(destination, source):
        matrix.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        values.append(u)
        matrix.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        values.append(v)
    return tuple(float(value) for value in np.linalg.solve(np.array(matrix), np.array(values)))


def _warp_asset(
    asset: Asset,
    quad: tuple[tuple[float, float], ...],
    canvas_size: tuple[int, int],
    sleeve_tint: tuple[int, int, int, int] | None,
) -> tuple[Image.Image, np.ndarray]:
    with Image.open(asset.path) as opened:
        card = opened.convert("RGBA")
    if sleeve_tint is not None:
        overlay = Image.new("RGBA", card.size, sleeve_tint)
        card = Image.alpha_composite(card, overlay)
    source = ((0.0, 0.0), (card.width - 1.0, 0.0), (card.width - 1.0, card.height - 1.0), (0.0, card.height - 1.0))
    coefficients = _perspective_coefficients(quad, source)
    warped = card.transform(
        canvas_size,
        Image.Transform.PERSPECTIVE,
        coefficients,
        resample=Image.Resampling.BICUBIC,
        fillcolor=(0, 0, 0, 0),
    )
    mask_source = Image.new("L", card.size, 255)
    mask = mask_source.transform(
        canvas_size,
        Image.Transform.PERSPECTIVE,
        coefficients,
        resample=Image.Resampling.NEAREST,
        fillcolor=0,
    )
    return warped, np.asarray(mask, dtype=np.uint8) > 0


def _background(asset: Asset, size: tuple[int, int]) -> Image.Image:
    with Image.open(asset.path) as opened:
        image = opened.convert("RGB")
    return ImageOps.fit(image, size, method=Image.Resampling.BICUBIC).convert("RGBA")


def _draw_distractors(
    canvas: Image.Image,
    rng: np.random.Generator,
    art_asset: Asset,
    *,
    enabled: bool = True,
) -> tuple[list[str], int]:
    if not enabled:
        return [], 0
    draw = ImageDraw.Draw(canvas, "RGBA")
    width, height = canvas.size
    procedural_count = int(rng.integers(1, 5))
    for _ in range(procedural_count):
        x = int(rng.uniform(0, width * 0.85))
        y = int(rng.uniform(0, height * 0.85))
        w = int(rng.uniform(70, 260))
        h = int(rng.uniform(50, 220))
        kind = int(rng.integers(0, 3))
        if kind == 0:
            draw.rounded_rectangle((x, y, x + w, y + h), radius=18, fill=(25, 28, 32, 230), outline=(110, 115, 120, 255), width=4)
        elif kind == 1:
            draw.rectangle((x, y, x + w, y + h), fill=(235, 229, 210, 235), outline=(160, 150, 125, 255), width=3)
        else:
            draw.rectangle((x, y, x + w, y + h), fill=(95, 80, 65, 180), outline=(180, 160, 130, 230), width=2)
    if rng.random() < 0.5:
        with Image.open(art_asset.path) as opened:
            art = opened.convert("RGB")
        crop = art.crop((art.width * 0.12, art.height * 0.18, art.width * 0.88, art.height * 0.68))
        crop.thumbnail((260, 180), Image.Resampling.BICUBIC)
        x = int(rng.uniform(0, max(1, width - crop.width)))
        y = int(rng.uniform(0, max(1, height - crop.height)))
        canvas.alpha_composite(crop.convert("RGBA"), (x, y))
        return [art_asset.asset_id], procedural_count + 1
    return [], procedural_count


def _draw_scene_surface(
    canvas: Image.Image,
    scene_slice: str,
    margins: dict[str, int],
    capture_width: int,
    capture_height: int,
) -> None:
    """Add non-card layout cues below cards without creating annotations."""
    draw = ImageDraw.Draw(canvas, "RGBA")
    left = margins["left"]
    top = margins["top"]
    right = left + capture_width
    bottom = top + capture_height
    if scene_slice == "binder_page":
        draw.rounded_rectangle(
            (left + 12, top + 12, right - 12, bottom - 12),
            radius=24,
            fill=(32, 36, 42, 130),
            outline=(210, 215, 220, 115),
            width=5,
        )
        for column in (1, 2):
            x = left + column * capture_width / 3
            draw.line((x, top + 18, x, bottom - 18), fill=(225, 230, 235, 105), width=4)
        for row in (1, 2):
            y = top + row * capture_height / 3
            draw.line((left + 18, y, right - 18, y), fill=(225, 230, 235, 105), width=4)
    elif scene_slice in {"duel_field", "steep_playmat"}:
        draw.rectangle((left, top, right, bottom), fill=(20, 55, 48, 58))
        draw.ellipse(
            (left + capture_width * 0.2, top + capture_height * 0.28, right - capture_width * 0.2, bottom - capture_height * 0.28),
            outline=(190, 205, 180, 55),
            width=8,
        )


def _hand_occluder(
    size: tuple[int, int], rng: np.random.Generator
) -> tuple[Image.Image, np.ndarray]:
    width, height = size
    overlay = Image.new("RGBA", size, (0, 0, 0, 0))
    mask_image = Image.new("L", size, 0)
    draw = ImageDraw.Draw(overlay, "RGBA")
    mask_draw = ImageDraw.Draw(mask_image)
    center_x = int(rng.uniform(width * 0.25, width * 0.75))
    center_y = int(rng.uniform(height * 0.25, height * 0.75))
    radius_x = int(rng.uniform(80, 180))
    radius_y = int(rng.uniform(45, 100))
    box = (center_x - radius_x, center_y - radius_y, center_x + radius_x, center_y + radius_y)
    color = (int(rng.uniform(155, 225)), int(rng.uniform(105, 180)), int(rng.uniform(75, 150)), 245)
    draw.ellipse(box, fill=color)
    mask_draw.ellipse(box, fill=255)
    return overlay, np.asarray(mask_image, dtype=np.uint8) > 0


def _apply_photometrics(
    image: Image.Image, rng: np.random.Generator, config: dict[str, Any]
) -> Image.Image:
    settings = config["photometrics"]
    image = ImageEnhance.Contrast(image).enhance(_triangular(rng, settings["contrast"]))
    image = ImageEnhance.Color(image).enhance(_triangular(rng, settings["saturation"]))
    image = ImageEnhance.Brightness(image).enhance(_triangular(rng, settings["brightness"]))
    array = np.asarray(image.convert("RGB"), dtype=np.float32)
    warm = float(rng.uniform(1.0, settings["colorGainMaximum"]))
    cool = float(rng.uniform(1.0, settings["colorGainMaximum"]))
    if rng.random() < 0.5:
        gains = np.array([warm, 1.0, 1.0 / cool], dtype=np.float32)
    else:
        gains = np.array([1.0 / warm, 1.0, cool], dtype=np.float32)
    array = np.clip(array * gains, 0, 255)
    gamma = float(rng.uniform(settings["gamma"]["minimum"], settings["gamma"]["maximum"]))
    array = 255.0 * np.power(array / 255.0, gamma)
    noise_sigma = _triangular(rng, settings["noiseSigma"])
    if noise_sigma > 0:
        array += rng.normal(0, noise_sigma, array.shape).astype(np.float32)
    image = Image.fromarray(np.clip(array, 0, 255).astype(np.uint8), "RGB")
    sharpness = _triangular(rng, settings["sharpness"])
    if sharpness < 0.9:
        image = image.filter(ImageFilter.GaussianBlur(radius=(0.9 - sharpness) * 2.2))
    elif sharpness > 1.05:
        image = image.filter(ImageFilter.UnsharpMask(radius=1.2, percent=int((sharpness - 1) * 130), threshold=2))
    if rng.random() < 0.55:
        vignette = np.ones((image.height, image.width), dtype=np.float32)
        yy, xx = np.ogrid[-1:1:complex(image.height), -1:1:complex(image.width)]
        vignette -= np.clip((xx * xx + yy * yy) * float(rng.uniform(0.05, 0.22)), 0, 0.45)
        array = np.asarray(image, dtype=np.float32) * vignette[..., None]
        image = Image.fromarray(np.clip(array, 0, 255).astype(np.uint8), "RGB")
    if rng.random() < 0.45:
        glare = Image.new("RGBA", image.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(glare, "RGBA")
        for _ in range(int(rng.integers(1, 4))):
            x = int(rng.uniform(-image.width * 0.1, image.width * 0.9))
            y = int(rng.uniform(-image.height * 0.1, image.height * 0.9))
            w = int(rng.uniform(90, 360))
            h = int(rng.uniform(30, 150))
            draw.ellipse((x, y, x + w, y + h), fill=(255, 255, 255, int(rng.uniform(18, 80))))
        image = Image.alpha_composite(image.convert("RGBA"), glare.filter(ImageFilter.GaussianBlur(18))).convert("RGB")
    quality = int(rng.integers(settings["intermediateJpegQuality"]["minimum"], settings["intermediateJpegQuality"]["maximum"] + 1))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality, optimize=False, progressive=False, subsampling=2)
    with Image.open(io.BytesIO(buffer.getvalue())) as decoded:
        return decoded.convert("RGB")


def _jpeg_bytes(image: Image.Image, quality: int) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality, optimize=False, progressive=False, subsampling=2)
    return buffer.getvalue()


def _coco_rle(mask: np.ndarray) -> dict[str, Any]:
    flat = np.asarray(mask, dtype=np.uint8).reshape(-1, order="F")
    if flat.size == 0:
        return {"kind": "cocoRle", "width": mask.shape[1], "height": mask.shape[0], "counts": [0]}
    changes = np.flatnonzero(flat[1:] != flat[:-1]) + 1
    boundaries = np.concatenate(([0], changes, [flat.size]))
    counts = np.diff(boundaries).astype(int).tolist()
    if flat[0] == 1:
        counts.insert(0, 0)
    return {"kind": "cocoRle", "width": int(mask.shape[1]), "height": int(mask.shape[0]), "counts": counts}


def _scene_seed(base: int, split: str, scene_slice: str, ordinal: int) -> tuple[int, int]:
    payload = canonical_json([base, split, scene_slice, ordinal])
    digest = bytes.fromhex(sha256_bytes(payload))
    return int.from_bytes(digest[:8], "big"), int.from_bytes(digest[8:16], "big")


def _select_asset(
    assets: list[Asset], split: str, side: str, rng: np.random.Generator
) -> Asset:
    choices = [asset for asset in assets if asset.split == split and asset.side == side]
    if not choices:
        raise CompositorError(f"no {side} card assets assigned to {split}")
    return choices[int(rng.integers(0, len(choices)))]


def render_record(
    *,
    split: str,
    scene_slice: str,
    ordinal: int,
    revision: str,
    config: dict[str, Any],
    card_assets: list[Asset],
    background_assets: list[Asset],
) -> tuple[dict[str, Any], bytes]:
    layout_slice = (
        "single_handheld"
        if scene_slice == "single_handheld_distractor_free"
        else scene_slice
    )
    canvas_config = config["canvas"]
    width = int(canvas_config["width"])
    height = int(canvas_config["height"])
    margins = canvas_config["contextMarginPixels"]
    padded_size = (width + margins["left"] + margins["right"], height + margins["top"] + margins["bottom"])
    scene_seed, transformation_seed = _scene_seed(int(config["generation"]["seedBase"]), split, scene_slice, ordinal)
    rng = seeded_generator(revision, scene_seed, transformation_seed)
    backgrounds = [asset for asset in background_assets if asset.split == split]
    if not backgrounds:
        raise CompositorError(f"no background assets assigned to {split}")
    background = backgrounds[int(rng.integers(0, len(backgrounds)))]
    canvas = _background(background, padded_size)
    _draw_scene_surface(canvas, layout_slice, margins, width, height)
    quads, add_hand = _layout(
        layout_slice,
        rng,
        config,
        padded_size[0],
        padded_size[1],
        width,
        height,
        margins,
    )
    selected = []
    face_down_probability = float(
        config["scenes"].get(layout_slice, {}).get(
            f"faceDownProbability{split.title()}", 0
        )
    )
    for quad in quads:
        side = "faceDown" if rng.random() < face_down_probability else "faceUp"
        asset = _select_asset(card_assets, split, side, rng)
        tint = None
        if rng.random() < 0.35:
            tint = (int(rng.uniform(40, 190)), int(rng.uniform(50, 200)), int(rng.uniform(80, 220)), int(rng.uniform(8, 35)))
        selected.append(SceneCard(asset=asset, quad=quad, side=side, sleeve_tint=tint))
    distractor_ids, distractor_count = _draw_distractors(
        canvas,
        rng,
        selected[0].asset,
        enabled=scene_slice != "single_handheld_distractor_free",
    )
    full_masks = []
    for card in selected:
        warped, mask = _warp_asset(card.asset, card.quad, padded_size, card.sleeve_tint)
        canvas = Image.alpha_composite(canvas, warped)
        full_masks.append(mask)
    hand_mask = np.zeros((padded_size[1], padded_size[0]), dtype=bool)
    if add_hand:
        overlay, hand_mask = _hand_occluder(padded_size, rng)
        canvas = Image.alpha_composite(canvas, overlay)

    crop_box = (margins["left"], margins["top"], margins["left"] + width, margins["top"] + height)
    capture = canvas.crop(crop_box).convert("RGB")
    capture = _apply_photometrics(capture, rng, config)
    image_bytes = _jpeg_bytes(capture, int(canvas_config["jpegQuality"]))
    record_id = f"syn-{split}-{scene_slice}-{scene_seed:016x}-{transformation_seed:016x}"
    instances = []
    for index, card in enumerate(selected):
        higher = hand_mask.copy()
        for mask in full_masks[index + 1 :]:
            higher |= mask
        visible = full_masks[index] & ~higher
        visible_capture = visible[margins["top"] : margins["top"] + height, margins["left"] : margins["left"] + width]
        corners = []
        for x, y in card.quad:
            source_x = x - margins["left"]
            source_y = y - margins["top"]
            if source_x < 0 or source_x >= width or source_y < 0 or source_y >= height:
                visibility = "outsideFrame"
            else:
                px = min(padded_size[0] - 1, max(0, int(round(x))))
                py = min(padded_size[1] - 1, max(0, int(round(y))))
                visibility = "occluded" if higher[py, px] else "visible"
            corners.append(
                {
                    "point": {"x": source_x / width, "y": source_y / height},
                    "visibility": visibility,
                    "coordinateKnown": True,
                    "cornerSource": "synthetic",
                }
            )
        instances.append(
            {
                "instanceId": f"card-{index}",
                "detectionClass": "card",
                "corners": corners,
                "orientationKnown": True,
                "side": card.side,
                "container": "rawCard",
                "visibleMask": _coco_rle(visible_capture),
                "occlusionOrder": index,
                "physicalCardId": card.asset.asset_id,
                "sourceAssetId": card.asset.asset_id,
            }
        )
    record = {
        "schema": RECORD_SCHEMA_ID,
        "recordId": record_id,
        "source": {
            "kind": "synthetic",
            "path": f"images/{record_id}.jpg",
            "sha256": sha256_bytes(image_bytes),
            "width": width,
            "height": height,
            "licenseId": "synthetic-training-only-see-asset-manifests",
        },
        "grouping": {"sourceArchiveId": f"synthetic:{revision[:24]}:{split}"},
        "instances": instances,
        "synthetic": {
            "sceneSeed": scene_seed,
            "transformationSeed": transformation_seed,
            "contextMarginPixels": margins,
            "compositorRevision": revision,
            "backgroundAssetId": background.asset_id,
            "distractorSourceAssetIds": sorted(set(distractor_ids)),
            "distractorCount": distractor_count,
        },
    }
    return record, image_bytes


def _smoke_policy(records_per_split_scene: dict[str, dict[str, int]]) -> dict[str, Any]:
    required_splits = [split for split in SPLITS if sum(records_per_split_scene.get(split, {}).values())]
    required_slices = [
        {"sceneSlice": scene, "split": split, "minimumInstances": 1}
        for split in required_splits
        for scene, count in sorted(records_per_split_scene[split].items())
        if count
    ]
    return {
        "schema": POLICY_SCHEMA_ID,
        "policyId": "synthetic-compositor-smoke-v1",
        "description": "Tooling-only synthetic compositor smoke; never authorizes training.",
        "requiredSplits": required_splits,
        "minimumRecordsPerSplit": {split: 1 for split in required_splits},
        "minimumInstancesPerSplit": {split: 1 for split in required_splits},
        "minimumMetricEligibleInstances": {split: 1 for split in required_splits},
        "allowedSourceTiers": ["shippable"],
        "minimumRealEvaluationSessions": 0,
        "realOnlySplits": ["test"],
        "requiredSceneSlices": required_slices,
        "requiredLeakageKeys": {"real": [], "synthetic": ["physicalCardIds", "sourceAssetIds"]},
        "metricEligibleCornerSources": ["human", "synthetic"],
    }


def build_release(
    *,
    output: Path,
    release_id: str,
    config_path: Path,
    card_manifest_path: Path,
    background_manifest_path: Path,
    compositor_git_sha: str,
    workers: int = 1,
) -> dict[str, Any]:
    if output.exists() and any(output.iterdir()):
        raise CompositorError(f"refusing to replace non-empty output: {output}")
    output.mkdir(parents=True, exist_ok=True)
    card_manifest_sha = sha256_file(card_manifest_path)
    background_manifest_sha = sha256_file(background_manifest_path)
    config = load_resolved_config(
        config_path,
        card_manifest_sha256=card_manifest_sha,
        background_manifest_sha256=background_manifest_sha,
    )
    revision, config_sha = compositor_revision(compositor_git_sha, config)
    card_assets = load_assets(card_manifest_path, "card")
    background_assets = load_assets(background_manifest_path, "background")
    records_per_split_scene = config["generation"]["recordsPerSplitScene"]
    policy = _smoke_policy(records_per_split_scene)
    policy_text = pretty_json(policy)
    (output / "policy.json").write_text(policy_text, encoding="utf-8")
    (output / "compositor-config.resolved.json").write_text(pretty_json(config), encoding="utf-8")
    provenance_dir = output / "provenance"
    provenance_dir.mkdir()
    shutil.copyfile(card_manifest_path, provenance_dir / "card-assets.json")
    shutil.copyfile(background_manifest_path, provenance_dir / "background-assets.json")

    entries = []
    counts = Counter()
    distractors_by_scene: dict[str, Counter[str]] = {
        scene: Counter() for scene in SCENE_SLICES
    }
    tasks = [
        (split, scene_slice, ordinal, revision)
        for split in SPLITS
        for scene_slice in SCENE_SLICES
        for ordinal in range(int(records_per_split_scene.get(split, {}).get(scene_slice, 0)))
    ]
    if workers < 1:
        raise CompositorError("--workers must be at least 1")
    if workers == 1:
        rendered = (
            render_record(
                split=split,
                scene_slice=scene_slice,
                ordinal=ordinal,
                revision=task_revision,
                config=config,
                card_assets=card_assets,
                background_assets=background_assets,
            )
            for split, scene_slice, ordinal, task_revision in tasks
        )
    else:
        executor = ProcessPoolExecutor(
            max_workers=workers,
            initializer=_initialize_worker,
            initargs=(config, str(card_manifest_path), str(background_manifest_path)),
        )
        rendered = executor.map(_render_worker, tasks, chunksize=1)
    try:
        for (split, scene_slice, _, _), (record, image_bytes) in zip(tasks, rendered):
            record_id = record["recordId"]
            image_rel = record["source"]["path"]
            record_rel = f"records/{record_id}.json"
            image_path = output / image_rel
            record_path = output / record_rel
            image_path.parent.mkdir(parents=True, exist_ok=True)
            record_path.parent.mkdir(parents=True, exist_ok=True)
            image_path.write_bytes(image_bytes)
            record_text = pretty_json(record)
            record_path.write_text(record_text, encoding="utf-8")
            entries.append(
                {
                    "recordId": record_id,
                    "path": record_rel,
                    "sha256": sha256_bytes(record_text.encode("utf-8")),
                    "split": split,
                    "sceneSlice": scene_slice,
                    "sourceTier": "shippable",
                    "leakageKeys": leakage_keys_from_record(record),
                    "images": [{"path": image_rel, "sha256": sha256_bytes(image_bytes)}],
                }
            )
            counts["records"] += 1
            counts["instances"] += len(record["instances"])
            counts[f"split:{split}"] += 1
            counts[f"scene:{scene_slice}"] += 1
            distractor_count = int(record["synthetic"]["distractorCount"])
            distractors_by_scene[scene_slice]["records"] += 1
            distractors_by_scene[scene_slice]["distractors"] += distractor_count
            if distractor_count:
                distractors_by_scene[scene_slice]["recordsWithDistractors"] += 1
            for instance in record["instances"]:
                for corner in instance["corners"]:
                    counts[f"visibility:{corner['visibility']}"] += 1
    finally:
        if workers != 1:
            executor.shutdown()
    manifest = {
        "schema": MANIFEST_SCHEMA_ID,
        "releaseId": release_id,
        "releasePurpose": "smoke",
        "readiness": {
            "readinessPolicyPath": "policy.json",
            "readinessPolicyId": policy["policyId"],
            "readinessPolicySha256": sha256_bytes(policy_text.encode("utf-8")),
        },
        "splitAssignment": {"method": "asset-manifest-preassigned-v1", "seed": int(config["generation"]["seedBase"])},
        "evaluationSessionDenylist": [],
        "records": sorted(entries, key=lambda entry: entry["recordId"]),
    }
    manifest["corpusHash"] = corpus_hash(manifest)
    (output / "manifest.json").write_text(pretty_json(manifest), encoding="utf-8")
    summary = {
        "schema": BUILD_SUMMARY_SCHEMA,
        "releaseId": release_id,
        "releasePurpose": "smoke",
        "corpusHash": manifest["corpusHash"],
        "compositorGitSha": compositor_git_sha,
        "compositorRevision": revision,
        "resolvedConfigSha256": config_sha,
        "assetManifestSha256": {"cards": card_manifest_sha, "backgrounds": background_manifest_sha},
        "counts": dict(sorted(counts.items())),
        "distractorPrevalenceBySceneSlice": {
            scene: {
                "records": values["records"],
                "recordsWithDistractors": values["recordsWithDistractors"],
                "recordPrevalence": (
                    values["recordsWithDistractors"] / values["records"]
                    if values["records"]
                    else 0.0
                ),
                "distractorCount": values["distractors"],
                "meanDistractorsPerRecord": (
                    values["distractors"] / values["records"]
                    if values["records"]
                    else 0.0
                ),
            }
            for scene, values in distractors_by_scene.items()
            if values["records"]
        },
    }
    (output / "build-summary.json").write_text(pretty_json(summary), encoding="utf-8")
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--card-assets", type=Path, required=True)
    parser.add_argument("--background-assets", type=Path, required=True)
    parser.add_argument("--compositor-git-sha", required=True)
    parser.add_argument("--workers", type=int, default=1)
    args = parser.parse_args(argv)
    try:
        summary = build_release(
            output=args.output,
            release_id=args.release_id,
            config_path=args.config,
            card_manifest_path=args.card_assets,
            background_manifest_path=args.background_assets,
            compositor_git_sha=args.compositor_git_sha,
            workers=args.workers,
        )
    except (CompositorError, OSError, json.JSONDecodeError) as error:
        print(f"compositor failed: {error}", file=sys.stderr)
        return 2
    print(pretty_json(summary), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
