"""Pure helpers for the FiftyOne ordered-corner geometry editor."""

CORNER_NAMES = ("TL", "TR", "BR", "BL")
CORNER_VISIBILITIES = ("visible", "occluded", "outsideFrame")


def nearest_corner(quads, x, y, max_distance=0.04):
    """Return ``(card_index, corner_index)`` for a nearby visible handle."""
    best = None
    best_distance = float(max_distance) ** 2
    for card_index, quad in enumerate(quads):
        for corner_index, point in enumerate(quad):
            distance = (float(point[0]) - x) ** 2 + (float(point[1]) - y) ** 2
            if distance <= best_distance:
                best = (card_index, corner_index)
                best_distance = distance
    return best


def quad_validation_error(points):
    """Return a short error when an ordered TL/TR/BR/BL quad is unusable."""
    if len(points) != 4:
        return "a card needs exactly four corners"
    try:
        quad = [[float(x), float(y)] for x, y in points]
    except (TypeError, ValueError):
        return "corner coordinates must be numeric"
    if any(not (-0.5 <= value <= 1.5) for point in quad for value in point):
        return "corners must stay within the editor's 50% exterior safety bound"
    crosses = []
    for index in range(4):
        a = quad[index]
        b = quad[(index + 1) % 4]
        c = quad[(index + 2) % 4]
        crosses.append(
            (b[0] - a[0]) * (c[1] - b[1])
            - (b[1] - a[1]) * (c[0] - b[0])
        )
    if min(abs(value) for value in crosses) < 1e-5:
        return "corners are too close to a straight line"
    if not (all(value > 0 for value in crosses) or all(value < 0 for value in crosses)):
        return "corners cross; click TL, TR, BR, BL around the card"
    area = abs(
        sum(
            quad[index][0] * quad[(index + 1) % 4][1]
            - quad[(index + 1) % 4][0] * quad[index][1]
            for index in range(4)
        )
    ) / 2
    if area < 0.0005:
        return "card quad is too small"
    return None


def manual_quads(sample):
    """Read four-point polylines in canonical positive TL/TR/BR/BL winding.

    FiftyOne's canvas serializes a hand-drawn closed polygon in reverse click
    order. The plugin's programmatic writers already use positive winding, so
    reversing only negative-winding polygons makes both paths agree while
    preserving the user's first (TL) click.
    """
    try:
        lines = sample["manual_quad"].polylines
    except Exception:
        return []
    result = []
    for line in lines:
        points = line.points[0] if line.points else []
        if len(points) == 5 and points[0] == points[-1]:
            points = points[:-1]
        if len(points) == 4:
            quad = [[float(x), float(y)] for x, y in points]
            signed_area = sum(
                quad[index][0] * quad[(index + 1) % 4][1]
                - quad[(index + 1) % 4][0] * quad[index][1]
                for index in range(4)
            ) / 2
            if signed_area < 0:
                quad.reverse()
            result.append(quad)
    return result


def default_geometry_metadata(sample_key, quads):
    return [
        {
            "physicalCardId": f"{sample_key}:card-{index}",
            "occlusionOrder": index,
            "orientationKnown": True,
            "side": "faceUp",
            "cornerVisibility": [
                "visible" if 0 <= x <= 1 and 0 <= y <= 1 else "outsideFrame"
                for x, y in quad
            ],
        }
        for index, quad in enumerate(quads)
    ]


def geometry_record(sample_key, game, scene_slice, quads, metadata):
    """Build the durable geometry payload shared by the panel and operator."""
    instances = []
    for index, quad in enumerate(quads):
        item = metadata[index]
        instances.append(
            {
                "instanceId": f"card-{index}",
                "physicalCardId": item["physicalCardId"],
                "corners": [[float(x), float(y)] for x, y in quad],
                "cornerVisibility": list(item["cornerVisibility"]),
                "occlusionOrder": int(item["occlusionOrder"]),
                "orientationKnown": bool(item["orientationKnown"]),
                "side": item["side"],
                "container": "rawCard",
            }
        )
    orders = [item["occlusionOrder"] for item in instances]
    if len(orders) != len(set(orders)):
        raise ValueError("occlusion orders must be unique within a frame")
    normalized_game = str(game or "pokemon").strip().lower()
    normalized_game = {"mtg": "magic", "pokémon": "pokemon"}.get(
        normalized_game, normalized_game
    )
    return {
        "key": sample_key,
        "sceneSlice": scene_slice,
        "game": normalized_game,
        "instances": instances,
    }
