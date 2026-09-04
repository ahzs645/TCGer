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


def fastvit_candidates(
    heatmap_logits,
    corner_logits,
    *,
    resolution: int,
    minimum_confidence: float = 0.05,
    transform: dict[str, Any] | None = None,
    maximum_detections: int = 100,
) -> list[dict[str, Any]]:
    """Decode raw FastViT CenterNet-style heatmap and corner tensors."""
    import numpy as np

    heatmap_raw = np.asarray(heatmap_logits, dtype=np.float32)
    corners_raw = np.asarray(corner_logits, dtype=np.float32)
    if heatmap_raw.ndim != 4 or heatmap_raw.shape[:2] != (1, 1):
        raise ValueError(f"expected heatmap shape (1, 1, H, W), got {heatmap_raw.shape}")
    if corners_raw.ndim != 4 or corners_raw.shape[:2] != (1, 8):
        raise ValueError(f"expected corner shape (1, 8, H, W), got {corners_raw.shape}")
    if heatmap_raw.shape[2:] != corners_raw.shape[2:]:
        raise ValueError("FastViT heatmap and corner spatial dimensions disagree")
    heatmap = 1.0 / (1.0 + np.exp(-heatmap_raw[0, 0]))
    padded = np.pad(heatmap, 1, mode="constant", constant_values=-np.inf)
    windows = np.lib.stride_tricks.sliding_window_view(padded, (3, 3))
    peaks = np.where(heatmap == windows.max(axis=(-1, -2)), heatmap, 0.0)
    order = np.argsort(-peaks, axis=None, kind="stable")[:maximum_detections]
    rows = []
    corner_values = 1.0 / (1.0 + np.exp(-corners_raw[0]))
    output_width = peaks.shape[1]
    for flat_index in order:
        confidence = float(peaks.flat[flat_index])
        if confidence < minimum_confidence:
            break
        y, x = divmod(int(flat_index), output_width)
        points = corner_values[:, y, x].reshape(4, 2)
        corners = []
        for normalized_x, normalized_y in points:
            point = (
                model_point_to_source(
                    float(normalized_x) * resolution,
                    float(normalized_y) * resolution,
                    transform,
                )
                if transform is not None
                else {"x": float(normalized_x), "y": float(normalized_y)}
            )
            corners.append({"point": point, "confidence": confidence})
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


def decode_fastvit_four_corner(
    heatmap_logits,
    corner_logits,
    *,
    resolution: int = 640,
    transform: dict[str, Any] | None = None,
    decoder_config: dict[str, Any] | None = None,
    model_id: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    config = deepcopy(decoder_config or DEFAULT_DECODER_CONFIG)
    candidates = fastvit_candidates(
        heatmap_logits,
        corner_logits,
        resolution=resolution,
        minimum_confidence=float(config["minimumConfidence"]),
        transform=transform,
    )
    return process_candidates(
        candidates,
        config,
        model_id or {"releaseVersion": 1, "artifactSha256": "0" * 64},
    )


def _sigmoid(values):
    import numpy as np

    array = np.asarray(values, dtype=np.float32)
    return 1.0 / (1.0 + np.exp(-array))


def yolox_pose_candidates(
    raw_outputs,
    *,
    resolution: int,
    strides: tuple[int, ...] = (8, 16, 32),
    minimum_confidence: float = 0.05,
    transform: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Decode flattened MMYOLO YOLOX-Pose feature-level tensors.

    The export order is three levels each of class, bbox, objectness,
    keypoint-offset, and keypoint-visibility tensors. Bboxes are retained in
    the raw export for parity but geometry candidates are formed from the four
    decoded keypoints.
    """
    import numpy as np

    outputs = [np.asarray(value, dtype=np.float32) for value in raw_outputs]
    expected = len(strides) * 5
    if len(outputs) != expected:
        raise ValueError(f"expected {expected} YOLOX-Pose outputs, got {len(outputs)}")
    levels = len(strides)
    class_outputs = outputs[:levels]
    objectness_outputs = outputs[levels * 2 : levels * 3]
    keypoint_outputs = outputs[levels * 3 : levels * 4]
    visibility_outputs = outputs[levels * 4 :]
    rows = []
    for level, stride in enumerate(strides):
        class_logits = class_outputs[level]
        objectness_logits = objectness_outputs[level]
        keypoint_offsets = keypoint_outputs[level]
        visibility_logits = visibility_outputs[level]
        expected_size = resolution // stride
        expected_shapes = {
            "class": (1, 1, expected_size, expected_size),
            "objectness": (1, 1, expected_size, expected_size),
            "keypoint": (1, 8, expected_size, expected_size),
            "visibility": (1, 4, expected_size, expected_size),
        }
        actual_shapes = {
            "class": class_logits.shape,
            "objectness": objectness_logits.shape,
            "keypoint": keypoint_offsets.shape,
            "visibility": visibility_logits.shape,
        }
        for name, shape in expected_shapes.items():
            if actual_shapes[name] != shape:
                raise ValueError(
                    f"unexpected YOLOX-Pose {name} shape at stride {stride}: "
                    f"{actual_shapes[name]} != {shape}"
                )
        scores = np.sqrt(
            _sigmoid(class_logits[0, 0]) * _sigmoid(objectness_logits[0, 0])
        )
        for y, x in np.argwhere(scores >= minimum_confidence):
            confidence = float(scores[y, x])
            offsets = keypoint_offsets[0, :, y, x].reshape(4, 2)
            visibilities = _sigmoid(visibility_logits[0, :, y, x])
            corners = []
            for offset, visibility in zip(offsets, visibilities):
                model_x = (float(x) + float(offset[0])) * stride
                model_y = (float(y) + float(offset[1])) * stride
                point = (
                    model_point_to_source(model_x, model_y, transform)
                    if transform is not None
                    else {"x": model_x / resolution, "y": model_y / resolution}
                )
                corners.append({"point": point, "confidence": float(visibility)})
            rows.append(
                {
                    "corners": corners,
                    "confidence": confidence,
                    "cornerOrderConfidence": None,
                    "side": "unknown",
                    "container": "rawCard",
                }
            )
    rows.sort(key=lambda row: row["confidence"], reverse=True)
    return rows


def decode_yolox_pose(
    *raw_outputs,
    resolution: int = 640,
    transform: dict[str, Any] | None = None,
    decoder_config: dict[str, Any] | None = None,
    model_id: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    config = deepcopy(decoder_config or DEFAULT_DECODER_CONFIG)
    candidates = yolox_pose_candidates(
        raw_outputs,
        resolution=resolution,
        minimum_confidence=float(config["minimumConfidence"]),
        transform=transform,
    )
    return process_candidates(
        candidates,
        config,
        model_id or {"releaseVersion": 1, "artifactSha256": "0" * 64},
    )
