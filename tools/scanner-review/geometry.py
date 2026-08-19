"""Geometry loading, scoring, and preview rendering for the scanner workbench."""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


CARD_WIDTH = 488
CARD_HEIGHT = 680


def load_coco_geometry(replay_dir: Path) -> dict[str, tuple[dict[str, Any], ...]]:
    """Loads the polygons omitted by the derived replay manifest."""
    result: dict[str, tuple[dict[str, Any], ...]] = {}
    for annotation_path in sorted((replay_dir / "datasets").glob("*/*/_annotations.coco.json")):
        document = json.loads(annotation_path.read_text())
        category_names = {
            int(category["id"]): str(category["name"])
            for category in document.get("categories", [])
        }
        by_image: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for raw in document.get("annotations", []):
            bbox = raw.get("bbox")
            if not isinstance(bbox, list) or len(bbox) != 4:
                continue
            segmentation = raw.get("segmentation")
            polygons = []
            if isinstance(segmentation, list):
                polygons = [
                    [float(value) for value in polygon]
                    for polygon in segmentation
                    if isinstance(polygon, list) and len(polygon) >= 6 and len(polygon) % 2 == 0
                ]
            by_image[int(raw["image_id"])].append(
                {
                    "category": category_names.get(int(raw["category_id"]), "card"),
                    "bbox": [float(value) for value in bbox],
                    "area": float(raw.get("area") or bbox[2] * bbox[3]),
                    "segmentation": polygons,
                }
            )

        relative_parent = annotation_path.parent.relative_to(replay_dir)
        for image in document.get("images", []):
            key = (relative_parent / str(image["file_name"])).as_posix()
            result[key] = tuple(by_image.get(int(image["id"]), ()))
    return result


def polygon_points(annotation: dict[str, Any], allow_bbox: bool = False) -> list[list[float]] | None:
    polygons = annotation.get("segmentation") or []
    valid = [polygon for polygon in polygons if isinstance(polygon, list) and len(polygon) >= 6]
    if valid:
        polygon = max(valid, key=len)
        return [[float(polygon[index]), float(polygon[index + 1])] for index in range(0, len(polygon), 2)]
    if not allow_bbox:
        return None
    bbox = annotation.get("bbox")
    if not isinstance(bbox, list) or len(bbox) != 4:
        return None
    left, top, width, height = map(float, bbox)
    return [
        [left, top],
        [left + width, top],
        [left + width, top + height],
        [left, top + height],
    ]


def normalized_points(
    points: Iterable[Iterable[float]], width: int, height: int
) -> list[list[float]]:
    return [
        [
            max(0.0, min(float(x) / width, 1.0)),
            max(0.0, min(float(y) / height, 1.0)),
        ]
        for x, y in points
    ]


def _remove_closed_duplicate(points: np.ndarray) -> np.ndarray:
    if len(points) > 1 and np.linalg.norm(points[0] - points[-1]) < 1e-3:
        return points[:-1]
    return points


def order_quad(points: Iterable[Iterable[float]]) -> np.ndarray:
    """Orders four points as top-left, top-right, bottom-right, bottom-left."""
    array = np.asarray(list(points), dtype=np.float32)
    if array.shape != (4, 2):
        raise ValueError("A quadrilateral must contain exactly four XY points")
    result = np.zeros((4, 2), dtype=np.float32)
    sums = array.sum(axis=1)
    differences = np.diff(array, axis=1).reshape(-1)
    result[0] = array[np.argmin(sums)]
    result[2] = array[np.argmax(sums)]
    result[1] = array[np.argmin(differences)]
    result[3] = array[np.argmax(differences)]
    if len({tuple(point) for point in result.tolist()}) != 4:
        center = array.mean(axis=0)
        angles = np.arctan2(array[:, 1] - center[1], array[:, 0] - center[0])
        circular = array[np.argsort(angles)]
        start = int(np.argmin(circular.sum(axis=1)))
        result = np.roll(circular, -start, axis=0)
    return result


def quad_from_points(points: Iterable[Iterable[float]]) -> np.ndarray | None:
    array = _remove_closed_duplicate(np.asarray(list(points), dtype=np.float32))
    if len(array) < 4:
        return None
    if len(array) == 4:
        return order_quad(array)

    contour = array.reshape((-1, 1, 2))
    perimeter = cv2.arcLength(contour, True)
    for factor in np.linspace(0.005, 0.08, 16):
        approximation = cv2.approxPolyDP(contour, factor * perimeter, True).reshape((-1, 2))
        if len(approximation) == 4:
            return order_quad(approximation)

    rectangle = cv2.boxPoints(cv2.minAreaRect(contour))
    return order_quad(rectangle)


def quad_from_annotation(annotation: dict[str, Any]) -> tuple[np.ndarray | None, str]:
    points = polygon_points(annotation, allow_bbox=False)
    if points:
        return quad_from_points(points), "source_polygon"
    points = polygon_points(annotation, allow_bbox=True)
    return (quad_from_points(points) if points else None), "bbox_fallback"


