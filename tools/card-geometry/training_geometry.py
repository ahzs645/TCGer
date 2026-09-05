"""Shared, explicit supervision and context policies for geometry trainers."""

from __future__ import annotations

import json
import math
import os
from typing import Any


class MissingInstanceBox(ValueError):
    """A visible card cannot be retained safely without a usable box."""


def context_policy_from_environment() -> dict[str, Any] | None:
    value = os.environ.get("TCGER_GEOMETRY_REAL_CONTEXT_POLICY")
    return None if value is None else json.loads(value)


def validate_context_policy(policy: dict[str, Any]) -> None:
    if (
        not isinstance(policy, dict)
        or set(policy) != {"kind", "fraction", "rounding", "application"}
        or policy["kind"] != "fraction-of-long-side"
        or policy["rounding"] != "ceil"
        or policy["application"] != "each-side"
        or isinstance(policy["fraction"], bool)
        or not isinstance(policy["fraction"], (int, float))
        or not math.isfinite(policy["fraction"])
        or not 0 <= policy["fraction"] <= 1
    ):
        raise ValueError("invalid declared real context margin policy")


def context_margins(record: dict[str, Any], policy: dict[str, Any] | None) -> dict[str, int]:
    if record["source"]["kind"] == "synthetic":
        return {side: int(record["synthetic"]["contextMarginPixels"][side])
                for side in ("left", "top", "right", "bottom")}
    if policy is None:
        raise ValueError("real records require fairness.realContextMarginPolicy")
    validate_context_policy(policy)
    source = record["source"]
    margin = math.ceil(max(source["width"], source["height"]) * policy["fraction"])
    return dict.fromkeys(("left", "top", "right", "bottom"), margin)


def has_corner_supervision(instance: dict[str, Any]) -> bool:
    corners = instance.get("corners") or []
    return len(corners) == 4 and all(corner.get("coordinateKnown") for corner in corners)


def instance_box(instance: dict[str, Any]) -> tuple[float, float, float, float]:
    """Return normalized xyxy, using explicit boxes or a polygon's extent.

    Rejected polygon fits retain their visible mask and unknown corners; the
    mask's bounding box remains detection supervision, never corner truth.
    """
    box = instance.get("box")
    if box is not None:
        values = tuple(float(box[key]) for key in ("left", "top", "right", "bottom"))
    else:
        mask = instance.get("visibleMask") or {}
        points = mask.get("points", []) if mask.get("kind") == "polygon" else []
        if not points:
            raise MissingInstanceBox(instance.get("instanceId", "instance"))
        xs, ys = [float(p["x"]) for p in points], [float(p["y"]) for p in points]
        values = (min(xs), min(ys), max(xs), max(ys))
    left, top, right, bottom = values
    if (not all(math.isfinite(value) for value in values)
            or not 0 <= left < right <= 1 or not 0 <= top < bottom <= 1):
        raise MissingInstanceBox(instance.get("instanceId", "instance"))
    return left, top, right, bottom


def validate_instance_boxes(instances: list[dict[str, Any]]) -> None:
    for instance in instances:
        if not has_corner_supervision(instance):
            instance_box(instance)
