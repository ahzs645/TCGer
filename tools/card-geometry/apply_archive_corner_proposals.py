#!/usr/bin/env python3
"""Validate pixel-coordinate bot proposals and save explicitly reviewed targets.

Defaults to a read-only preview. Applying requires both --apply and a file of
approved original annotation indices. Saves use current image hashes and
revision checks, preserve existing labels, and retain machine provenance.
"""
import argparse
import copy
import json
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

from archive_corner_label_server import validate_save


def request(base, path, body=None):
    kwargs = {} if body is None else {"data": json.dumps(body, allow_nan=False).encode(),
                                    "headers": {"Content-Type": "application/json"}, "method": "POST"}
    with urllib.request.urlopen(urllib.request.Request(base.rstrip("/") + path, **kwargs), timeout=30) as response:
        return json.load(response)


def prepare(frame, proposal, approved_indices):
    if frame["recordId"] != proposal["recordId"] or frame["imageSha256"] != proposal["imageSha256"]:
        raise ValueError("Proposal record/image binding mismatch")
    current = frame.get("label") or {}
    if current.get("revision", 0) != proposal["reviewRevision"]:
        raise RuntimeError("Frame was reviewed after this proposal was prepared; preserve the newer review")
    proposed = {t["sourceAnnotationIndex"]: t for t in proposal["targets"]}
    if len(proposed) != len(proposal["targets"]):
        raise ValueError("Duplicate proposal annotation indices")
    if any(type(index) is not int or index < 0 for index in proposed):
        raise ValueError("Original annotation indices must be non-negative integers")
    if set(approved_indices) - set(proposed):
        raise ValueError("Approved index has no proposal")
    targets = copy.deepcopy(current.get("targets", {}))
    directions, added = [], []
    for index in approved_indices:
        key = str(index)
        if key in targets:
            continue
        target = proposed[index]
        if target.get("skip") is not None:
            if target.get("cornersPixels") is not None:
                raise ValueError(f"Annotation {index} cannot be both labeled and skipped")
            targets[key] = {"skip": target["skip"]}
            added.append(index)
            continue
        points = target.get("cornersPixels")
        if points is None or len(points) != 4:
            raise ValueError(f"Annotation {index} has no four-corner proposal")
        corners = [[x / frame["width"], y / frame["height"]] for x, y in points]
        orientation = target.get("orientationKnown", False)
        targets[key] = {"corners": corners, "cornerVisibility": ["visible"] * 4,
                        "orientationKnown": orientation, "cornerSource": "detector", "status": "confirmed"}
        dx = (points[0][0] + points[1][0] - points[2][0] - points[3][0]) / 2
        dy = (points[0][1] + points[1][1] - points[2][1] - points[3][1]) / 2
        directions.append((1 if dx > 0 else 3) if abs(dx) > abs(dy) else (2 if dy > 0 else 0))
        added.append(index)
    if not added:
        return None, []
    direction = current.get("direction", Counter(directions).most_common(1)[0][0] if directions else 0)
    notes = current.get("notes", "")
    notes += ("\n" if notes else "") + proposal.get("reviewNote", "Luna proposed corners from individual card crops; local edge fits were checked before saving machine corners.")
    payload = {"reviewer": "Luna corner tracing + Codex review", "revision": current.get("revision", 0),
               "targets": targets, "notes": notes, "direction": direction}
    validate_save(frame, payload)
    return payload, added


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proposal", type=Path, action="append", required=True)
    parser.add_argument("--approved-targets", type=Path, required=True,
                        help="JSON object mapping exact record IDs to reviewed annotation index lists")
    parser.add_argument("--url", default="http://127.0.0.1:8768")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    approved = json.loads(args.approved_targets.read_text())
    proposals = [p for path in args.proposal for p in json.loads(path.read_text())]
    if len({p["recordId"] for p in proposals}) != len(proposals):
        raise ValueError("Duplicate frame proposals")
    results = []
    for proposal in proposals:
        rid = proposal["recordId"]
        if not approved.get(rid):
            continue
        frame = request(args.url, "/api/frame/" + rid)
        try:
            payload, added = prepare(frame, proposal, approved[rid])
        except RuntimeError as error:
            results.append({"recordId": rid, "status": "preserved-newer-review", "reason": str(error)})
            continue
        if payload is None:
            continue
        if args.apply:
            try:
                saved = request(args.url, "/api/label/" + rid, payload)
            except urllib.error.HTTPError as error:
                if error.code != 409:
                    raise
                results.append({"recordId": rid, "status": "preserved-newer-review", "reason": "Frame changed during the save"})
                continue
            results.append({"recordId": rid, "status": "saved", "approvedAnnotationIndices": added, "saved": saved})
        else:
            results.append({"recordId": rid, "status": "preview", "approvedAnnotationIndices": added, "payload": payload})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps({"frames": len(results), "cards": sum(len(r.get("approvedAnnotationIndices", [])) for r in results),
                      "statuses": dict(Counter(r["status"] for r in results))}))


if __name__ == "__main__":
    main()
