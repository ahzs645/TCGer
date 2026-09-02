"""Deterministically regenerate the fixture corpus releases.

The committed releases under `fixtures/releases/` are the executable evidence
for the preflight: one valid `fixture`-purpose release that is training-shaped
(all three splits, real and synthetic records, a denylisted evaluation session,
an out-of-frame amodal corner), several single-defect invalid releases that each
trip exactly one preflight check, and an empty `training`-purpose release that
must never become ready.

Run from the repository root to rebuild them in place:

    python3 tools/card-geometry/build_fixture_releases.py

`test_preflight.py` regenerates the releases into a temporary directory and
requires them to match the committed bytes, so a hand edit to a fixture fails
the suite until this generator is updated to produce it.
"""

from __future__ import annotations

import argparse
import copy
import struct
import sys
import zlib
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus_release import (  # noqa: E402
    MANIFEST_FILENAME,
    MANIFEST_SCHEMA_ID,
    POLICY_SCHEMA_ID,
    RECORD_SCHEMA_ID,
    RELEASES_DIR,
    corpus_hash,
    leakage_keys_from_record,
    pretty_json,
    sha256_bytes,
)

IMAGE_SIZE = 8
DENYLISTED_SESSION = "scan-session-20260829-200235"
VALIDATION_SESSION = "scan-session-20260901-100000"
SPARE_SESSION = "scan-session-20260901-120000"

FIXTURE_POLICY: dict[str, Any] = {
    "schema": POLICY_SCHEMA_ID,
    "policyId": "fixture-minimums-v1",
    "description": (
        "Minimums small enough for the checked-in fixture releases. A release "
        "bound to this policy can validate tooling but its purpose keeps it "
        "from ever being ready for training."
    ),
    "requiredSplits": ["train", "validation", "test"],
    "minimumRecordsPerSplit": {"train": 1, "validation": 1, "test": 1},
    "minimumInstancesPerSplit": {"train": 1, "validation": 1, "test": 1},
    "minimumRealEvaluationSessions": 1,
    "realOnlySplits": ["test"],
    "requiredSceneSlices": [
        {"sceneSlice": "single_handheld", "split": "test", "minimumInstances": 1}
    ],
    "requiredLeakageKeys": {
        "real": ["sessionId", "physicalCardIds"],
        "synthetic": ["sourceAssetIds"],
    },
}

TRAINING_POLICY: dict[str, Any] = {
    "schema": POLICY_SCHEMA_ID,
    "policyId": "training-minimums-draft-v1",
    "description": (
        "Draft production minimums. Values are placeholders until the first "
        "real geometry corpus release sets them from measured counts."
    ),
    "requiredSplits": ["train", "validation", "test"],
    "minimumRecordsPerSplit": {"train": 500, "validation": 50, "test": 100},
    "minimumInstancesPerSplit": {"train": 1000, "validation": 100, "test": 150},
    "minimumRealEvaluationSessions": 3,
    "realOnlySplits": ["test"],
    "requiredSceneSlices": [
        {"sceneSlice": "single_handheld", "split": "test", "minimumInstances": 50},
        {"sceneSlice": "steep_playmat", "split": "test", "minimumInstances": 20},
        {"sceneSlice": "duel_field", "split": "test", "minimumInstances": 30},
        {"sceneSlice": "binder_page", "split": "test", "minimumInstances": 20},
    ],
    "requiredLeakageKeys": {
        "real": ["sessionId", "physicalCardIds"],
        "synthetic": ["sourceAssetIds"],
    },
}


def tiny_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """Encode a solid-colour RGB PNG without any imaging dependency."""

    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        return (
            struct.pack(">I", len(payload))
            + body
            + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
        )

    row = b"\x00" + bytes(rgb) * width
    raw = row * height
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def corner(x: float, y: float, visibility: str = "visible") -> dict[str, Any]:
    return {
        "point": {"x": x, "y": y},
        "visibility": visibility,
        "coordinateKnown": True,
    }


def unknown_corner(visibility: str = "occluded") -> dict[str, Any]:
    return {"visibility": visibility, "coordinateKnown": False}


