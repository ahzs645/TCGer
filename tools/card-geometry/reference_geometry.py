#!/usr/bin/env python3
"""Model-independent reference geometry used to verify shared fixtures.

This is deliberately small and dependency-free. Production Swift, Kotlin, and
TypeScript implementations consume the same fixtures rather than importing it.
"""

from __future__ import annotations

import math
from typing import Any, Iterable


RESULT_SCHEMA = "https://tcger.app/schemas/card-geometry-result/v1"
EPSILON = 1e-9


def _point(corner: dict[str, Any]) -> tuple[float, float]:
    point = corner["point"]
    return float(point["x"]), float(point["y"])


def _cross(
    origin: tuple[float, float],
    first: tuple[float, float],
    second: tuple[float, float],
) -> float:
    return (first[0] - origin[0]) * (second[1] - origin[1]) - (
        first[1] - origin[1]
    ) * (second[0] - origin[0])


def _signed_area(points: Iterable[tuple[float, float]]) -> float:
    vertices = list(points)
    return 0.5 * sum(
        x1 * y2 - x2 * y1
        for (x1, y1), (x2, y2) in zip(vertices, vertices[1:] + vertices[:1])
    )


def polygon_area(points: Iterable[tuple[float, float]]) -> float:
    return abs(_signed_area(points))


def _is_convex(points: list[tuple[float, float]]) -> bool:
    if len(points) != 4:
        return False
    crosses = [
        _cross(points[index], points[(index + 1) % 4], points[(index + 2) % 4])
        for index in range(4)
    ]
    return all(value > EPSILON for value in crosses) or all(
        value < -EPSILON for value in crosses
    )


def _distance(first: tuple[float, float], second: tuple[float, float]) -> float:
    return math.hypot(second[0] - first[0], second[1] - first[1])


def _aspect_ratio(points: list[tuple[float, float]]) -> float:
    width = (_distance(points[0], points[1]) + _distance(points[3], points[2])) / 2
    height = (_distance(points[1], points[2]) + _distance(points[0], points[3])) / 2
    return height / width if width > EPSILON else math.inf


def _inside(
    point: tuple[float, float],
    edge_start: tuple[float, float],
    edge_end: tuple[float, float],
    orientation: float,
) -> bool:
    cross = _cross(edge_start, edge_end, point)
    return cross >= -EPSILON if orientation >= 0 else cross <= EPSILON


def _intersection(
    segment_start: tuple[float, float],
    segment_end: tuple[float, float],
    edge_start: tuple[float, float],
    edge_end: tuple[float, float],
) -> tuple[float, float]:
    segment_dx = segment_end[0] - segment_start[0]
    segment_dy = segment_end[1] - segment_start[1]
    edge_dx = edge_end[0] - edge_start[0]
    edge_dy = edge_end[1] - edge_start[1]
    denominator = segment_dx * edge_dy - segment_dy * edge_dx
    if abs(denominator) <= EPSILON:
        return segment_end
    offset_x = edge_start[0] - segment_start[0]
    offset_y = edge_start[1] - segment_start[1]
    distance = (offset_x * edge_dy - offset_y * edge_dx) / denominator
    return (
        segment_start[0] + distance * segment_dx,
        segment_start[1] + distance * segment_dy,
    )


def _convex_intersection(
    subject: list[tuple[float, float]], clip: list[tuple[float, float]]
) -> list[tuple[float, float]]:
    output = subject
    orientation = _signed_area(clip)
    for index, edge_start in enumerate(clip):
        edge_end = clip[(index + 1) % len(clip)]
        input_vertices = output
        output = []
        if not input_vertices:
            break
        previous = input_vertices[-1]
        for current in input_vertices:
            current_inside = _inside(current, edge_start, edge_end, orientation)
            previous_inside = _inside(previous, edge_start, edge_end, orientation)
            if current_inside:
                if not previous_inside:
                    output.append(_intersection(previous, current, edge_start, edge_end))
                output.append(current)
            elif previous_inside:
                output.append(_intersection(previous, current, edge_start, edge_end))
            previous = current
    return output


def quad_iou(
    first: list[tuple[float, float]], second: list[tuple[float, float]]
) -> float:
    intersection = polygon_area(_convex_intersection(first, second))
    union = polygon_area(first) + polygon_area(second) - intersection
    return intersection / union if union > EPSILON else 0.0


