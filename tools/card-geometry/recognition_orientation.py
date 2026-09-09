"""Source-quad rotation search with a margin across competing card families."""
from __future__ import annotations

import math

import numpy as np
from PIL import Image

from crop_parity import warp_reference

POLICY = "four-way-family-margin-v1"
MINIMUM_MARGIN = 0.05


def cyclic_crops(image, quad):
    """Keep clockwise winding; rewarp sideways cards before portrait resizing."""
    points = np.asarray(quad, dtype=float)
    if points.shape != (4, 2) or not np.isfinite(points).all():
        raise ValueError("invalid card quad")
    edges = np.roll(points, -1, axis=0) - points
    following = np.roll(edges, -1, axis=0)
    cross = edges[:, 0] * following[:, 1] - edges[:, 1] * following[:, 0]
    if not np.all(cross > 1e-10):
        raise ValueError("card quad must be convex with clockwise image-coordinate winding")

    def warp(p):
        return Image.fromarray(warp_reference(image, p, mapping="imageEdge",
            kernel="bilinear", inset=0.0, border="black"))

    upright = warp(points.tolist())
    quarter = warp(np.roll(points, -1, axis=0).tolist())
    # Preserve historical 0/180 pixels and ties. Never reverse the winding.
    return [(0, upright), (2, upright.rotate(180)),
            (1, quarter), (3, quarter.rotate(180))]


def choose_family(phases, threshold, minimum_margin=MINIMUM_MARGIN):
    """Each phase supplies its top family, score, and best other-family margin.

    The strongest different family anywhere in the search is the competitor.
    Repeated appearances of the winning family do not compete with themselves.
    """
    if not math.isfinite(threshold) or not math.isfinite(minimum_margin) or minimum_margin < 0:
        raise ValueError("invalid recognition thresholds")
    if not phases:
        return dict(family=None, accepted=False, topScore=None, rivalMargin=None,
                    phase=None, reason="no-valid-crop")
    if any(not p.get("family") or not math.isfinite(p["topScore"])
           or not math.isfinite(p["rivalMargin"]) or p["rivalMargin"] < 0 for p in phases):
        raise ValueError("invalid orientation scores")
    best = max(phases, key=lambda p: p["topScore"])
    rival = max(p["topScore"] - p["rivalMargin"]
                if p["family"] == best["family"] else p["topScore"] for p in phases)
    margin = best["topScore"] - rival
    accepted = best["topScore"] >= threshold and margin >= minimum_margin
    return dict(family=best["family"], accepted=accepted, topScore=best["topScore"],
                rivalMargin=margin, phase=best["phase"],
                reason="accepted" if accepted else "low-score" if best["topScore"] < threshold
                else "competing-family")


def recognize_quad(runtime, image, quad):
    try:
        crops = cyclic_crops(image, quad)
    except ValueError:
        return {**choose_family([], runtime.threshold), "reason": "invalid-quad", "phases": []}
    phases = []
    for phase, crop in crops:
        embedding = runtime.embed(crop)
        if not np.isfinite(embedding).all():
            raise ValueError("nonfinite query embedding")
        scores = runtime.vectors @ embedding
        # Frozen indexes contain zero vectors that normalize to NaN. They were
        # already sorted last by the legacy evaluator; exclude them explicitly.
        valid = np.flatnonzero(np.isfinite(scores))
        order = valid[np.argsort(-scores[valid])]
        if len(order) < 2:
            raise ValueError("recognition requires competing families")
        first = int(order[0])
        rival = next((int(i) for i in order[1:]
                      if runtime.families[int(i)] != runtime.families[first]), None)
        if rival is None:
            raise ValueError("recognition requires competing families")
        phases.append(dict(phase=phase, family=runtime.families[first],
            topScore=float(scores[first]), rivalMargin=float(scores[first]) - float(scores[rival])))
    return {**choose_family(phases, runtime.threshold), "phases": phases}