def base_release() -> dict[str, Any]:
    """The valid, training-shaped fixture release as an in-memory model."""
    train_record = {
        "schema": RECORD_SCHEMA_ID,
        "recordId": "fx-train-synthetic-001",
        "source": {"kind": "synthetic", "width": IMAGE_SIZE, "height": IMAGE_SIZE},
        "grouping": {"sourceArchiveId": "fixture-compositor"},
        "instances": [
            {
                "instanceId": "card-0",
                "detectionClass": "card",
                "corners": [
                    corner(0.10, 0.15),
                    corner(0.55, 0.12),
                    corner(0.58, 0.80),
                    corner(0.12, 0.83),
                ],
                "orientationKnown": True,
                "side": "faceUp",
                "container": "rawCard",
                "occlusionOrder": 0,
                "sourceAssetId": "asset-0001",
            },
            {
                "instanceId": "card-1",
                "detectionClass": "card",
                "corners": [
                    corner(-0.06, 0.30, "outsideFrame"),
                    corner(0.35, 0.28, "occluded"),
                    corner(0.38, 0.95),
                    corner(-0.03, 0.97, "outsideFrame"),
                ],
                "orientationKnown": True,
                "side": "faceDown",
                "container": "rawCard",
                "occlusionOrder": 1,
                "sourceAssetId": "asset-0002",
            },
        ],
        "synthetic": {
            "sceneSeed": 7,
            "transformationSeed": 11,
            "contextMarginPixels": {"left": 1, "top": 1, "right": 1, "bottom": 1},
            "compositorRevision": "fixture0",
        },
    }
    validation_record = {
        "schema": RECORD_SCHEMA_ID,
        "recordId": "fx-validation-real-001",
        "source": {"kind": "real", "width": IMAGE_SIZE, "height": IMAGE_SIZE},
        "grouping": {
            "sourceArchiveId": "fixture-devmode-validation",
            "sessionId": VALIDATION_SESSION,
        },
        "instances": [
            {
                "instanceId": "card-0",
                "detectionClass": "card",
                "corners": [
                    corner(0.20, 0.10),
                    corner(0.80, 0.12),
                    unknown_corner("occluded"),
                    corner(0.18, 0.90),
                ],
                "orientationKnown": True,
                "side": "faceUp",
                "container": "rawCard",
                "occlusionOrder": 0,
                "physicalCardId": "physical-card-100",
            }
        ],
    }
    test_record = {
        "schema": RECORD_SCHEMA_ID,
        "recordId": "fx-test-real-001",
        "source": {"kind": "real", "width": IMAGE_SIZE, "height": IMAGE_SIZE},
        "grouping": {
            "sourceArchiveId": "fixture-devmode-test",
            "sessionId": DENYLISTED_SESSION,
        },
        "instances": [
            {
                "instanceId": "card-0",
                "detectionClass": "card",
                "corners": [
                    corner(0.25, 0.05),
                    corner(0.75, 0.05),
                    corner(0.75, 0.95),
                    corner(0.25, 0.95),
                ],
                "orientationKnown": False,
                "side": "faceUp",
                "container": "unknown",
                "occlusionOrder": 0,
                "physicalCardId": "physical-card-200",
            }
        ],
    }
    return {
        "releaseId": "fixture-release-v1",
        "releasePurpose": "fixture",
        "policy": copy.deepcopy(FIXTURE_POLICY),
        "splitAssignment": {"method": "fixture-hand-assigned", "seed": 0},
        "evaluationSessionDenylist": [DENYLISTED_SESSION],
        "records": [
            {
                "record": train_record,
                "split": "train",
                "sceneSlice": "duel_field",
                "rgb": (200, 40, 40),
            },
            {
                "record": validation_record,
                "split": "validation",
                "sceneSlice": "single_handheld",
                "rgb": (40, 200, 40),
            },
            {
                "record": test_record,
                "split": "test",
                "sceneSlice": "single_handheld",
                "rgb": (40, 40, 200),
            },
        ],
    }


def materialize(
    root: Path,
    release: dict[str, Any],
    *,
    corpus_hash_override: str | None = None,
    image_bytes_override: dict[str, bytes] | None = None,
) -> dict[str, Any]:
    """Write a release directory and return its manifest.

    Hashes are always computed from the intended bytes. `image_bytes_override`
    writes different bytes for a record's image while keeping the intended
    hash in the manifest and record, which is how the image-hash defect fixture
    is produced.
    """
    root.mkdir(parents=True, exist_ok=True)
    policy_text = pretty_json(release["policy"])
    (root / "policy.json").write_text(policy_text, encoding="utf-8")

    entries = []
    for item in release["records"]:
        record = copy.deepcopy(item["record"])
        record_id = record["recordId"]
        image_rel = f"images/{record_id}.png"
        record_rel = f"records/{record_id}.json"
        intended_image = tiny_png(IMAGE_SIZE, IMAGE_SIZE, item["rgb"])
        written_image = (image_bytes_override or {}).get(record_id, intended_image)
        (root / image_rel).parent.mkdir(parents=True, exist_ok=True)
        (root / image_rel).write_bytes(written_image)

        record["source"]["path"] = image_rel
        record["source"]["sha256"] = sha256_bytes(intended_image)
        record_text = pretty_json(record)
        (root / record_rel).parent.mkdir(parents=True, exist_ok=True)
        (root / record_rel).write_text(record_text, encoding="utf-8")

        entries.append(
            {
                "recordId": record_id,
                "path": record_rel,
                "sha256": sha256_bytes(record_text.encode("utf-8")),
                "split": item["split"],
                "sceneSlice": item["sceneSlice"],
                "leakageKeys": leakage_keys_from_record(record),
                "images": [{"path": image_rel, "sha256": sha256_bytes(intended_image)}],
            }
        )

    manifest: dict[str, Any] = {
        "schema": MANIFEST_SCHEMA_ID,
        "releaseId": release["releaseId"],
        "releasePurpose": release["releasePurpose"],
        "readiness": {
            "readinessPolicyPath": "policy.json",
            "readinessPolicyId": release["policy"]["policyId"],
            "readinessPolicySha256": sha256_bytes(policy_text.encode("utf-8")),
        },
        "splitAssignment": release["splitAssignment"],
        "evaluationSessionDenylist": release["evaluationSessionDenylist"],
        "records": entries,
    }
    manifest["corpusHash"] = corpus_hash_override or corpus_hash(manifest)
    (root / MANIFEST_FILENAME).write_text(pretty_json(manifest), encoding="utf-8")
    return manifest