def perspective_distortion(quad: np.ndarray | None) -> float | None:
    if quad is None:
        return None
    top = np.linalg.norm(quad[1] - quad[0])
    right = np.linalg.norm(quad[2] - quad[1])
    bottom = np.linalg.norm(quad[2] - quad[3])
    left = np.linalg.norm(quad[3] - quad[0])
    if min(top, right, bottom, left) <= 0:
        return None
    return float(max(abs(math.log(top / bottom)), abs(math.log(left / right))))


def corner_error(
    predicted: Iterable[Iterable[float]],
    expected: Iterable[Iterable[float]],
    width: int,
    height: int,
) -> float:
    predicted_quad = order_quad(predicted)
    expected_quad = order_quad(expected)
    diagonal = math.hypot(width, height)
    return float(np.linalg.norm(predicted_quad - expected_quad, axis=1).mean() / diagonal)


def polygon_iou(first: Iterable[Iterable[float]], second: Iterable[Iterable[float]]) -> float:
    first_array = np.asarray(list(first), dtype=np.float32)
    second_array = np.asarray(list(second), dtype=np.float32)
    if len(first_array) < 3 or len(second_array) < 3:
        return 0.0
    first_hull = cv2.convexHull(first_array)
    second_hull = cv2.convexHull(second_array)
    first_area = abs(cv2.contourArea(first_hull))
    second_area = abs(cv2.contourArea(second_hull))
    intersection, _ = cv2.intersectConvexConvex(first_hull, second_hull)
    union = first_area + second_area - intersection
    return float(intersection / union) if union > 0 else 0.0


def warp_card(image: Image.Image, quad: np.ndarray) -> Image.Image:
    source = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)
    destination = np.array(
        [[0, 0], [CARD_WIDTH - 1, 0], [CARD_WIDTH - 1, CARD_HEIGHT - 1], [0, CARD_HEIGHT - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(quad.astype(np.float32), destination)
    result = cv2.warpPerspective(source, matrix, (CARD_WIDTH, CARD_HEIGHT))
    return Image.fromarray(cv2.cvtColor(result, cv2.COLOR_BGR2RGB))


def _font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def render_rectification_preview(
    image_path: Path,
    annotations: Iterable[dict[str, Any]],
    output_path: Path,
    title: str,
    run_lines: Iterable[str],
) -> tuple[Path, Path | None, str, float | None]:
    """Renders source polygon/corners next to the oracle rectification."""
    annotations = tuple(annotations)
    largest = max(annotations, key=lambda item: float(item.get("area") or 0), default=None)
    image = Image.open(image_path).convert("RGB")
    quad, source = quad_from_annotation(largest) if largest else (None, "unavailable")
    distortion = perspective_distortion(quad)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    rectified_path = output_path.with_name(output_path.stem + "-rectified.jpg") if quad is not None else None
    rectified = warp_card(image, quad) if quad is not None else Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT), "#20242b")
    if rectified_path is not None:
        rectified.save(rectified_path, quality=88, optimize=True)

    canvas = Image.new("RGB", (1240, 860), "#11151b")
    left_box = (30, 100, 690, 780)
    shown = ImageOps.contain(image, (left_box[2] - left_box[0], left_box[3] - left_box[1]))
    offset = (left_box[0] + (660 - shown.width) // 2, left_box[1] + (680 - shown.height) // 2)
    canvas.paste(shown, offset)
    draw = ImageDraw.Draw(canvas, "RGBA")
    scale = min(660 / image.width, 680 / image.height)
    if largest:
        raw_polygon = polygon_points(largest, allow_bbox=True)
        if raw_polygon:
            display_polygon = [
                (offset[0] + x * scale, offset[1] + y * scale) for x, y in raw_polygon
            ]
            draw.polygon(display_polygon, fill=(15, 220, 150, 55), outline=(40, 255, 180, 240), width=4)
    if quad is not None:
        colors = ["#ff5c7a", "#ffc857", "#52d3ff", "#b98cff"]
        for index, (x, y) in enumerate(quad):
            px, py = offset[0] + float(x) * scale, offset[1] + float(y) * scale
            draw.ellipse((px - 9, py - 9, px + 9, py + 9), fill=colors[index], outline="white", width=2)
            draw.text((px + 12, py - 12), str(index + 1), fill="white", font=_font(18))

    canvas.paste(ImageOps.contain(rectified, (488, 680)), (720, 100))
    draw = ImageDraw.Draw(canvas)
    draw.text((30, 24), title[:100], fill="white", font=_font(26))
    geometry_text = f"geometry: {source}"
    if distortion is not None:
        geometry_text += f"   perspective distortion: {distortion:.3f}"
    draw.text((30, 62), geometry_text, fill="#9fe8cf", font=_font(18))
    draw.text((720, 62), "rectified reference preview (oracle geometry)", fill="#9fe8cf", font=_font(18))
    summary = "   |   ".join(list(run_lines)[:4])
    draw.text((30, 810), summary[:150], fill="#c9d1d9", font=_font(17))
    canvas.save(output_path, quality=88, optimize=True)
    return output_path, rectified_path, source, distortion
