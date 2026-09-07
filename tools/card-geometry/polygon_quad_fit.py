"""Versioned approximate four-corner fit for many-vertex card polygons.

`conservative_mask_quad` (adapter v1) accepts only lossless four-vertex masks.
Real archives also carry whole-card polygons traced with many edge clicks, and
Roboflow exports that stretch photographs to squares, which v1 rejects as
`residual` or `aspect`. This adapter recovers corners from those polygons by
fitting a line to each side and intersecting the lines, then applies explicit
gates measured on the canonical corpus before it was enabled:

* residual: every polygon vertex assigned to a side lies within 1% of the quad
  scale (sqrt of quad area) of its fitted line, ignoring vertices within 4% of
  a corner so rounded or clipped corners do not veto a straight-edged card;
* area ratio: polygon area / quad area in [0.93, 1.02], rejecting occluded or
  non-rectangular outlines that a quad would over-cover;
* solidity: polygon area / convex hull area >= 0.97, rejecting concave bites;
* aspect: opposite-edge ratio in [1.0, 3.0]; the lower bound admits portrait
  cards inside square-stretched exports, which the model also sees stretched;
* convexity of the fitted quad.

Corners produced here keep `cornerSource: maskFit` (never metric-eligible) and
record `cornerFit: polygon-quad-fit-v2` so a release can be audited per adapter.
Self-consistency on 600 v1-accepted quads, densified and jittered by 0.3% of
scale, recovered every corner within 0.9% of scale.
"""

from __future__ import annotations

import math
from typing import Any

import cv2
import numpy as np

ADAPTER_ID = "polygon-quad-fit-v2"
CONSERVATIVE_ADAPTER_ID = "conservative-mask-quad-v1"
GATES: dict[str, Any] = {
    "maxResidual": 0.01,
    "cornerExclusionRadius": 0.04,
    "areaRatio": [0.93, 1.02],
    "minSolidity": 0.97,
    "aspect": [1.0, 3.0],
}
Point = tuple[float, float]


def _signed_area(points: list[Point]) -> float:
    return 0.5 * sum(
        x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1])
    )


def _order_quad(points: list[Point]) -> list[Point]:
    center_x = sum(p[0] for p in points) / 4
    center_y = sum(p[1] for p in points) / 4
    circular = sorted(points, key=lambda p: math.atan2(p[1] - center_y, p[0] - center_x))
    start = min(range(4), key=lambda index: sum(circular[index]))
    ordered = circular[start:] + circular[:start]
    if _signed_area(ordered) < 0:
        ordered = [ordered[0], ordered[3], ordered[2], ordered[1]]
    return ordered


def _convex(points: list[Point]) -> bool:
    signs = []
    for a, b, c in zip(points, points[1:] + points[:1], points[2:] + points[:2]):
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        if abs(cross) <= 1e-9:
            return False
        signs.append(cross > 0)
    return all(signs) or not any(signs)


def _segment_distance(point: Point, start: Point, end: Point) -> float:
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = dx * dx + dy * dy
    t = max(0.0, min(1.0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length)) if length else 0.0
    return math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy))


def _line_distance(point: Point, line: tuple[Point, Point]) -> float:
    (x0, y0), (vx, vy) = line
    return abs((point[0] - x0) * vy - (point[1] - y0) * vx)


def _intersect(first: tuple[Point, Point], second: tuple[Point, Point]) -> Point | None:
    (x1, y1), (a1, b1) = first
    (x2, y2), (a2, b2) = second
    denominator = a1 * b2 - a2 * b1
    if abs(denominator) < 1e-9:
        return None
    t = ((x2 - x1) * b2 - (y2 - y1) * a2) / denominator
    return (x1 + a1 * t, y1 + b1 * t)


def _fit_line(points: list[Point]) -> tuple[Point, Point]:
    matrix = np.asarray(points, dtype=np.float64)
    mean = matrix.mean(axis=0)
    _, _, vt = np.linalg.svd(matrix - mean, full_matrices=False)
    direction = vt[0]
    return (float(mean[0]), float(mean[1])), (float(direction[0]), float(direction[1]))


