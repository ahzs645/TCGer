#!/usr/bin/env python3
"""Measure ONNX/Core ML parity, artifact size, and available-host latency."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import statistics
import time
from pathlib import Path
from typing import Any, Callable


SCHEMA_ID = "https://tcger.app/reports/card-geometry-export-benchmark/v1"
FIXTURE_SPECS = (
    {"id": "black", "kind": "solid", "rgb": [0, 0, 0]},
    {"id": "gradient", "kind": "gradient-mod-256"},
    {"id": "checker", "kind": "checker", "cellPixels": 32},
    {"id": "seeded-noise", "kind": "noise", "seed": 20260904},
)


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def artifact_identity(path: Path) -> dict[str, Any]:
    """Hash one file or a directory without depending on filesystem metadata."""
    if path.is_file():
        return {"bytes": path.stat().st_size, "sha256": sha256_file(path)}
    files = sorted(item for item in path.rglob("*") if item.is_file())
    digest = hashlib.sha256()
    total = 0
    for item in files:
        relative = item.relative_to(path).as_posix().encode()
        file_digest = sha256_file(item)
        size = item.stat().st_size
        digest.update(relative)
        digest.update(b"\0")
        digest.update(str(size).encode())
        digest.update(b"\0")
        digest.update(file_digest.encode())
        digest.update(b"\n")
        total += size
    return {"bytes": total, "files": len(files), "sha256": digest.hexdigest()}


def fixture_pixels(spec: dict[str, Any], size: int):
    import numpy as np

    if spec["kind"] == "solid":
        return np.broadcast_to(np.asarray(spec["rgb"], dtype=np.uint8), (size, size, 3)).copy()
    y, x = np.mgrid[0:size, 0:size]
    if spec["kind"] == "gradient-mod-256":
        return np.stack((x % 256, y % 256, (x + y) % 256), axis=-1).astype(np.uint8)
    if spec["kind"] == "checker":
        cell = int(spec["cellPixels"])
        mono = (((x // cell + y // cell) % 2) * 255).astype(np.uint8)
        return np.repeat(mono[..., None], 3, axis=-1)
    if spec["kind"] == "noise":
        return np.random.default_rng(int(spec["seed"])).integers(
            0, 256, (size, size, 3), dtype=np.uint8
        )
    raise ValueError(f"unsupported fixture kind: {spec['kind']}")


def output_metrics(reference, candidate) -> dict[str, Any]:
    import numpy as np

    reference = np.asarray(reference, dtype=np.float32)
    candidate = np.asarray(candidate, dtype=np.float32)
    if reference.shape != candidate.shape:
        raise ValueError(f"output shape mismatch: {reference.shape} != {candidate.shape}")
    delta = np.abs(reference - candidate)
    reference_flat = reference.ravel()
    candidate_flat = candidate.ravel()
    denominator = float(np.linalg.norm(reference_flat) * np.linalg.norm(candidate_flat))
    cosine = 1.0 if denominator == 0 else float(np.dot(reference_flat, candidate_flat) / denominator)
    return {
        "shape": list(reference.shape),
        "maxAbs": float(delta.max(initial=0)),
        "meanAbs": float(delta.mean()) if delta.size else 0.0,
        "p99Abs": float(np.quantile(delta, 0.99)) if delta.size else 0.0,
        "cosine": cosine,
    }


def latency_summary(values: list[float]) -> dict[str, Any]:
    if not values:
        raise ValueError("latency sample cannot be empty")
    ordered = sorted(values)

    def percentile(fraction: float) -> float:
        position = (len(ordered) - 1) * fraction
        lower = int(position)
        upper = min(lower + 1, len(ordered) - 1)
        weight = position - lower
        return ordered[lower] * (1 - weight) + ordered[upper] * weight

    return {
        "count": len(values),
        "meanMs": statistics.fmean(values),
        "p50Ms": percentile(0.50),
        "p90Ms": percentile(0.90),
        "p95Ms": percentile(0.95),
    }


def time_runtime(call: Callable[[], Any], warmup: int, iterations: int) -> dict[str, Any]:
    for _ in range(warmup):
        call()
    values = []
    for _ in range(iterations):
        started = time.perf_counter()
        call()
        values.append((time.perf_counter() - started) * 1000)
    return latency_summary(values)


def benchmark(
    *,
    candidate: str,
    experiment_hash: str,
    onnx_path: Path,
    coreml_path: Path,
    size: int,
    warmup: int,
    iterations: int,
    golden_output: Path | None = None,
) -> dict[str, Any]:
    import coremltools as ct
    import numpy as np
    import onnxruntime as ort
    from PIL import Image

    onnx = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    coreml_cpu = ct.models.MLModel(str(coreml_path), compute_units=ct.ComputeUnit.CPU_ONLY)
    coreml_all = ct.models.MLModel(str(coreml_path), compute_units=ct.ComputeUnit.ALL)
    onnx_input = onnx.get_inputs()[0].name
    onnx_output = onnx.get_outputs()[0].name
    coreml_input = coreml_cpu.get_spec().description.input[0].name
    coreml_output = coreml_cpu.get_spec().description.output[0].name
    rows = []
    golden_manifest = []
    golden_arrays: dict[str, Any] = {}
    latency_image = None
    latency_tensor = None
    for spec in FIXTURE_SPECS:
        pixels = fixture_pixels(spec, size)
        tensor = np.transpose(pixels.astype(np.float32) / 255.0, (2, 0, 1))[None]
        image = Image.fromarray(pixels)
        onnx_value = np.asarray(onnx.run([onnx_output], {onnx_input: tensor})[0], dtype=np.float32)
        coreml_value = np.asarray(
            coreml_cpu.predict({coreml_input: image})[coreml_output], dtype=np.float32
        )
        rows.append(
            {
                "fixture": spec,
                "inputSha256": hashlib.sha256(pixels.tobytes()).hexdigest(),
                "onnxOutputSha256": hashlib.sha256(onnx_value.tobytes()).hexdigest(),
                "coremlOutputSha256": hashlib.sha256(coreml_value.tobytes()).hexdigest(),
                **output_metrics(onnx_value, coreml_value),
            }
        )
        golden_arrays[spec["id"]] = onnx_value
        golden_manifest.append(
            {
                "fixture": spec,
                "rawTensorKey": spec["id"],
                "rawTensorSha256": hashlib.sha256(onnx_value.tobytes()).hexdigest(),
                "shape": list(onnx_value.shape),
                "dtype": "float32-little-endian",
            }
        )
        if spec["id"] == "gradient":
            latency_image, latency_tensor = image, tensor
    if latency_image is None or latency_tensor is None:
        raise RuntimeError("gradient latency fixture is missing")
    latency = {
        "onnxMacCpu": time_runtime(
            lambda: onnx.run([onnx_output], {onnx_input: latency_tensor}), warmup, iterations
        ),
        "coremlMacCpu": time_runtime(
            lambda: coreml_cpu.predict({coreml_input: latency_image}), warmup, iterations
        ),
        "coremlMacAll": time_runtime(
            lambda: coreml_all.predict({coreml_input: latency_image}), warmup, iterations
        ),
    }
    if golden_output is not None:
        golden_output.mkdir(parents=True, exist_ok=False)
        np.savez_compressed(golden_output / "raw-tensors.npz", **golden_arrays)
        (golden_output / "manifest.json").write_bytes(
            canonical_json(
                {
                    "schema": "https://tcger.app/fixtures/card-geometry-raw-tensors/v1",
                    "candidate": candidate,
                    "experimentHash": experiment_hash,
                    "fixtures": golden_manifest,
                }
            )
        )
    return {
        "schema": SCHEMA_ID,
        "candidate": candidate,
        "experimentHash": experiment_hash,
        "host": {"platform": platform.platform(), "machine": platform.machine()},
        "runtimes": {
            "onnxruntime": ort.__version__,
            "coremltools": ct.__version__,
            "numpy": np.__version__,
        },
        "artifacts": {
            "onnx": artifact_identity(onnx_path),
            "coreml": artifact_identity(coreml_path),
        },
        "io": {
            "inputSize": [size, size],
            "onnx": {"input": onnx_input, "output": onnx_output},
            "coreml": {"input": coreml_input, "output": coreml_output},
        },
        "parity": rows,
        "latency": latency,
        "physicalDeviceLatency": {
            "ios": {"status": "unavailable", "reason": "no physical iOS device connected"},
            "android": {"status": "unavailable", "reason": "no adb device connected"},
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--experiment-hash", required=True)
    parser.add_argument("--onnx", type=Path, required=True)
    parser.add_argument("--coreml", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--golden-output", type=Path)
    parser.add_argument("--size", type=int, default=640)
    parser.add_argument("--warmup", type=int, default=8)
    parser.add_argument("--iterations", type=int, default=50)
    args = parser.parse_args()
    report = benchmark(
        candidate=args.candidate,
        experiment_hash=args.experiment_hash,
        onnx_path=args.onnx,
        coreml_path=args.coreml,
        size=args.size,
        warmup=args.warmup,
        iterations=args.iterations,
        golden_output=args.golden_output,
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_bytes(canonical_json(report))
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
