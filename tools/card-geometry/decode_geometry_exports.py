#!/usr/bin/env python3
"""Reference decoders for raw shared card-geometry export tensors."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from reference_geometry import process_candidates


DEFAULT_DECODER_CONFIG = {
    "minimumConfidence": 0.05,
    "minimumQuadArea": 0.001,
    "exteriorMargin": 0.25,
    "nmsIouThreshold": 0.5,
    "aspectRatioBands": {
        "rawCard": [0.5, 3.0],
        "slab": [0.5, 3.0],
        "unknown": [0.5, 3.0],
    },
}


def model_point_to_source(
    x: float, y: float, transform: dict[str, Any]
) -> dict[str, float]:
    margins = transform["contextMarginPixels"]
    scale = float(transform["scale"])
    padded_x = (x - float(transform["padLeft"])) / scale
    padded_y = (y - float(transform["padTop"])) / scale
    return {
        "x": (padded_x - float(margins["left"])) / float(transform["sourceWidth"]),
        "y": (padded_y - float(margins["top"])) / float(transform["sourceHeight"]),
    }


def yolo_pose_candidates(
    raw_output,
    *,
    resolution: int,
    minimum_confidence: float = 0.05,
    transform: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Decode a YOLO11 pose `(1, 5 + 4*3, anchors)` raw export tensor."""
    import numpy as np

    raw = np.asarray(raw_output, dtype=np.float32)
    if raw.ndim != 3 or raw.shape[0] != 1:
        raise ValueError(f"expected rank-3 batch-one YOLO output, got {raw.shape}")
    if raw.shape[1] != 17 and raw.shape[2] == 17:
        raw = raw.transpose(0, 2, 1)
    if raw.shape[1] != 17:
        raise ValueError(f"expected 17 channels for one class and four keypoints, got {raw.shape}")
    rows = []
    for index in np.flatnonzero(raw[0, 4] >= minimum_confidence):
        confidence = float(raw[0, 4, index])
        keypoints = raw[0, 5:, index].reshape(4, 3)
        corners = []
        for x, y, corner_confidence in keypoints:
            point = (
                model_point_to_source(float(x), float(y), transform)
                if transform is not None
                else {"x": float(x) / resolution, "y": float(y) / resolution}
            )
            corners.append(
                {"point": point, "confidence": float(corner_confidence)}
            )
        rows.append(
            {
                "corners": corners,
                "confidence": confidence,
                "cornerOrderConfidence": None,
                "side": "unknown",
                "container": "rawCard",
            }
        )
    return rows


def decode_yolo_pose(
    raw_output,
    *,
    resolution: int = 640,
    transform: dict[str, Any] | None = None,
    decoder_config: dict[str, Any] | None = None,
    model_id: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    config = deepcopy(decoder_config or DEFAULT_DECODER_CONFIG)
    candidates = yolo_pose_candidates(
        raw_output,
        resolution=resolution,
        minimum_confidence=float(config["minimumConfidence"]),
        transform=transform,
    )
    return process_candidates(
        candidates,
        config,
        model_id or {"releaseVersion": 1, "artifactSha256": "0" * 64},
    )
