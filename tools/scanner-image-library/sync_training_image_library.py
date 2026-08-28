#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10,<3.14"
# dependencies = [
#   "Pillow>=10.0",
# ]
# ///
"""Build and audit a durable, content-addressed scanner image library.

The release format deliberately contains deterministic tar shards instead of
one Hub/Git object per image. A separate local blob cache makes incremental
catalog syncs cheap without making the dataset repository itself unwieldy.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator

from PIL import Image, UnidentifiedImageError


SCHEMA_VERSION = 1
ALLOWED_FORMATS = {
    "JPEG": ("image/jpeg", "jpg"),
    "PNG": ("image/png", "png"),
    "WEBP": ("image/webp", "webp"),
}
REQUEST_HEADERS = {
    "User-Agent": "TCGer scanner image-library sync/1.0",
    "Accept": "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5",
}


class LibraryError(RuntimeError):
    """An operator-actionable image-library error."""


@dataclass(frozen=True)
class ValidatedBlob:
    data: bytes
    sha256: str
    byte_count: int
    mime_type: str
    extension: str
    width: int
    height: int


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest_text(*parts: str) -> str:
    value = "\0".join(parts).encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_records(path: Path) -> Iterator[dict]:
    with path.open(encoding="utf-8") as source:
        first = source.read(1)
        source.seek(0)
        if first == "[":
            payload = json.load(source)
            if not isinstance(payload, list):
                raise LibraryError(f"expected an array in {path}")
            yield from payload
            return
        for line_number, line in enumerate(source, 1):
            if line.strip():
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise LibraryError(f"expected an object at {path}:{line_number}")
                yield value


def normalized_locator(row: dict, catalog_path: Path) -> tuple[str, str, str]:
    image_path = row.get("imagePath") or row.get("image_path")
    if image_path:
        source_path = Path(str(image_path))
        candidate = source_path
        if not candidate.is_absolute():
            candidate = (catalog_path.parent / candidate).resolve()
        # Keep the catalog-authored relative path in IDs/manifests. The resolved
        # machine path is only an implementation detail used to open the file.
        stable_path = source_path.as_posix()
        return "file", str(candidate), stable_path
    url = row.get("imageURL") or row.get("imageUrl") or row.get("image_url")
    return ("url", str(url).strip(), str(url).strip()) if url else ("missing", "", "")


def explicit_identity(row: dict) -> str | None:
    for key in ("visualIdentityId", "visual_identity_id", "artworkId", "artwork_id"):
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def magic_face_discriminator(locator: str) -> str:
    path = urllib.parse.urlparse(locator).path.casefold()
    match = re.search(r"/(front|back)/", path)
    return match.group(1) if match else ""


def identity_for(row: dict, locator: str) -> tuple[str, str]:
    game = str(row.get("game") or "").strip().casefold()
    card_id = str(row.get("cardId") or row.get("card_id") or "").strip()
    if not game or not card_id:
        raise LibraryError("every row requires non-empty game and cardId")
    discriminator = explicit_identity(row) or ""
    if not discriminator and game in {"magic", "mtg"}:
        discriminator = magic_face_discriminator(locator)
    key = f"{game}:{card_id}" + (f":{discriminator}" if discriminator else "")
    return key, "vi_" + digest_text(key)[:32]


def recognition_family_for(row: dict, visual_identity_id: str) -> str:
    """Return the visual class/split group without collapsing catalog printings."""
    for key in (
        "recognitionFamilyId",
        "recognition_family_id",
        "illustrationId",
        "illustration_id",
        "artworkId",
        "artwork_id",
    ):
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return visual_identity_id


def is_pokemon_pocket(row: dict) -> bool:
    if str(row.get("game") or "").strip().casefold() not in {"pokemon", "pokémon"}:
        return False
    series = row.get("series")
    if isinstance(series, dict):
        series_values = (series.get("id"), series.get("name"))
    else:
        series_values = (series,)
    fields = (row.get("format"), row.get("gameFormat"), *series_values)
    if any(str(value or "").strip().casefold() in {"pocket", "tcgp"} for value in fields):
        return True
    return "/tcgp/" in str(row.get("imageURL") or "").casefold()


def sample_id_for(visual_identity_id: str, source_kind: str, locator: str) -> str:
    # Strip URL fragments and queries: CDN signing/cache-busting must not create
    # a new training sample. The content hash still reports changed bytes.
    if urllib.parse.urlparse(locator).scheme in {"http", "https"}:
        parsed = urllib.parse.urlsplit(locator)
        locator = urllib.parse.urlunsplit((parsed.scheme.casefold(), parsed.netloc.casefold(), parsed.path, "", ""))
    return "sample_" + digest_text(visual_identity_id, source_kind, locator)[:32]


def split_for(recognition_family_id: str) -> str:
    bucket = int(hashlib.sha256(recognition_family_id.encode()).hexdigest()[:8], 16) % 100
    if bucket < 90:
        return "train"
    if bucket < 95:
        return "validation"
    return "test"


def validate_image(data: bytes) -> ValidatedBlob:
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            image_format = (image.format or "").upper()
            width, height = image.size
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise LibraryError(f"image decode failed: {error}") from error
    if image_format not in ALLOWED_FORMATS:
        raise LibraryError(f"unsupported decoded image type: {image_format or 'unknown'}")
    if width < 32 or height < 32:
        raise LibraryError(f"image dimensions are too small: {width}x{height}")
    mime_type, extension = ALLOWED_FORMATS[image_format]
    return ValidatedBlob(
        data=data,
        sha256=sha256_bytes(data),
        byte_count=len(data),
        mime_type=mime_type,
        extension=extension,
        width=width,
        height=height,
    )


def cache_path(cache_root: Path, sha256: str, extension: str) -> Path:
    return cache_root / sha256[:2] / f"{sha256}.{extension}"


def read_cached(cache_root: Path, previous: dict) -> bytes | None:
    sha = previous.get("blobSha256") or previous.get("sha256")
    extension = previous.get("extension")
    if not sha or not extension:
        return None
    path = cache_path(cache_root, sha, extension)
    if path.is_file():
        return path.read_bytes()
    return None


def read_previous_shard(previous_root: Path, previous: dict) -> bytes | None:
    shard = previous.get("shard")
    member = previous.get("member")
    if not shard or not member:
        return None
    shard_path = previous_root / shard
    if not shard_path.is_file():
        return None
    try:
        with tarfile.open(shard_path, "r") as archive:
            extracted = archive.extractfile(member)
            return extracted.read() if extracted else None
    except (KeyError, tarfile.TarError, OSError):
        return None


def store_cache(cache_root: Path, blob: ValidatedBlob) -> None:
    destination = cache_path(cache_root, blob.sha256, blob.extension)
    if destination.is_file():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{blob.sha256}.", dir=destination.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(blob.data)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def fetch(locator_kind: str, locator: str, timeout: float, max_bytes: int) -> bytes:
    if locator_kind == "file":
        path = Path(locator)
        if path.stat().st_size > max_bytes:
            raise LibraryError(f"image exceeds --max-bytes ({max_bytes})")
        return path.read_bytes()
    if locator_kind == "url":
        parsed = urllib.parse.urlparse(locator)
        if parsed.scheme not in {"http", "https"}:
            raise LibraryError(f"unsupported image URL scheme: {parsed.scheme or 'none'}")
        request = urllib.request.Request(locator, headers=REQUEST_HEADERS)
        with urllib.request.urlopen(request, timeout=timeout) as response:
            declared = response.headers.get("Content-Length")
            if declared and int(declared) > max_bytes:
                raise LibraryError(f"image exceeds --max-bytes ({max_bytes})")
            output = io.BytesIO()
            while chunk := response.read(min(1024 * 1024, max_bytes + 1)):
                output.write(chunk)
                if output.tell() > max_bytes:
                    raise LibraryError(f"image exceeds --max-bytes ({max_bytes})")
            return output.getvalue()
    raise LibraryError("row has no imageURL or imagePath")


def load_manifest(path: Path | None) -> dict[str, dict]:
    if path is None:
        return {}
    rows = {}
    for row in load_records(path):
        sample_id = row.get("sampleId")
        if sample_id:
            rows[str(sample_id)] = row
    return rows


def provenance_for(row: dict, catalog: Path, catalog_sha: str, revision: str | None, source_kind: str) -> dict:
    supplied = row.get("provenance") if isinstance(row.get("provenance"), dict) else {}
    return {
        "sourceKind": source_kind,
        "sourceCatalog": catalog.name,
        "sourceCatalogSHA256": catalog_sha,
        "sourceCatalogRevision": revision,
        "provider": supplied.get("provider") or row.get("sourceProvider"),
        "license": supplied.get("license") or row.get("license"),
        "redistributionStatus": supplied.get("redistributionStatus") or row.get("redistributionStatus") or "unknown",
    }


def capture_review(row: dict) -> dict:
    value = row.get("captureReview") or row.get("capture_review") or {}
    return value if isinstance(value, dict) else {}


def eligibility(source_kind: str, row: dict, valid: bool) -> tuple[bool, bool, str | None, str]:
    if not valid:
        return False, False, "invalid-or-missing-image", "quarantine"
    if source_kind == "catalog":
        return True, True, None, split_for(str(row["recognitionFamilyId"]))
    review = capture_review(row)
    approved = bool(review.get("consent") and review.get("labelVerified") and review.get("reviewer"))
    if not approved:
        return False, False, "capture-awaiting-consent-and-label-review", "quarantine"
    # Camera captures first strengthen the held-out evaluation set. Promotion to
    # training is an explicit later policy decision, never an ingest side effect.
    return False, True, "camera-evaluation-only", "camera-evaluation"


def deterministic_tar(path: Path, blobs: Iterable[ValidatedBlob]) -> None:
    with tarfile.open(path, "w", format=tarfile.PAX_FORMAT) as archive:
        for blob in sorted(blobs, key=lambda value: value.sha256):
            member = f"blobs/{blob.sha256}.{blob.extension}"
            info = tarfile.TarInfo(member)
            info.size = blob.byte_count
            info.mtime = 0
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mode = 0o444
            archive.addfile(info, io.BytesIO(blob.data))


def diff_report(current: list[dict], previous: dict[str, dict]) -> dict:
    current_by_id = {row["sampleId"]: row for row in current}
    added = sorted(set(current_by_id) - set(previous))
    removed = sorted(set(previous) - set(current_by_id))
    content_changed = []
    metadata_changed = []
    unchanged = []
    ignored = {"blobSha256", "sha256", "bytes", "mime", "extension", "width", "height", "status", "error", "shard", "member"}
    for sample_id in sorted(set(current_by_id) & set(previous)):
        before, after = previous[sample_id], current_by_id[sample_id]
        if (before.get("blobSha256") or before.get("sha256")) != after.get("blobSha256"):
            content_changed.append(sample_id)
        elif {k: v for k, v in before.items() if k not in ignored} != {k: v for k, v in after.items() if k not in ignored}:
            metadata_changed.append(sample_id)
        else:
            unchanged.append(sample_id)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "added": added,
        "removed": removed,
        "contentChanged": content_changed,
        "metadataChanged": metadata_changed,
        "unchangedCount": len(unchanged),
        "counts": {
            "added": len(added),
            "removed": len(removed),
            "contentChanged": len(content_changed),
            "metadataChanged": len(metadata_changed),
            "unchanged": len(unchanged),
        },
    }


def distribution_update_plan(
    current: list[dict],
    previous: dict[str, dict],
    diff: dict,
    trained_games: set[str],
) -> dict:
    """Translate a materialized library diff into catalog/app release work."""
    current_by_id = {row["sampleId"]: row for row in current}
    games = sorted({
        str(row.get("game") or "").casefold()
        for row in [*current, *previous.values()]
        if str(row.get("game") or "").strip()
    })
    changes = {
        "added": set(diff["added"]),
        "removed": set(diff["removed"]),
        "contentChanged": set(diff["contentChanged"]),
        "metadataChanged": set(diff["metadataChanged"]),
    }

    def game_for(sample_id: str) -> str:
        row = current_by_id.get(sample_id) or previous.get(sample_id) or {}
        return str(row.get("game") or "").casefold()

    plans = {}
    for game in games:
        counts = {
            kind: sum(game_for(sample_id) == game for sample_id in sample_ids)
            for kind, sample_ids in changes.items()
        }
        catalog_changed = bool(counts["added"] or counts["removed"] or counts["metadataChanged"])
        artwork_changed = bool(counts["added"] or counts["removed"] or counts["contentChanged"])
        index_changed = catalog_changed or artwork_changed
        model_available = game in trained_games
        actions = []
        if catalog_changed:
            actions.append("rebuild-card-catalog")
        if index_changed and model_available:
            actions.extend([
                "rebuild-scanner-embeddings",
                "publish-ios-scanner-pack",
                "publish-android-scanner-pack",
                "publish-web-scan-index",
            ])
        elif index_changed:
            actions.append("train-and-evaluate-scanner-model")
        plans[game] = {
            "counts": counts,
            "cardCatalogUpdateRequired": catalog_changed,
            "scannerIndexUpdateRequired": index_changed,
            "trainingLibraryChanged": index_changed,
            "modelAvailable": model_available,
            "modelRetrainingRequired": index_changed and not model_available,
            "modelReexportRequired": False,
            "targets": ["ios", "android", "web"] if index_changed and model_available else [],
            "actions": actions,
            "reason": (
                "catalog or artwork rows changed"
                if index_changed else "materialized catalog and artwork are unchanged"
            ),
        }
    return {
        "schemaVersion": SCHEMA_VERSION,
        "games": plans,
        "summary": {
            "gamesChecked": len(plans),
            "cardCatalogUpdates": sum(plan["cardCatalogUpdateRequired"] for plan in plans.values()),
            "scannerIndexUpdates": sum(plan["scannerIndexUpdateRequired"] for plan in plans.values()),
            "platformPublishes": sum(len(plan["targets"]) for plan in plans.values()),
            "modelsNeedingTraining": sum(plan["modelRetrainingRequired"] for plan in plans.values()),
        },
    }


def write_json(path: Path, value: object) -> None:
    path.write_text(canonical_json(value) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: Iterable[dict]) -> None:
    path.write_text("".join(canonical_json(row) + "\n" for row in rows), encoding="utf-8")


def planning_document(path: Path | None, kind: str) -> tuple[dict, bytes, dict] | None:
    if path is None:
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise LibraryError(f"cannot read {kind}: {path}: {error}") from error
    if not isinstance(payload, dict) or payload.get("schemaVersion") != SCHEMA_VERSION:
        raise LibraryError(f"unsupported {kind} schema: {path}")
    if not isinstance(payload.get("games"), dict):
        raise LibraryError(f"{kind} must contain a games object: {path}")
    data = (canonical_json(payload) + "\n").encode()
    filename = "source-ledger.json" if kind == "source ledger" else "source-plan.json"
    return {"path": filename, "sha256": sha256_bytes(data)}, data, payload


def build_library(args: argparse.Namespace) -> tuple[dict, int]:
    planning_documents = {
        "ledger": planning_document(args.source_ledger, "source ledger"),
        "plan": planning_document(args.source_plan, "source plan"),
    }
    previous = load_manifest(args.previous_manifest)
    previous_root = args.previous_root or (args.previous_manifest.parent if args.previous_manifest else None)
    revision_by_key: dict[str, str] = {}
    for item in args.source_revision:
        key, revision = item.split("=", 1)
        if key in revision_by_key and revision_by_key[key] != revision:
            raise LibraryError(f"conflicting revisions supplied for {key}")
        revision_by_key[key] = revision
    records: list[tuple[dict, Path, str]] = []
    for catalog in args.catalog:
        catalog_sha = sha256_bytes(catalog.read_bytes())
        for row in load_records(catalog):
            if is_pokemon_pocket(row):
                raise LibraryError(
                    "physical scanner image library contains a Pokemon TCG "
                    f"Pocket row: {row.get('cardId') or row.get('name')}"
                )
            records.append((row, catalog, catalog_sha))
    catalog_games = {
        str(row.get("game") or "").strip().casefold()
        for row, _, _ in records if str(row.get("game") or "").strip()
    }
    ledger_document = planning_documents["ledger"]
    if ledger_document is not None:
        ledger_games = ledger_document[2]["games"]
        for game in sorted(catalog_games):
            source = ledger_games.get(game)
            if source is None:
                if game not in revision_by_key and "*" not in revision_by_key:
                    raise LibraryError(f"source ledger has no revision for catalog game {game}")
                continue
            revision = str(source.get("revision") or "").strip()
            if not revision:
                raise LibraryError(f"source ledger is missing a revision for {game}")
            if game in revision_by_key and revision_by_key[game] != revision:
                raise LibraryError(f"source ledger conflicts with --source-revision for {game}")
            revision_by_key[game] = revision

    def resolve_revision(catalog: Path, game: str) -> str | None:
        return (
            revision_by_key.get(str(catalog))
            or revision_by_key.get(game)
            or revision_by_key.get(catalog.name)
            or revision_by_key.get("*")
        )

    work: list[
        tuple[dict, Path, str, str, str, str, str, str, str, str, str, str | None]
    ] = []
    seen_sample_ids: set[str] = set()
    for source_row, catalog, catalog_sha in records:
        source_kind = str(source_row.get("sourceKind") or args.source_kind).casefold()
        if source_kind not in {"catalog", "capture"}:
            raise LibraryError(f"unsupported sourceKind: {source_kind}")
        locator_kind, locator, source_locator = normalized_locator(source_row, catalog)
        identity_key, visual_id = identity_for(source_row, source_locator)
        recognition_family_id = recognition_family_for(source_row, visual_id)
        supplied_sample_id = source_row.get("sampleId") or source_row.get("sample_id")
        sample_id = str(supplied_sample_id) if supplied_sample_id else sample_id_for(visual_id, source_kind, source_locator)
        if sample_id in seen_sample_ids:
            raise LibraryError(f"duplicate sample identity: {sample_id}")
        seen_sample_ids.add(sample_id)
        revision = resolve_revision(catalog, str(source_row.get("game") or "").casefold())
        work.append((
            source_row, catalog, catalog_sha, source_kind, locator_kind,
            locator, source_locator, identity_key, visual_id,
            recognition_family_id, sample_id, revision,
        ))

    def process(item: tuple) -> tuple[dict, ValidatedBlob | None]:
        (
            source_row, catalog, catalog_sha, source_kind, locator_kind,
            locator, source_locator, identity_key, visual_id,
            recognition_family_id, sample_id, revision,
        ) = item
        row = {
            "schemaVersion": SCHEMA_VERSION,
            "sampleId": sample_id,
            "visualIdentityId": visual_id,
            "visualIdentityKey": identity_key,
            "recognitionFamilyId": recognition_family_id,
            "game": str(source_row.get("game")).casefold(),
            "cardId": str(source_row.get("cardId") or source_row.get("card_id")),
            "exactPrintingId": str(
                source_row.get("exactPrintingId")
                or source_row.get("exact_printing_id")
                or source_row.get("cardId")
                or source_row.get("card_id")
            ),
            "name": source_row.get("name"),
            "setCode": source_row.get("setCode"),
            "collectorNumber": source_row.get("collectorNumber"),
            "oracleId": source_row.get("oracleId"),
            "illustrationId": source_row.get("illustrationId"),
            "artworkId": source_row.get("artworkId"),
            "layout": source_row.get("layout"),
            "setType": source_row.get("setType"),
            "faceSide": source_row.get("faceSide"),
            "sourceURL": source_locator if locator_kind == "url" else None,
            "sourcePath": source_locator if locator_kind == "file" else None,
            "provenance": provenance_for(source_row, catalog, catalog_sha, revision, source_kind),
        }
        prior = previous.get(sample_id)
        blob: ValidatedBlob | None = None
        try:
            data = None
            if not args.refresh and prior:
                data = read_cached(args.blob_cache, prior)
                if data is None and previous_root:
                    data = read_previous_shard(previous_root, prior)
            if data is None:
                if args.dry_run and locator_kind == "url":
                    raise LibraryError("not present locally (dry-run does not use the network)")
                data = fetch(locator_kind, locator, args.timeout, args.max_bytes)
            blob = validate_image(data)
            prior_sha = (prior.get("blobSha256") or prior.get("sha256")) if prior else None
            if prior_sha and data is not None and not args.refresh and blob.sha256 != prior_sha:
                raise LibraryError("cached bytes do not match previous manifest")
            if not args.dry_run:
                store_cache(args.blob_cache, blob)
            row.update({
                "status": "valid",
                "blobSha256": blob.sha256,
                "bytes": blob.byte_count,
                "mime": blob.mime_type,
                "extension": blob.extension,
                "width": blob.width,
                "height": blob.height,
                "shard": f"shards/blobs-{blob.sha256[:args.shard_prefix_length]}.tar",
                "member": f"blobs/{blob.sha256}.{blob.extension}",
                "error": None,
            })
        except (LibraryError, OSError, urllib.error.URLError) as error:
            row.update({
                "status": "invalid",
                "blobSha256": None,
                "bytes": None,
                "mime": None,
                "extension": None,
                "width": None,
                "height": None,
                "shard": None,
                "member": None,
                "error": str(error),
            })
        train, evaluate, reason, partition = eligibility(source_kind, row, row["status"] == "valid")
        row.update({
            "trainingEligible": train,
            "evaluationEligible": evaluate,
            "quarantineReason": reason,
            "partition": partition,
        })
        return row, blob

    if args.workers == 1:
        processed = map(process, work)
    else:
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=args.workers)
        processed = executor.map(process, work)
    try:
        results = list(processed)
    finally:
        if args.workers != 1:
            executor.shutdown(wait=True)
    output_rows = [row for row, _ in results]
    blobs: dict[str, ValidatedBlob] = {}
    for _, blob in results:
        if blob is not None:
            blobs.setdefault(blob.sha256, blob)

    output_rows.sort(key=lambda value: (
        value["recognitionFamilyId"], value["visualIdentityId"], value["sampleId"]
    ))
    valid = sum(row["status"] == "valid" for row in output_rows)
    invalid = len(output_rows) - valid
    coverage = {
        "schemaVersion": SCHEMA_VERSION,
        "status": "ready" if invalid == 0 else ("incomplete-allowed" if args.allow_incomplete else "blocked"),
        "failClosed": not args.allow_incomplete,
        "counts": {
            "input": len(output_rows),
            "valid": valid,
            "invalid": invalid,
            "uniqueBlobs": len(blobs),
            "trainingEligible": sum(bool(row["trainingEligible"]) for row in output_rows),
            "evaluationEligible": sum(bool(row["evaluationEligible"]) for row in output_rows),
            "quarantined": sum(bool(row["quarantineReason"]) for row in output_rows),
        },
        "coverage": valid / len(output_rows) if output_rows else 0.0,
        "invalidSamples": [
            {"sampleId": row["sampleId"], "error": row["error"]}
            for row in output_rows if row["status"] != "valid"
        ],
    }
    diff = diff_report(output_rows, previous)
    distribution_plan = distribution_update_plan(
        output_rows,
        previous,
        diff,
        {game.casefold() for game in args.trained_game},
    )
    distribution_bytes = (canonical_json(distribution_plan) + "\n").encode()
    manifest_bytes = "".join(canonical_json(row) + "\n" for row in output_rows).encode()
    catalog_descriptors = []
    for path in args.catalog:
        games = sorted({
            str(row.get("game") or "unknown").strip().casefold()
            for row in load_records(path)
        })
        catalog_descriptors.append({
            "path": f"{'+'.join(games)}/{path.name}",
            "sha256": sha256_bytes(path.read_bytes()),
        })
    catalog_descriptors.sort(key=lambda item: (item["path"], item["sha256"]))
    release = {
        "schemaVersion": SCHEMA_VERSION,
        "manifest": "manifest.jsonl",
        "manifestSHA256": sha256_bytes(manifest_bytes),
        "coverage": "coverage.json",
        "diff": "diff.json",
        "distributionPlan": {
            "path": "distribution-plan.json",
            "sha256": sha256_bytes(distribution_bytes),
        },
        "shardPrefixLength": args.shard_prefix_length,
        "sourceRevisions": revision_by_key,
        "sourceCatalogs": catalog_descriptors,
        "sourcePlanning": {
            key: document[0] for key, document in planning_documents.items() if document is not None
        },
    }
    summary = {
        "release": release,
        "coverage": coverage,
        "diff": diff,
        "distributionPlan": distribution_plan,
    }
    if not args.dry_run:
        if args.output.exists():
            raise LibraryError(f"output already exists; use a new versioned directory: {args.output}")
        args.output.mkdir(parents=True)
        (args.output / "shards").mkdir()
        grouped: dict[str, list[ValidatedBlob]] = {}
        for blob in blobs.values():
            grouped.setdefault(blob.sha256[:args.shard_prefix_length], []).append(blob)
        for prefix, shard_blobs in sorted(grouped.items()):
            deterministic_tar(args.output / "shards" / f"blobs-{prefix}.tar", shard_blobs)
        write_jsonl(args.output / "manifest.jsonl", output_rows)
        write_json(args.output / "coverage.json", coverage)
        write_json(args.output / "diff.json", diff)
        (args.output / "distribution-plan.json").write_bytes(distribution_bytes)
        for document in planning_documents.values():
            if document is not None:
                descriptor, data, _ = document
                (args.output / descriptor["path"]).write_bytes(data)
        write_json(args.output / "library.json", release)
    print(canonical_json({
        "status": coverage["status"],
        "output": None if args.dry_run else str(args.output),
        "manifestSHA256": release["manifestSHA256"],
        "sourceCatalogSHA256": [item["sha256"] for item in release["sourceCatalogs"]],
        "coverage": coverage["coverage"],
        "counts": coverage["counts"],
        "diffCounts": diff["counts"],
        "distributionSummary": distribution_plan["summary"],
    }))
    return summary, 0 if invalid == 0 or args.allow_incomplete else 2


def audit_library(root: Path) -> dict:
    release = json.loads((root / "library.json").read_text(encoding="utf-8"))
    manifest_path = root / release["manifest"]
    manifest_bytes = manifest_path.read_bytes()
    errors: list[str] = []
    if sha256_bytes(manifest_bytes) != release.get("manifestSHA256"):
        errors.append("manifest SHA256 mismatch")
    distribution = release.get("distributionPlan")
    if distribution is not None:
        distribution_path = root / distribution.get("path", "")
        if not distribution_path.is_file():
            errors.append("missing distribution plan")
        elif sha256_bytes(distribution_path.read_bytes()) != distribution.get("sha256"):
            errors.append("distribution plan SHA256 mismatch")
    for kind, descriptor in release.get("sourcePlanning", {}).items():
        planning_path = root / descriptor.get("path", "")
        if not planning_path.is_file():
            errors.append(f"missing source planning artifact: {kind}")
        elif sha256_bytes(planning_path.read_bytes()) != descriptor.get("sha256"):
            errors.append(f"source planning SHA256 mismatch: {kind}")
    expected_members: dict[Path, set[str]] = {}
    rows = list(load_records(manifest_path))
    for row in rows:
        if row.get("status") != "valid":
            continue
        shard_path = root / row["shard"]
        expected_members.setdefault(shard_path, set()).add(row["member"])
    for shard_path, members in sorted(expected_members.items(), key=lambda value: str(value[0])):
        if not shard_path.is_file():
            errors.append(f"missing shard: {shard_path.relative_to(root)}")
            continue
        try:
            with tarfile.open(shard_path, "r") as archive:
                actual = {member.name for member in archive.getmembers() if member.isfile()}
                if actual != members:
                    errors.append(f"member set mismatch: {shard_path.relative_to(root)}")
                for row in (item for item in rows if item.get("shard") == str(shard_path.relative_to(root))):
                    if row["member"] not in actual:
                        continue
                    extracted = archive.extractfile(row["member"])
                    if extracted is None:
                        continue
                    data = extracted.read()
                    try:
                        blob = validate_image(data)
                        if blob.sha256 != row["blobSha256"] or blob.byte_count != row["bytes"]:
                            errors.append(f"blob contract mismatch: {row['sampleId']}")
                    except LibraryError as error:
                        errors.append(f"invalid blob {row['sampleId']}: {error}")
        except (tarfile.TarError, OSError) as error:
            errors.append(f"cannot read {shard_path.relative_to(root)}: {error}")
    result = {"status": "valid" if not errors else "invalid", "rows": len(rows), "errors": errors}
    print(canonical_json(result))
    return result


def upload_library(root: Path, repo: str, revision: str, path_in_repo: str) -> dict:
    path_in_repo = path_in_repo.strip("/")
    if not path_in_repo or any(part in {"", ".", ".."} for part in path_in_repo.split("/")):
        raise LibraryError("--path-in-repo must be a non-empty relative Hub path")
    audit = audit_library(root)
    if audit["status"] != "valid":
        raise LibraryError("refusing to upload an invalid library")
    coverage = json.loads((root / "coverage.json").read_text(encoding="utf-8"))
    if coverage.get("status") != "ready":
        raise LibraryError("refusing to upload a library without 100% image coverage")
    subprocess.run([
        "hf", "upload", repo, str(root), path_in_repo,
        "--type", "dataset", "--revision", revision, "--private",
        "--commit-message", "Publish scanner training image library",
    ], check=True)
    result = subprocess.run([
        "hf", "datasets", "info", repo, "--revision", revision,
        "--expand", "sha", "--format", "json",
    ], check=True, capture_output=True, text=True)
    payload = json.loads(result.stdout)
    pinned = payload.get("sha") or payload.get("revision")
    if not pinned:
        raise LibraryError("upload completed but Hugging Face did not return a pinned commit SHA")
    response = {
        "status": "uploaded",
        "repo": repo,
        "repoType": "dataset",
        "branch": revision,
        "pathInRepo": path_in_repo,
        "pinnedRevision": pinned,
        "url": f"https://huggingface.co/datasets/{repo}/tree/{pinned}/{path_in_repo}",
    }
    print(canonical_json(response))
    return response


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    sync = commands.add_parser("sync", help="download/reuse, validate, diff, and package catalog images")
    sync.add_argument("--catalog", type=Path, action="append", required=True)
    sync.add_argument("--output", type=Path, required=True)
    sync.add_argument("--blob-cache", type=Path, required=True)
    sync.add_argument("--previous-manifest", type=Path)
    sync.add_argument("--previous-root", type=Path)
    sync.add_argument(
        "--source-revision", action="append", default=[], metavar="GAME_OR_PATH=REVISION",
        help="repeat per game/path; use *=REVISION for one universal snapshot",
    )
    sync.add_argument("--source-ledger", type=Path, help="provider source-ledger.json to preserve in the release")
    sync.add_argument("--source-plan", type=Path, help="provider source-plan.json to preserve in the release")
    sync.add_argument("--source-kind", choices=("catalog", "capture"), default="catalog")
    sync.add_argument(
        "--trained-game", action="append", default=["pokemon", "magic", "yugioh"],
        help="game with an approved model; repeat for future trained games",
    )
    sync.add_argument("--refresh", action="store_true", help="re-fetch URLs even when previous bytes are locally available")
    sync.add_argument("--dry-run", action="store_true", help="perform a network-free plan without writing output/cache")
    sync.add_argument("--allow-incomplete", action="store_true", help="diagnostic escape hatch; incomplete releases cannot upload")
    sync.add_argument("--timeout", type=float, default=45.0)
    sync.add_argument("--max-bytes", type=int, default=64 * 1024 * 1024, help="maximum accepted bytes per image")
    sync.add_argument("--workers", type=int, default=16, help="parallel image fetch/validation workers")
    sync.add_argument("--shard-prefix-length", type=int, choices=(1, 2, 3), default=2)
    audit = commands.add_parser("audit", help="verify a packaged library without network access")
    audit.add_argument("--root", type=Path, required=True)
    upload = commands.add_parser("upload", help="upload a verified release to a private HF dataset")
    upload.add_argument("--root", type=Path, required=True)
    upload.add_argument("--repo", required=True)
    upload.add_argument("--revision", default="main")
    upload.add_argument("--path-in-repo", default="release")
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "sync":
            for item in args.source_revision:
                if "=" not in item:
                    raise LibraryError("--source-revision must be GAME_OR_PATH=REVISION")
            if args.workers < 1:
                raise LibraryError("--workers must be at least 1")
            if args.max_bytes < 1:
                raise LibraryError("--max-bytes must be at least 1")
            _, status = build_library(args)
            return status
        if args.command == "audit":
            return 0 if audit_library(args.root)["status"] == "valid" else 2
        upload_library(args.root, args.repo, args.revision, args.path_in_repo)
        return 0
    except (LibraryError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        print(canonical_json({"status": "error", "error": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