def _record(release: dict[str, Any], record_id: str) -> dict[str, Any]:
    for item in release["records"]:
        if item["record"]["recordId"] == record_id:
            return item["record"]
    raise KeyError(record_id)


def build_valid_fixture(root: Path) -> None:
    materialize(root, base_release())


def build_invalid_leakage(root: Path) -> None:
    release = base_release()
    _record(release, "fx-test-real-001")["instances"][0]["physicalCardId"] = (
        "physical-card-100"
    )
    materialize(root, release)


def build_invalid_source_archive_leakage(root: Path) -> None:
    release = base_release()
    _record(release, "fx-test-real-001")["grouping"]["sourceArchiveId"] = (
        "fixture-devmode-validation"
    )
    materialize(root, release)


def build_invalid_image_hash(root: Path) -> None:
    release = base_release()
    wrong = tiny_png(IMAGE_SIZE, IMAGE_SIZE, (0, 0, 0))
    materialize(root, release, image_bytes_override={"fx-validation-real-001": wrong})


def build_invalid_corpus_hash(root: Path) -> None:
    materialize(
        root, base_release(), corpus_hash_override=sha256_bytes(b"not the corpus")
    )


def build_invalid_denylist(root: Path) -> None:
    release = base_release()
    _record(release, "fx-validation-real-001")["grouping"]["sessionId"] = (
        DENYLISTED_SESSION
    )
    _record(release, "fx-test-real-001")["grouping"]["sessionId"] = SPARE_SESSION
    materialize(root, release)


def build_invalid_record_schema(root: Path) -> None:
    release = base_release()
    synthetic = _record(release, "fx-train-synthetic-001")
    synthetic["instances"][1]["corners"][0] = unknown_corner("occluded")
    materialize(root, release)


def build_empty_training(root: Path) -> None:
    release = base_release()
    release["releaseId"] = "empty-training-release"
    release["releasePurpose"] = "training"
    release["policy"] = copy.deepcopy(TRAINING_POLICY)
    release["records"] = []
    materialize(root, release)


BUILDERS = {
    "valid-fixture": build_valid_fixture,
    "invalid-leakage": build_invalid_leakage,
    "invalid-source-archive-leakage": build_invalid_source_archive_leakage,
    "invalid-image-hash": build_invalid_image_hash,
    "invalid-corpus-hash": build_invalid_corpus_hash,
    "invalid-denylist": build_invalid_denylist,
    "invalid-record-schema": build_invalid_record_schema,
    "empty-training": build_empty_training,
}

# The exact set of preflight check codes each release must fail. A release that
# fails anything else, or fails to fail these, breaks the suite.
EXPECTED_FAILED_CHECKS: dict[str, frozenset[str]] = {
    "valid-fixture": frozenset(),
    "invalid-leakage": frozenset({"LEAKAGE_DISJOINT"}),
    "invalid-source-archive-leakage": frozenset({"LEAKAGE_DISJOINT"}),
    "invalid-image-hash": frozenset({"IMAGE_HASH"}),
    "invalid-corpus-hash": frozenset({"CORPUS_HASH"}),
    "invalid-denylist": frozenset({"EVAL_DENYLIST"}),
    "invalid-record-schema": frozenset({"RECORD_SCHEMA"}),
    "empty-training": frozenset({"READINESS_MINIMUMS"}),
}

EXPECTED_READY_FOR: dict[str, str] = {
    "valid-fixture": "tooling",
    "invalid-leakage": "none",
    "invalid-source-archive-leakage": "none",
    "invalid-image-hash": "none",
    "invalid-corpus-hash": "none",
    "invalid-denylist": "none",
    "invalid-record-schema": "none",
    "empty-training": "none",
}


def build_all(output: Path) -> None:
    for name, builder in BUILDERS.items():
        target = output / name
        if target.exists():
            for path in sorted(target.rglob("*"), reverse=True):
                if path.is_file():
                    path.unlink()
                else:
                    path.rmdir()
        builder(target)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--output", type=Path, default=RELEASES_DIR)
    args = parser.parse_args()
    build_all(args.output)
    for name in BUILDERS:
        print(f"built {args.output / name}")


if __name__ == "__main__":
    main()