def _is_valid(candidate: dict[str, Any], config: dict[str, Any]) -> bool:
    try:
        confidence = float(candidate["confidence"])
    except (KeyError, TypeError, ValueError):
        return False
    if (
        not math.isfinite(confidence)
        or not 0 <= confidence <= 1
        or confidence < float(config["minimumConfidence"])
    ):
        return False
    corners = candidate.get("corners", [])
    if len(corners) != 4:
        return False
    try:
        points = [_point(corner) for corner in corners]
        confidences = [float(corner["confidence"]) for corner in corners]
    except (KeyError, TypeError, ValueError):
        return False
    if not all(math.isfinite(value) for point in points for value in point):
        return False
    if not all(math.isfinite(value) and 0 <= value <= 1 for value in confidences):
        return False
    order_confidence = candidate.get("cornerOrderConfidence")
    if order_confidence is not None:
        try:
            order_confidence = float(order_confidence)
        except (TypeError, ValueError):
            return False
        if not math.isfinite(order_confidence) or not 0 <= order_confidence <= 1:
            return False
    if candidate.get("side", "unknown") not in {"faceUp", "faceDown", "unknown"}:
        return False
    if candidate.get("container", "unknown") not in {"rawCard", "slab", "unknown"}:
        return False
    exterior_margin = float(config["exteriorMargin"])
    if any(
        coordinate < -exterior_margin or coordinate > 1 + exterior_margin
        for point in points
        for coordinate in point
    ):
        return False
    if not _is_convex(points) or polygon_area(points) < float(config["minimumQuadArea"]):
        return False
    source_frame = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    if polygon_area(_convex_intersection(points, source_frame)) <= EPSILON:
        return False
    container = candidate.get("container", "unknown")
    band = config["aspectRatioBands"].get(
        container, config["aspectRatioBands"]["unknown"]
    )
    ratio = _aspect_ratio(points)
    return float(band[0]) <= ratio <= float(band[1])


def _clipped_box(points: list[tuple[float, float]]) -> dict[str, float]:
    minimum_x = max(0.0, min(point[0] for point in points))
    minimum_y = max(0.0, min(point[1] for point in points))
    maximum_x = min(1.0, max(point[0] for point in points))
    maximum_y = min(1.0, max(point[1] for point in points))
    return {
        "x": minimum_x,
        "y": minimum_y,
        "width": max(0.0, maximum_x - minimum_x),
        "height": max(0.0, maximum_y - minimum_y),
    }


def _to_result(
    candidate: dict[str, Any], model_identity: dict[str, Any]
) -> dict[str, Any]:
    points = [_point(corner) for corner in candidate["corners"]]
    containment = (
        "inside"
        if all(0 <= coordinate <= 1 for point in points for coordinate in point)
        else "partiallyOutside"
    )
    return {
        "schema": RESULT_SCHEMA,
        "detectionClass": "card",
        "corners": candidate["corners"],
        "confidence": candidate["confidence"],
        "cornerOrderConfidence": candidate.get("cornerOrderConfidence"),
        "containment": containment,
        "side": candidate.get("side", "unknown"),
        "container": candidate.get("container", "unknown"),
        "boundingBox": _clipped_box(points),
        "releaseVersion": model_identity["releaseVersion"],
        "artifactSha256": model_identity["artifactSha256"],
    }


def process_candidates(
    candidates: list[dict[str, Any]],
    config: dict[str, Any],
    model_identity: dict[str, Any],
) -> list[dict[str, Any]]:
    """Validate candidates, apply quad NMS, and return stable canonical results."""
    ranked = sorted(
        (
            (index, candidate)
            for index, candidate in enumerate(candidates)
            if _is_valid(candidate, config)
        ),
        key=lambda item: (-float(item[1]["confidence"]), item[0]),
    )
    kept: list[dict[str, Any]] = []
    kept_points: list[list[tuple[float, float]]] = []
    threshold = float(config["nmsIouThreshold"])
    for _, candidate in ranked:
        points = [_point(corner) for corner in candidate["corners"]]
        if any(quad_iou(points, existing) >= threshold for existing in kept_points):
            continue
        kept.append(_to_result(candidate, model_identity))
        kept_points.append(points)
    return kept


def canonical_round(value: Any, decimals: int) -> Any:
    if isinstance(value, float):
        rounded = round(value, decimals)
        return 0.0 if rounded == 0 else rounded
    if isinstance(value, list):
        return [canonical_round(item, decimals) for item in value]
    if isinstance(value, dict):
        return {key: canonical_round(item, decimals) for key, item in value.items()}
    return value


def forward_source_pixel(
    point: list[float], transform: dict[str, Any]
) -> list[float]:
    margin = transform["contextMarginPixels"]
    letterbox = transform["letterbox"]
    context_x = float(point[0]) + float(margin["left"])
    context_y = float(point[1]) + float(margin["top"])
    return [
        context_x * float(letterbox["scale"]) + float(letterbox["offsetX"]),
        context_y * float(letterbox["scale"]) + float(letterbox["offsetY"]),
    ]


def inverse_model_pixel(
    point: list[float], transform: dict[str, Any]
) -> list[float]:
    margin = transform["contextMarginPixels"]
    letterbox = transform["letterbox"]
    context_x = (float(point[0]) - float(letterbox["offsetX"])) / float(
        letterbox["scale"]
    )
    context_y = (float(point[1]) - float(letterbox["offsetY"])) / float(
        letterbox["scale"]
    )
    return [
        context_x - float(margin["left"]),
        context_y - float(margin["top"]),
    ]
