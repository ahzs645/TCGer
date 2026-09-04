#!/usr/bin/env python3
"""Build the immutable, provenance-aware recognition replay manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from corpus_release import pretty_json, sha256_file


SCHEMA = "https://tcger.app/manifests/card-geometry-recognition-replay/v1"


def record_id(key: str) -> str:
    session = key.split("/", 1)[0]
    suffix = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    return f"devmode-{session}-{suffix}"


def build_manifest(
    *, label_backup: Path, sessions_root: Path, release_root: Path
) -> dict[str, Any]:
    labels = json.loads(label_backup.read_text(encoding="utf-8"))
    release = json.loads((release_root / "manifest.json").read_text(encoding="utf-8"))
    records = {entry["recordId"]: entry for entry in release["records"]}
    sessions: dict[str, dict[str, Any]] = {}
    result_hashes = {}
    rows = []
    for label in sorted(labels, key=lambda row: str(row.get("key", ""))):
        if label.get("fixed_quad_source") != "manual":
            continue
        key = label.get("key")
        if not isinstance(key, str) or "/" not in key:
            continue
        current_record_id = record_id(key)
        if current_record_id not in records:
            continue
        session_id, image_file = key.split("/", 1)
        if session_id not in sessions:
            path = sessions_root / session_id / "results.json"
            document = json.loads(path.read_text(encoding="utf-8"))
            sessions[session_id] = {
                frame["imageFile"]: frame
                for frame in document.get("frames", [])
                if isinstance(frame.get("imageFile"), str)
            }
            result_hashes[session_id] = sha256_file(path)
        frame = sessions[session_id].get(image_file)
        if frame is None:
            raise ValueError(f"session result is missing {key}")
        verdict = label.get("verdict")
        identified = bool(frame.get("identified"))
        accepted_id = frame.get("bestMatchCardId") if identified else None
        if verdict in {"true", "true_margin"} and accepted_id:
            expectation = "identify"
            expected_card_id = str(accepted_id)
            forbidden_card_id = None
        elif verdict in {"false", "false_margin"} and accepted_id:
            expectation = "forbidden-accept"
            expected_card_id = None
            forbidden_card_id = str(accepted_id)
        elif verdict == "no_card":
            expectation = "reject"
            expected_card_id = None
            forbidden_card_id = None
        else:
            expectation = "unknown"
            expected_card_id = None
            forbidden_card_id = None
        rows.append(
            {
                "recordId": current_record_id,
                "sessionFrameKey": key,
                "game": "magic" if frame.get("mode") == "mtg" else frame.get("mode"),
                "expectation": expectation,
                "expectedCardId": expected_card_id,
                "forbiddenCardId": forbidden_card_id,
                "humanVerdict": verdict,
                "archivedIdentified": identified,
                "archivedBestMatchCardId": accepted_id,
            }
        )
    if not rows:
        raise ValueError("recognition replay contains no manual frames")
    return {
        "schema": SCHEMA,
        "releaseId": release["releaseId"],
        "corpusHash": release["corpusHash"],
        "inputs": {
            "labelBackupSha256": sha256_file(label_backup),
            "sessionResultsSha256": dict(sorted(result_hashes.items())),
        },
        "outcomeRules": {
            "identify": "correct only when an accepted family contains expectedCardId",
            "forbidden-accept": "wrong when the forbidden archived card is accepted; a different accept is unknown",
            "reject": "correctReject only when the pipeline abstains",
            "unknown": "reported but excluded from correct/wrong/abstain totals",
        },
        "records": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label-backup", type=Path, required=True)
    parser.add_argument("--sessions-root", type=Path, required=True)
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    document = build_manifest(
        label_backup=args.label_backup,
        sessions_root=args.sessions_root,
        release_root=args.release_root,
    )
    output = args.output or (args.release_root / "recognition-replay.json")
    output.write_text(pretty_json(document), encoding="utf-8")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
