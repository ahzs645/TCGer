"""Explicit, partial card layer ordering; geometry overlap is not a prerequisite."""


def ordered_indices(indices, relations):
    """Return a stable back-to-front order, rejecting contradictory relations."""
    indices = list(indices)
    outgoing = {i: [] for i in indices}
    incoming = {i: 0 for i in indices}
    for relation in relations:
        below, above = relation["below"], relation["above"]
        outgoing[below].append(above)
        incoming[above] += 1
    result = []
    while len(result) < len(indices):
        ready = next((i for i in indices if incoming[i] == 0), None)
        if ready is None:
            raise ValueError("Card layers form a cycle. Remove a conflicting Above/Below relationship.")
        result.append(ready)
        incoming[ready] = -1
        for above in outgoing[ready]:
            incoming[above] -= 1
    return result


def validate_relations(relations, indices):
    """Validate annotation-index references without inventing unspecified order."""
    indices = list(indices)
    available = set(indices)
    if not isinstance(relations, list):
        raise ValueError("Card layers must be a list of Above/Below relationships")
    seen = set()
    out = []
    for relation in relations:
        if (not isinstance(relation, dict) or set(relation) != {"above", "below"}
                or any(type(relation[k]) is not int for k in ("above", "below"))):
            raise ValueError("Each card layer needs integer above and below annotation indices")
        above, below = relation["above"], relation["below"]
        if above not in available or below not in available:
            raise ValueError("Card layers must reference cards with outlines; restore skipped cards first")
        if above == below:
            raise ValueError("A card cannot be above itself")
        if (above, below) in seen:
            raise ValueError("Duplicate card layer relationship")
        seen.add((above, below))
        out.append({"above": above, "below": below})
    ordered_indices(indices, out)
    return out
