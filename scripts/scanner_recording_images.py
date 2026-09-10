"""Read legacy and original-only scanner recordings without modifying them.

`imageFile` identifies the logical pipeline input. If that JPEG is absent,
`inputImageTransform` v1 reconstructs an integer crop from `sourceImageFile`.
Dimensions/quad coordinates in results and evidence still refer to the input.
Materialized PNGs are disposable viewer caches, never extra source records.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import tempfile
import sys


def default_input_cache() -> Path:
    if root := os.environ.get("TCGER_LABELING_CACHE_DIR"):
        return Path(root).expanduser() / "inputs"
    if sys.platform == "darwin":
        return Path.home() / "Library/Caches/TCGer/scanner-inputs"
    return Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "tcger/scanner-inputs"


def session_path(session: Path, name: str) -> Path:
    root = session.resolve()
    path = (root / name).resolve()
    if not name or not path.is_relative_to(root) or path == root:
        raise ValueError(f"Invalid recording image path: {name!r}")
    return path


def crop_rect(transform: dict) -> tuple[int, int, int, int]:
    if transform.get("version") != 1 or transform.get("coordinateSpace") != "uprightPixelsTopLeft":
        raise ValueError("Unsupported scanner input image transform")
    values = transform.get("cropRectPixels")
    width, height = transform.get("sourcePixelWidth"), transform.get("sourcePixelHeight")
    if (not isinstance(values, list) or len(values) != 4
            or any(type(v) is not int for v in values)
            or type(width) is not int or type(height) is not int):
        raise ValueError("Scanner input crop requires integer pixel dimensions")
    x, y, w, h = values
    if min(x, y) < 0 or min(w, h) <= 0 or x + w > width or y + h > height:
        raise ValueError("Scanner input crop is outside its source image")
    return x, y, w, h


def load_input_image(session: Path, record: dict):
    from PIL import Image

    path = session_path(session, record["imageFile"])
    if path.is_file():
        with Image.open(path) as image:
            return image.convert("RGB")
    transform = record.get("inputImageTransform")
    if not transform:
        raise FileNotFoundError(path)
    x, y, width, height = crop_rect(transform)
    source_path = session_path(session, transform["sourceImageFile"])
    with Image.open(source_path) as source:
        if source.size != (transform["sourcePixelWidth"], transform["sourcePixelHeight"]):
            raise ValueError("Scanner input source dimensions do not match its recipe")
        return source.convert("RGB").crop((x, y, x + width, y + height))


def materialize_input(session: Path, record: dict, cache: Path) -> Path:
    path = session_path(session, record["imageFile"])
    if path.is_file() or not record.get("inputImageTransform"):
        return path
    transform = record["inputImageTransform"]
    crop_rect(transform)
    source = session_path(session, transform["sourceImageFile"])
    digest = hashlib.sha256(b"scanner-input-pillow-rgb-v1\0")
    digest.update(source.read_bytes())
    digest.update(json.dumps(transform, sort_keys=True).encode())
    destination = cache / f"{path.stem}-{digest.hexdigest()}.png"
    if destination.is_file():
        return destination
    image = load_input_image(session, record)
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=cache, suffix=".png", delete=False) as temporary:
        temporary_path = Path(temporary.name)
    try:
        image.save(temporary_path, format="PNG")
        os.replace(temporary_path, destination)
    finally:
        temporary_path.unlink(missing_ok=True)
    return destination