def fit_polygon_quad(points: list[Point]) -> tuple[list[Point] | None, str, dict[str, float]]:
    """Return (ordered quad, reason, metrics); quad is None unless reason is `accepted`."""
    if len(points) < 4:
        return None, "tooFewVertices", {}
    if any(not (math.isfinite(x) and math.isfinite(y)) for x, y in points):
        return None, "nonFinite", {}
    polygon_area = abs(_signed_area(points))
    if polygon_area <= 0:
        return None, "degenerate", {}
    array = np.asarray(points, dtype=np.float32).reshape(-1, 1, 2)
    hull = cv2.convexHull(array)
    hull_area = abs(float(cv2.contourArea(hull)))
    if hull_area <= 0:
        return None, "degenerate", {}
    solidity = polygon_area / hull_area
    metrics: dict[str, float] = {"solidity": solidity, "vertices": float(len(points))}
    perimeter = float(cv2.arcLength(hull, True))
    seed = None
    for fraction in np.linspace(0.005, 0.15, 30):
        approx = cv2.approxPolyDP(hull, float(fraction) * perimeter, True)
        if len(approx) == 4:
            seed = [(float(p[0][0]), float(p[0][1])) for p in approx]
            break
        if len(approx) < 4:
            break
    if seed is None:
        return None, "noQuadSeed", metrics
    ordered = _order_quad(seed)
    # Two passes: sides are first assigned from the seed quad, then from the
    # fitted quad, so clicks near a rounded or clipped corner cannot pull the
    # line of the neighbouring side once the corner estimate has settled.
    for _ in range(2):
        scale = math.sqrt(abs(_signed_area(ordered)))
        if scale <= 0:
            return None, "degenerate", metrics
        groups: list[list[Point]] = [[] for _ in range(4)]
        for point in points:
            side = min(range(4), key=lambda k: _segment_distance(point, ordered[k], ordered[(k + 1) % 4]))
            groups[side].append(point)
        lines = []
        for side in range(4):
            members = [
                point for point in groups[side]
                if min(math.dist(point, corner) for corner in ordered) >= GATES["cornerExclusionRadius"] * scale
            ]
            if len(members) < 2:
                members = groups[side] if len(groups[side]) >= 2 else [ordered[side], ordered[(side + 1) % 4]]
            lines.append(_fit_line(members))
        corners = []
        for side in range(4):
            corner = _intersect(lines[side - 1], lines[side])
            if corner is None:
                return None, "parallelSides", metrics
            corners.append(corner)
        ordered = _order_quad(corners)
        if not _convex(ordered):
            return None, "convexity", metrics
    quad_area = abs(_signed_area(ordered))
    if quad_area <= 0:
        return None, "degenerate", metrics
    scale = math.sqrt(quad_area)
    residual = 0.0
    for side in range(4):
        for point in groups[side]:
            if min(math.dist(point, corner) for corner in ordered) < GATES["cornerExclusionRadius"] * scale:
                continue
            residual = max(residual, _line_distance(point, lines[side]) / scale)
    lengths = [math.dist(a, b) for a, b in zip(ordered, ordered[1:] + ordered[:1])]
    width = (lengths[0] + lengths[2]) / 2
    height = (lengths[1] + lengths[3]) / 2
    if min(width, height) <= 0:
        return None, "degenerate", metrics
    aspect = max(width, height) / min(width, height)
    metrics.update({"residual": residual, "areaRatio": polygon_area / quad_area, "aspect": aspect})
    if residual > GATES["maxResidual"]:
        return None, "residual", metrics
    low, high = GATES["areaRatio"]
    if not low <= metrics["areaRatio"] <= high:
        return None, "areaRatio", metrics
    if solidity < GATES["minSolidity"]:
        return None, "solidity", metrics
    low, high = GATES["aspect"]
    if not low <= aspect <= high:
        return None, "aspect", metrics
    return ordered, "accepted", metrics
