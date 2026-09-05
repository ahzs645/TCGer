"""Shared helpers for card-geometry corpus releases.

A release is a directory holding `manifest.json`, the readiness policy it
binds to, its record JSON files, and its images. The manifest is validated by
`docs/scanner-system/schemas/card-geometry-release-manifest.v1.schema.json`,
the policy by `card-geometry-readiness-policy.v1.schema.json`, and each record
by `card-geometry-corpus-record.v1.schema.json`.

Everything here is deterministic and free of network access so the same code
runs locally, in unit tests, and inside a Hugging Face CPU Job.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
REPOSITORY = ROOT.parents[1]
SCHEMAS_DIR = REPOSITORY / "docs" / "scanner-system" / "schemas"
FIXTURES_DIR = ROOT / "fixtures"
RELEASES_DIR = FIXTURES_DIR / "releases"

MANIFEST_SCHEMA_FILE = "card-geometry-release-manifest.v1.schema.json"
POLICY_SCHEMA_FILE = "card-geometry-readiness-policy.v1.schema.json"
RECORD_SCHEMA_FILE = "card-geometry-corpus-record.v1.schema.json"

MANIFEST_SCHEMA_ID = "https://tcger.app/schemas/card-geometry-release-manifest/v2"
POLICY_SCHEMA_ID = "https://tcger.app/schemas/card-geometry-readiness-policy/v1"
RECORD_SCHEMA_ID = "https://tcger.app/schemas/card-geometry-corpus-record/v1"
REPORT_SCHEMA_ID = "https://tcger.app/schemas/card-geometry-preflight-report/v1"

MANIFEST_FILENAME = "manifest.json"
SPLITS = ("train", "validation", "test")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def canonical_json(value: Any) -> bytes:
    """Canonical serialization used for content hashes: sorted keys, no whitespace."""
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def pretty_json(value: Any) -> str:
    """Deterministic human-readable serialization for files checked into git."""
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def corpus_hash(manifest: dict[str, Any]) -> str:
    """Hash of the manifest with its own `corpusHash` member removed.

    Every record hash and image hash is a member of the manifest, so this one
    value identifies the complete corpus content without being circular.
    """
    stripped = {key: value for key, value in manifest.items() if key != "corpusHash"}
    return sha256_bytes(canonical_json(stripped))


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(pretty_json(value), encoding="utf-8")


def load_schema(filename: str) -> dict[str, Any]:
    return load_json(SCHEMAS_DIR / filename)


def make_validator(schema: dict[str, Any]):
    """Return a Draft 2020-12 validator after checking the schema itself."""
    from jsonschema import Draft202012Validator

    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def validation_errors(validator, instance: Any, limit: int = 20) -> list[str]:
    """Stable, human-readable list of schema violations for an instance."""
    errors = sorted(
        validator.iter_errors(instance),
        key=lambda error: (list(map(str, error.absolute_path)), error.message),
    )
    rendered = []
    for error in errors[:limit]:
        location = "/".join(map(str, error.absolute_path)) or "<root>"
        rendered.append(f"{location}: {error.message}")
    if len(errors) > limit:
        rendered.append(f"... {len(errors) - limit} more")
    return rendered


def png_dimensions(data: bytes) -> tuple[int, int] | None:
    """Width and height from a PNG IHDR chunk, or None for non-PNG bytes."""
    if len(data) < 24 or not data.startswith(PNG_SIGNATURE) or data[12:16] != b"IHDR":
        return None
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def instance_leakage_ids(record: dict[str, Any], key: str) -> list[str]:
    """Sorted unique values of an instance-level leakage key in a record."""
    values = {
        instance[key]
        for instance in record.get("instances", [])
        if isinstance(instance, dict) and key in instance
    }
    return sorted(values)


def leakage_keys_from_record(
    record: dict[str, Any], source_archive_aliases: dict[str, str] | None = None
) -> dict[str, Any]:
    """Derive leakage keys, resolving archives through a release's flat alias table.

    Canonical IDs must map to themselves. Missing IDs and chained mappings are
    errors, never independent archives by default. None is for assembling raw
    entries only; release preflight always supplies the manifest's alias table.
    """
    grouping = record.get("grouping", {})
    archive_id = grouping.get("sourceArchiveId")
    if source_archive_aliases is not None:
        if not isinstance(archive_id, str) or archive_id not in source_archive_aliases:
            raise ValueError(f"unmapped sourceArchiveId: {archive_id!r}")
        canonical_id = source_archive_aliases[archive_id]
        if source_archive_aliases.get(canonical_id) != canonical_id:
            raise ValueError(
                f"sourceArchiveId {archive_id!r} must map directly to a self-mapped canonical id: {canonical_id!r}"
            )
        archive_id = canonical_id
    source_asset_ids = set(instance_leakage_ids(record, "sourceAssetId"))
    synthetic = record.get("synthetic", {})
    if isinstance(synthetic, dict):
        background = synthetic.get("backgroundAssetId")
        if isinstance(background, str):
            source_asset_ids.add(background)
        distractors = synthetic.get("distractorSourceAssetIds", [])
        if isinstance(distractors, list):
            source_asset_ids.update(
                value for value in distractors if isinstance(value, str)
            )
    keys: dict[str, Any] = {
        "sourceKind": record.get("source", {}).get("kind"),
        "sourceArchiveId": archive_id,
        "physicalCardIds": instance_leakage_ids(record, "physicalCardId"),
        "sourceAssetIds": sorted(source_asset_ids),
    }
    if "sessionId" in grouping:
        keys["sessionId"] = grouping["sessionId"]
    return keys
