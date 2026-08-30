#!/usr/bin/env python3
"""ArcFace student encoder for TCGer — headless Colab CLI variant.

Same deployment recipe as train-arcface-encoder-colab.ipynb, but with a
two-stage recognition objective: ArcFace learns one class per visual
``recognitionFamilyId`` and the exported catalog retains exact-print metadata
for a title/number/symbol verifier. This avoids teaching the visual encoder
that two identical reprints are contradictory classes. It runs with zero
Drive/browser dependencies under `colab exec`/`colab run`. One universal
encoder is trained across all supplied games, while its catalogs are exported
as independently replaceable per-game shards:

- one or more catalog metadata files are supplied with repeatable `--metadata`
  arguments (the legacy /content/CardsIndexMetadata.json remains the default)
- card images come from a pinned durable library (`--image-library-root`) or,
  for legacy runs, download from imageURL into an identity-keyed validated cache
- everything the Mac needs lands in /content/outputs:
    arcface-checkpoint.pt        (resumable, per epoch)
    status.json                  (cheap to poll with `colab download`)
    CardEmbeddings-arcface.mlpackage.zip
    CardsIndexVectors-arcface.bin and CardsIndexMetadata.json (combined)
    shards/{pokemon,magic,yugioh}/CardsIndex{Metadata,Vectors-arcface}.*
    arcface-eval.json

Run remotely:
    colab new -s tcger-arcface --gpu L4
    colab install -s tcger-arcface torch torchvision timm coremltools pillow numpy
    colab upload -s tcger-arcface pokemon.json magic.json yugioh.json /content/
    colab exec -s tcger-arcface -f train_arcface_encoder.py -- \
      --metadata /content/pokemon.json --metadata /content/magic.json \
      --metadata /content/yugioh.json
    colab download -s tcger-arcface /content/outputs/CardEmbeddings-arcface.mlpackage.zip .
    colab download -s tcger-arcface /content/outputs/CardsIndexVectors-arcface.bin .
    colab stop -s tcger-arcface
"""
import argparse
import concurrent.futures as cf
import hashlib
import json
import math
import os
import random
import shutil
import struct
import tarfile
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

META_PATH = "/content/CardsIndexMetadata.json"
CACHE_DIR = Path(os.environ.get("TCGER_CACHE_DIR", "/content/card-images"))
OUT_DIR = Path(os.environ.get("TCGER_OUTPUT_DIR", "/content/outputs"))
CKPT = OUT_DIR / "arcface-checkpoint.pt"
STATUS = OUT_DIR / "status.json"
PACKAGE_DIR = OUT_DIR.parent / "CardEmbeddings-arcface.mlpackage"
COVERAGE_REPORT = OUT_DIR / "image-coverage.json"

IMNET_MEAN = [0.485, 0.456, 0.406]
IMNET_STD = [0.229, 0.224, 0.225]
IMG_SIZE = 224
EMBED_DIM = 384
ARC_S, ARC_M = 16.0, 0.50  # s=16: s=30 with AdamW saturates and never lifts off (measured)
SEED = 22
RUNTIME_METADATA_FIELDS = (
    "annIndex",
    "cardId",
    "exactPrintingId",
    "recognitionFamilyId",
    "name",
    "game",
    "format",
    "setCode",
    "collectorNumber",
    "setName",
    "rarity",
    "imageURL",
    "price",
    "releaseDate",
    "faceSide",
)
PRINTING_METADATA_FIELDS = tuple(
    field for field in RUNTIME_METADATA_FIELDS
    if field not in {"annIndex", "recognitionFamilyId", "name", "game"}
)

EXPORT_ARTIFACT_NAMES = (
    "CardEmbeddings-arcface.mlpackage.zip",
    "CardsIndexVectors-arcface.bin",
    "CardsIndexMetadata.json",
    "arcface-eval.json",
    "provenance.json",
    "run-config.json",
    "shards",
)


def remove_exact_generated_path(path: Path, parent: Path, expected_name: str) -> bool:
    """Remove one allow-listed generated child without following symlinks."""
    candidate = Path(os.path.abspath(path))
    allowed_parent = Path(os.path.abspath(parent))
    if candidate.parent != allowed_parent or candidate.name != expected_name:
        raise ValueError(f"refusing to remove unexpected generated path: {candidate}")
    if candidate.is_symlink() or candidate.is_file():
        candidate.unlink()
        return True
    if candidate.is_dir():
        shutil.rmtree(candidate)
        return True
    return False


def clean_previous_export_artifacts(
    output_dir: Path = OUT_DIR,
    package_dir: Path = PACKAGE_DIR,
) -> list[Path]:
    """Clean only replaceable exports, preserving checkpoints and image coverage."""
    if output_dir.is_symlink():
        raise ValueError(f"refusing to clean symlinked output directory: {output_dir}")
    removed = []
    for name in EXPORT_ARTIFACT_NAMES:
        path = output_dir / name
        if remove_exact_generated_path(path, output_dir, name):
            removed.append(path)
    if remove_exact_generated_path(
        package_dir,
        output_dir.parent,
        "CardEmbeddings-arcface.mlpackage",
    ):
        removed.append(package_dir)
    return removed


class ImageCoverageError(RuntimeError):
    """Raised when a production catalog does not have a valid image per row."""


class DurableImageLibrary:
    """Verified, read-only view of a versioned scanner image-library release."""

    def __init__(self, root: Path, manifest_path=None, pinned_revision=None):
        self.root = Path(root).resolve()
        library_path = self.root / "library.json"
        if not library_path.is_file():
            raise ImageCoverageError(f"durable image library is missing {library_path}")
        with open(library_path, encoding="utf-8") as source:
            release = json.load(source)
        configured_manifest = manifest_path or release.get("manifest")
        if not configured_manifest:
            raise ImageCoverageError("durable image library does not name a manifest")
        candidate = Path(configured_manifest)
        if not candidate.is_absolute():
            candidate = self.root / candidate
        self.manifest_path = candidate.resolve()
        if self.manifest_path.parent != self.root and self.root not in self.manifest_path.parents:
            raise ImageCoverageError("durable image manifest escapes the library root")
        manifest_bytes = self.manifest_path.read_bytes()
        actual_manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()
        expected_manifest_sha = release.get("manifestSHA256")
        if expected_manifest_sha and expected_manifest_sha != actual_manifest_sha:
            raise ImageCoverageError("durable image manifest SHA-256 mismatch")
        self.descriptor = {
            "schemaVersion": release.get("schemaVersion"),
            "manifestSHA256": actual_manifest_sha,
            "pinnedRevision": pinned_revision,
        }
        self.rows = []
        for line_number, line in enumerate(manifest_bytes.decode("utf-8").splitlines(), 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ImageCoverageError(
                    f"durable image manifest row {line_number} is not an object"
                )
            if row.get("status") == "valid" and (
                row.get("trainingEligible") is True
                or row.get("evaluationEligible") is True
            ):
                self.rows.append(row)
        self._by_source = {}
        self._by_visual_id = {}
        for row in self.rows:
            source_key = self._source_key(row)
            self._by_source.setdefault(source_key, []).append(row)
            self._by_visual_id.setdefault(str(row.get("visualIdentityId")), []).append(row)

    @staticmethod
    def _source_key(row):
        source_url = str(row.get("sourceURL") or row.get("imageURL") or "")
        parsed = urllib.parse.urlsplit(source_url)
        stable_url = urllib.parse.urlunsplit(
            (parsed.scheme, parsed.netloc, parsed.path, "", "")
        )
        return (
            normalize_game(row.get("game")),
            str(row.get("cardId")),
            stable_url,
        )

    def record_for(self, entry):
        explicit = entry.get("visualIdentityId")
        if explicit:
            candidates = self._by_visual_id.get(str(explicit), [])
            if len(candidates) == 1:
                return candidates[0]
        candidates = self._by_source.get(self._source_key(entry), [])
        if len(candidates) == 1:
            return candidates[0]
        if len(candidates) > 1:
            raise ImageCoverageError(
                f"durable library has duplicate eligible rows for {visual_identity(entry)}"
            )
        return None

    def selected_entry_indices(self, entries):
        """Map the prepared pack back to exact catalog rows and cover every family."""
        selected = [
            index for index, entry in enumerate(entries)
            if self.record_for(entry) is not None
        ]
        selected_families = {recognition_family(entries[index]) for index in selected}
        catalog_families = {recognition_family(entry) for entry in entries}
        missing = sorted(catalog_families - selected_families)
        if missing:
            preview = ", ".join(missing[:5])
            raise ImageCoverageError(
                f"prepared image pack has no representative for {len(missing)} "
                f"catalog families: {preview}"
            )
        return selected

    def validate_facts(self, entry, facts) -> dict:
        row = self.record_for(entry)
        if row is None:
            raise ImageCoverageError(
                f"durable library has no eligible image for {visual_identity(entry)}"
            )
        expected = {
            "sha256": row.get("blobSha256"),
            "bytes": row.get("bytes"),
            "width": row.get("width"),
            "height": row.get("height"),
        }
        for key, value in expected.items():
            if facts.get(key) != value:
                raise ImageCoverageError(
                    f"cached image {key} does not match the pinned durable library"
                )
        return row

    def materialize(self, entry, destination: Path) -> dict:
        row = self.record_for(entry)
        if row is None:
            raise ImageCoverageError(
                f"durable library has no eligible image for {visual_identity(entry)}"
            )
        expected_sha = row.get("blobSha256")
        expected_bytes = row.get("bytes")
        if not expected_sha or not isinstance(expected_bytes, int):
            raise ImageCoverageError("durable library row lacks blob integrity fields")
        shard = (self.root / str(row.get("shard") or "")).resolve()
        if shard.parent != self.root and self.root not in shard.parents:
            raise ImageCoverageError("durable library shard escapes the library root")
        member_name = str(row.get("member") or "")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tarfile.open(shard, "r") as archive:
                member = archive.getmember(member_name)
                if not member.isfile() or member.name != member_name:
                    raise ImageCoverageError("durable library member is not a regular file")
                extracted = archive.extractfile(member)
                if extracted is None:
                    raise ImageCoverageError("durable library member could not be read")
                with tempfile.NamedTemporaryFile(
                    mode="wb",
                    dir=destination.parent,
                    prefix=f".{destination.name}.",
                    suffix=".part",
                    delete=False,
                ) as output:
                    temporary = Path(output.name)
                    shutil.copyfileobj(extracted, output)
            facts = validate_image(temporary)
            expected_dimensions = (row.get("width"), row.get("height"))
            if facts["sha256"] != expected_sha:
                raise ImageCoverageError("durable library blob SHA-256 mismatch")
            if facts["bytes"] != expected_bytes:
                raise ImageCoverageError("durable library blob byte count mismatch")
            if (facts["width"], facts["height"]) != expected_dimensions:
                raise ImageCoverageError("durable library blob dimensions mismatch")
            os.replace(temporary, destination)
            temporary = None
            atomic_write_json(
                cache_sidecar_path(destination),
                image_sidecar(entry, facts),
            )
            return facts
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)


def write_status(**kwargs):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **kwargs}
    tmp = STATUS.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=1))
    os.replace(tmp, STATUS)
    print(f"[status] {payload}", flush=True)


def normalize_game(value):
    game = str(value or "pokemon").strip().lower().replace("_", "-")
    aliases = {
        "pokemon": "pokemon",
        "pokémon": "pokemon",
        "magic": "magic",
        "mtg": "magic",
        "magic-the-gathering": "magic",
        "magic: the gathering": "magic",
        "yugioh": "yugioh",
        "yu-gi-oh": "yugioh",
        "yu gi oh": "yugioh",
    }
    if game not in aliases:
        raise ValueError(f"unsupported game in metadata: {value!r}")
    return aliases[game]


def is_pokemon_pocket(entry) -> bool:
    if normalize_game(entry.get("game")) != "pokemon":
        return False
    series = entry.get("series")
    if isinstance(series, dict):
        series_values = (series.get("id"), series.get("name"))
    else:
        series_values = (series,)
    fields = (entry.get("format"), entry.get("gameFormat"), *series_values)
    if any(str(value or "").strip().casefold() in {"pocket", "tcgp"} for value in fields):
        return True
    return "/tcgp/" in str(entry.get("imageURL") or "").casefold()


def load_entries(metadata_paths):
    combined = []
    for metadata_path in metadata_paths:
        with open(metadata_path) as source:
            entries = json.load(source)
        entries.sort(key=lambda e: e["annIndex"])
        for source_index, entry in enumerate(entries):
            assert entry["annIndex"] == source_index, (
                f"annIndex order must be contiguous in {metadata_path}"
            )
            item = dict(entry)
            item["annIndex"] = len(combined)
            item["game"] = normalize_game(item.get("game"))
            if is_pokemon_pocket(item):
                raise ValueError(
                    "physical scanner training metadata contains a Pokemon "
                    f"TCG Pocket row: {item.get('cardId')}"
                )
            combined.append(item)
    if not combined:
        raise ValueError("at least one catalog metadata entry is required")
    return combined


def canonical_json(value) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def catalog_fingerprint(entries) -> str:
    """Fingerprint the complete, ordered class-to-metadata mapping."""
    normalized = [
        {key: value for key, value in entry.items() if key != "annIndex"}
        for entry in entries
    ]
    return hashlib.sha256(canonical_json(normalized).encode()).hexdigest()


def visual_identity(entry) -> str:
    explicit = entry.get("visualIdentityId")
    if explicit:
        return str(explicit)
    return f'{normalize_game(entry.get("game"))}:{entry["cardId"]}'


def recognition_family(entry) -> str:
    """Stable visual class used by retrieval, distinct from exact printing."""
    explicit = entry.get("recognitionFamilyId")
    if explicit:
        return str(explicit)
    return visual_identity(entry)


def partition_indices(entries, image_library, candidate_indices=None):
    """Return family-disjoint training and held-out evaluation row indexes."""
    all_indices = (
        list(range(len(entries)))
        if candidate_indices is None else list(candidate_indices)
    )
    if image_library is None:
        return all_indices, []
    training = []
    held_out = []
    for index in all_indices:
        entry = entries[index]
        row = image_library.record_for(entry)
        if row is None:
            raise ImageCoverageError(
                f"durable library has no eligible image for {visual_identity(entry)}"
            )
        partition = str(row.get("partition") or "")
        if row.get("trainingEligible") is True and partition == "train":
            training.append(index)
        if row.get("evaluationEligible") is True and partition in {
            "validation", "test", "camera-evaluation"
        }:
            held_out.append(index)
    if not training:
        raise ImageCoverageError("durable image library contains no train partition")
    return training, held_out


def image_cache_key(entry) -> str:
    """Bind cached bytes to a visual identity and its exact source URL."""
    identity = {
        "visualIdentity": visual_identity(entry),
        "sourceURL": str(entry.get("imageURL") or ""),
    }
    return hashlib.sha256(canonical_json(identity).encode()).hexdigest()


def cached_path(entry, cache_dir=None) -> Path:
    cache_root = Path(cache_dir) if cache_dir is not None else CACHE_DIR
    key = image_cache_key(entry)
    return cache_root / normalize_game(entry.get("game")) / key[:2] / f"{key}.img"


def cache_sidecar_path(image_path: Path) -> Path:
    return image_path.with_suffix(".json")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_image(path: Path) -> dict:
    """Fully decode an image and return content facts used by the manifest."""
    from PIL import Image

    if not path.is_file() or path.stat().st_size <= 0:
        raise ValueError("image file is empty")
    with Image.open(path) as image:
        image_format = image.format or "unknown"
        image.verify()
    # ``verify`` intentionally invalidates the decoder, so reopen and force a
    # full pixel decode. Truncated files can pass header inspection alone.
    with Image.open(path) as image:
        image.load()
        width, height = image.size
    if width <= 0 or height <= 0:
        raise ValueError("image dimensions must be positive")
    return {
        "sha256": file_sha256(path),
        "bytes": path.stat().st_size,
        "width": width,
        "height": height,
        "format": image_format.lower(),
    }


def atomic_write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    ) as output:
        temporary = Path(output.name)
        json.dump(value, output, ensure_ascii=False, indent=2, sort_keys=True)
        output.write("\n")
    os.replace(temporary, path)


def image_sidecar(entry, facts) -> dict:
    url = str(entry.get("imageURL") or "")
    return {
        "schema": "tcger-training-image-cache-v1",
        "cacheKey": image_cache_key(entry),
        "visualIdentity": visual_identity(entry),
        "sourceURL": url,
        "sourceURLSHA256": hashlib.sha256(url.encode()).hexdigest(),
        **facts,
    }


def _cached_image_facts(entry, destination: Path):
    """Validate both cached bytes and the identity/content sidecar."""
    if not destination.is_file():
        return None
    facts = validate_image(destination)
    expected = image_sidecar(entry, facts)
    sidecar_path = cache_sidecar_path(destination)
    if sidecar_path.is_file():
        with open(sidecar_path, encoding="utf-8") as source:
            stored = json.load(source)
        if stored != expected:
            raise ValueError("cached image sidecar does not match bytes or identity")
    else:
        # Safe migration for an identity-keyed cache created before sidecars:
        # the path already commits to identity+URL and the bytes were decoded.
        atomic_write_json(sidecar_path, expected)
    return facts


def _download_validated_image(entry, destination: Path) -> dict:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        entry["imageURL"],
        headers={"User-Agent": "TCGer-trainer"},
    )
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".part",
            delete=False,
        ) as output:
            temporary = Path(output.name)
            with urllib.request.urlopen(request, timeout=30) as response:
                shutil.copyfileobj(response, output)
        facts = validate_image(temporary)
        os.replace(temporary, destination)
        temporary = None
        atomic_write_json(
            cache_sidecar_path(destination),
            image_sidecar(entry, facts),
        )
        return facts
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def coverage_record(entry, row: int, status: str, facts=None) -> dict:
    url = str(entry.get("imageURL") or "")
    record = {
        "row": row,
        "game": normalize_game(entry.get("game")),
        "cardId": str(entry["cardId"]),
        "visualIdentity": visual_identity(entry),
        "sourceURL": url,
        "sourceURLSHA256": hashlib.sha256(url.encode()).hexdigest(),
        "cacheKey": image_cache_key(entry),
        "status": status,
    }
    if facts:
        record.update(facts)
    return record


def build_coverage_report(
    entries,
    records,
    allow_quarantine=False,
    source_library=None,
) -> dict:
    ordered = sorted(records, key=lambda item: item["row"])
    export_index = 0
    for record in ordered:
        if record["status"] == "valid":
            record["exportAnnIndex"] = export_index
            export_index += 1
        else:
            record["exportAnnIndex"] = None
    library_rows = [
        {
            "cacheKey": record["cacheKey"],
            "sha256": record["sha256"],
        }
        for record in ordered
        if record["status"] == "valid"
    ]
    counts = {
        status: sum(record["status"] == status for record in ordered)
        for status in ("valid", "missing", "unavailable", "corrupt")
    }
    invalid = len(ordered) - counts["valid"]
    report = {
        "schema": "tcger-training-image-coverage-v1",
        "catalogFingerprint": catalog_fingerprint(entries),
        "imageLibraryFingerprint": hashlib.sha256(
            canonical_json(library_rows).encode()
        ).hexdigest(),
        "total": len(ordered),
        "valid": counts["valid"],
        "missing": counts["missing"],
        "unavailable": counts["unavailable"],
        "corrupt": counts["corrupt"],
        "quarantined": invalid if allow_quarantine else 0,
        "entries": ordered,
    }
    if source_library is not None:
        report["sourceLibrary"] = source_library.descriptor
    return report


def compact_entries(entries, valid_indices):
    """Drop quarantined rows and make exported ANN labels contiguous."""
    compacted = []
    for ann_index, source_index in enumerate(valid_indices):
        item = dict(entries[source_index])
        item["annIndex"] = ann_index
        compacted.append(item)
    return compacted


def runtime_metadata_entries(entries):
    """Project training rows onto the fields decoded by the iOS runtime."""
    return [
        {key: entry[key] for key in RUNTIME_METADATA_FIELDS if key in entry}
        for entry in entries
    ]


def family_runtime_metadata_entries(entries):
    """Collapse exact rows into one ANN row per recognition family.

    The newest exact printing is the backwards-compatible top-level row. All
    printings remain available as lightweight metadata for exact mode and for
    persisting the user's selected collection identity.
    """
    grouped = {}
    for entry in entries:
        key = (entry["game"], recognition_family(entry))
        grouped.setdefault(key, []).append(entry)

    output = []
    for ann_index, key in enumerate(sorted(grouped)):
        printings = sorted(
            grouped[key],
            key=lambda row: (
                str(row.get("releaseDate") or ""),
                str(row.get("exactPrintingId") or row.get("cardId") or ""),
            ),
            reverse=True,
        )
        canonical = dict(printings[0])
        canonical["annIndex"] = ann_index
        runtime = {
            field: canonical[field]
            for field in RUNTIME_METADATA_FIELDS
            if field in canonical
        }
        runtime["indexIdentity"] = "recognition_family"
        runtime["printingCount"] = len(printings)
        runtime["printings"] = [
            {
                field: printing[field]
                for field in PRINTING_METADATA_FIELDS
                if field in printing
            }
            for printing in printings
        ]
        output.append(runtime)
    return output


def materialize_images(
    entries,
    workers=24,
    *,
    cache_dir=None,
    coverage_path=None,
    allow_quarantine=False,
    image_library=None,
    status_writer=write_status,
):
    cache_root = Path(cache_dir) if cache_dir is not None else CACHE_DIR
    report_path = Path(coverage_path) if coverage_path is not None else COVERAGE_REPORT
    cache_root.mkdir(parents=True, exist_ok=True)
    path_locks = {}
    path_locks_guard = threading.Lock()

    def lock_for(path):
        with path_locks_guard:
            return path_locks.setdefault(path, threading.Lock())

    def fetch(i_entry):
        row, entry = i_entry
        destination = cached_path(entry, cache_root)
        if not entry.get("imageURL"):
            return coverage_record(entry, row, "missing")
        with lock_for(destination):
            try:
                facts = _cached_image_facts(entry, destination)
                if facts is not None:
                    if image_library is not None:
                        image_library.validate_facts(entry, facts)
                    return coverage_record(entry, row, "valid", facts)
            except Exception as error:
                print(f"discarding invalid cache {destination}: {error}", flush=True)
                destination.unlink(missing_ok=True)
                cache_sidecar_path(destination).unlink(missing_ok=True)

            last_status = "unavailable"
            for attempt in range(3):
                try:
                    facts = (
                        image_library.materialize(entry, destination)
                        if image_library is not None
                        else _download_validated_image(entry, destination)
                    )
                    return coverage_record(entry, row, "valid", facts)
                except Exception as error:
                    from PIL import UnidentifiedImageError

                    last_status = (
                        "corrupt"
                        if isinstance(error, (UnidentifiedImageError, ValueError, OSError))
                        and not isinstance(error, urllib.error.URLError)
                        else "unavailable"
                    )
                    print(
                        f"image fetch attempt {attempt + 1}/3 failed for "
                        f"{visual_identity(entry)} ({last_status}): {error}",
                        flush=True,
                    )
                    # A pinned durable library is immutable. Retrying the same
                    # bad/missing blob cannot repair it and only obscures the
                    # integrity failure.
                    if attempt < 2 and image_library is None:
                        time.sleep(1 + attempt)
                    if image_library is not None:
                        break
            return coverage_record(entry, row, last_status)

    records = []
    with cf.ThreadPoolExecutor(max_workers=workers) as executor:
        for record in executor.map(fetch, enumerate(entries)):
            records.append(record)
            if len(records) % 2000 == 0:
                status_writer(
                    phase="caching-images",
                    cached=len(records),
                    total=len(entries),
                    invalid=sum(item["status"] != "valid" for item in records),
                )
    report = build_coverage_report(
        entries,
        records,
        allow_quarantine,
        source_library=image_library,
    )
    atomic_write_json(report_path, report)
    status_writer(
        phase="images-ready",
        total=report["total"],
        valid=report["valid"],
        missing=report["missing"],
        unavailable=report["unavailable"],
        corrupt=report["corrupt"],
        coverageReport=str(report_path),
        imageLibraryFingerprint=report["imageLibraryFingerprint"],
    )
    invalid = report["total"] - report["valid"]
    if invalid and not allow_quarantine:
        raise ImageCoverageError(
            f"image coverage is incomplete ({report['valid']}/{report['total']} valid); "
            f"see {report_path}. Pass --allow-image-quarantine only for an "
            "explicit non-production run."
        )
    valid_indices = [
        record["row"] for record in report["entries"] if record["status"] == "valid"
    ]
    if not valid_indices:
        raise ImageCoverageError("no valid training images remain after quarantine")
    return valid_indices, report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--views-per-card", type=int, default=3)
    parser.add_argument(
        "--training-views-per-card",
        type=int,
        help=(
            "Training augmentations per identity per epoch. Defaults to "
            "--views-per-card, which remains the evaluation query count."
        ),
    )
    parser.add_argument("--batch", type=int, default=256)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--backbone", default="fastvit_t8.apple_in1k")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument(
        "--limit-per-game",
        type=int,
        default=0,
        help="Deterministic per-game cap for a quick validation run; 0 uses every row",
    )
    parser.add_argument(
        "--eval-cards-per-game",
        type=int,
        default=2500,
        help="Maximum gallery identities sampled per game for augmented-query eval",
    )
    parser.add_argument(
        "--metadata",
        action="append",
        help="CardsIndexMetadata JSON; repeat once per game",
    )
    parser.add_argument(
        "--coverage-report",
        type=Path,
        help="Image coverage manifest (default: <output>/image-coverage.json)",
    )
    parser.add_argument(
        "--image-library-root",
        type=Path,
        help=(
            "Versioned durable image-library release containing library.json, "
            "manifest.jsonl, and shards. When set, upstream URLs are never fetched."
        ),
    )
    parser.add_argument(
        "--image-library-manifest",
        type=Path,
        help="Optional manifest override inside --image-library-root",
    )
    parser.add_argument(
        "--image-library-revision",
        help="Pinned Hub commit/revision recorded with checkpoints and evaluation",
    )
    parser.add_argument(
        "--allow-image-quarantine",
        action="store_true",
        help=(
            "Non-production escape hatch: drop missing/corrupt image rows and "
            "compact ANN labels. The default is to fail unless coverage is 100%."
        ),
    )
    parser.add_argument(
        "--hub-repo",
        help="Optional Hugging Face model repo used to resume/persist each epoch",
    )
    parser.add_argument("--hub-path-prefix", default="training")
    parser.add_argument(
        "--pokemon-baseline-onnx",
        type=Path,
        help=(
            "Currently shipped Pokemon ArcFace ONNX. When supplied, both models "
            "receive identical augmented Pokemon pixels through their respective "
            "preprocessing contracts and search the same Pokemon gallery."
        ),
    )
    # parse_known_args: under `colab exec` the code runs in a Jupyter kernel
    # whose sys.argv carries kernel flags that argparse must not choke on.
    args, _ = parser.parse_known_args()
    training_views_per_card = (
        args.views_per_card
        if args.training_views_per_card is None
        else args.training_views_per_card
    )
    if training_views_per_card < 1 or args.views_per_card < 1:
        parser.error("training and evaluation views per card must be positive")

    removed_exports = clean_previous_export_artifacts()
    if removed_exports:
        print(
            "cleaned previous generated exports: "
            + ", ".join(path.name for path in removed_exports),
            flush=True,
        )

    metadata_paths = args.metadata or [META_PATH]
    entries = load_entries(metadata_paths)
    if args.limit_per_game:
        limited = []
        for game in ("pokemon", "magic", "yugioh"):
            game_entries = [entry for entry in entries if entry["game"] == game]
            limited.extend(game_entries[:args.limit_per_game])
        entries = limited
        for index, entry in enumerate(entries):
            entry["annIndex"] = index
    requested_game_counts = {
        game: sum(entry["game"] == game for entry in entries)
        for game in ("pokemon", "magic", "yugioh")
        if any(entry["game"] == game for entry in entries)
    }
    write_status(
        phase="catalogs-loaded",
        total=len(entries),
        games=requested_game_counts,
    )
    if args.image_library_manifest and not args.image_library_root:
        parser.error("--image-library-manifest requires --image-library-root")
    durable_library = (
        DurableImageLibrary(
            args.image_library_root,
            manifest_path=args.image_library_manifest,
            pinned_revision=args.image_library_revision,
        )
        if args.image_library_root
        else None
    )
    if durable_library is not None:
        selected_catalog_indices = durable_library.selected_entry_indices(entries)
        selected_entries = [entries[index] for index in selected_catalog_indices]
        selected_valid, image_coverage = materialize_images(
            selected_entries,
            coverage_path=args.coverage_report or COVERAGE_REPORT,
            allow_quarantine=args.allow_image_quarantine,
            image_library=durable_library,
        )
        valid = [selected_catalog_indices[index] for index in selected_valid]
        print(
            f"prepared pack materialized {len(valid)} representatives for "
            f"{len(entries)} catalog rows",
            flush=True,
        )
    else:
        valid, image_coverage = materialize_images(
            entries,
            coverage_path=args.coverage_report or COVERAGE_REPORT,
            allow_quarantine=args.allow_image_quarantine,
            image_library=None,
        )
        if len(valid) != len(entries):
            entries = compact_entries(entries, valid)
            print(
                f"quarantined {image_coverage['total'] - image_coverage['valid']} rows; "
                f"training/exporting {len(entries)} validated rows",
                flush=True,
            )
        valid = list(range(len(entries)))
    training_indices, held_out_eval_indices = partition_indices(
        entries, durable_library, valid
    )
    training_family_ids = sorted({
        recognition_family(entries[index]) for index in training_indices
    })
    training_family_labels = {
        family_id: index for index, family_id in enumerate(training_family_ids)
    }
    row_training_labels = {
        index: training_family_labels[recognition_family(entries[index])]
        for index in training_indices
    }
    game_counts = {
        game: sum(entry["game"] == game for entry in entries)
        for game in ("pokemon", "magic", "yugioh")
        if any(entry["game"] == game for entry in entries)
    }

    # Validate the complete image library before importing the training stack
    # or requiring a GPU. A bad catalog should fail during cheap preparation,
    # not after an accelerator has been allocated for training.
    import numpy as np
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    import timm
    import torchvision.transforms as T
    import torchvision.transforms.functional as TF
    from PIL import Image, ImageEnhance, ImageFilter
    from torch.utils.data import Dataset, DataLoader

    assert torch.cuda.is_available(), "needs a GPU runtime (colab new --gpu L4/T4)"
    device = "cuda"
    torch.manual_seed(SEED)
    random.seed(SEED)
    np.random.seed(SEED)
    print("GPU:", torch.cuda.get_device_name(0), flush=True)

    def contract_resize(img):
        # Mirrors CardEmbeddingEncoder.swift: shortest edge >= 256 (both sides
        # cover 224), bicubic with ceil, center-crop 224.
        w, h = img.size
        s = max(256 / min(w, h), IMG_SIZE / w, IMG_SIZE / h)
        rw, rh = math.ceil(w * s), math.ceil(h * s)
        img = img.resize((rw, rh), Image.BICUBIC)
        left, top = (rw - IMG_SIZE) // 2, (rh - IMG_SIZE) // 2
        return img.crop((left, top, left + IMG_SIZE, top + IMG_SIZE))

    class CardViews(Dataset):
        def __init__(self, indices, train=True, views=None, labels=None):
            self.indices = indices
            self.train = train
            self.labels = labels
            self.views = (
                views if views is not None else (args.views_per_card if train else 1)
            )

        def __len__(self):
            return len(self.indices) * self.views

        def __getitem__(self, k):
            i = self.indices[k % len(self.indices)]
            img = Image.open(cached_path(entries[i])).convert("RGB")
            if self.train:
                if random.random() < 0.85:
                    img = T.RandomPerspective(distortion_scale=0.35, p=1.0,
                                              fill=random.randint(0, 255))(img)
                if random.random() < 0.8:
                    img = ImageEnhance.Brightness(img).enhance(random.uniform(0.55, 1.45))
                    img = ImageEnhance.Color(img).enhance(random.uniform(0.6, 1.4))
                    img = ImageEnhance.Contrast(img).enhance(random.uniform(0.7, 1.3))
                if random.random() < 0.5:
                    img = img.filter(ImageFilter.GaussianBlur(random.uniform(0.5, 2.2)))
                elif random.random() < 0.3:
                    img = ImageEnhance.Sharpness(img).enhance(random.uniform(1.2, 2.5))
            x = TF.to_tensor(contract_resize(img))
            if self.train and random.random() < 0.5:
                x = (x + torch.randn_like(x) * random.uniform(0.005, 0.03)).clamp(0, 1)
            label = self.labels[i] if self.labels is not None else i
            return TF.normalize(x, IMNET_MEAN, IMNET_STD), label

    class Encoder(nn.Module):
        def __init__(self):
            super().__init__()
            self.backbone = timm.create_model(args.backbone, pretrained=True, num_classes=0)
            self.proj = nn.Linear(self.backbone.num_features, EMBED_DIM)

        def forward(self, x):
            return F.normalize(self.proj(self.backbone(x)), dim=-1)

    class ArcFace(nn.Module):
        # Margin warm-up: m=0.5 from step zero on a randomly-initialized head
        # over 21.8k classes measurably fails to train (epoch-3 loss pinned at
        # ln(N) ≈ 10.0, chance-level accuracy — observed 2026-08-23). Start as
        # plain scaled softmax and ramp the margin in; the epoch loop sets
        # `margin` each epoch.
        def __init__(self, classes):
            super().__init__()
            self.w = nn.Parameter(torch.empty(classes, EMBED_DIM))
            nn.init.xavier_uniform_(self.w)
            self.margin = 0.0

        def forward(self, emb, labels):
            cos = emb @ F.normalize(self.w, dim=-1).t()
            if self.margin <= 0:
                return ARC_S * cos  # plain scaled softmax
            theta = torch.acos(cos.clamp(-1 + 1e-7, 1 - 1e-7))
            target = torch.cos(theta + self.margin)
            onehot = F.one_hot(labels, self.w.shape[0]).to(cos.dtype)
            return ARC_S * (onehot * target + (1 - onehot) * cos)

    model, head = Encoder().to(device), ArcFace(len(training_family_ids)).to(device)
    # The head must organize 21.8k class vectors from scratch while the
    # pretrained backbone only fine-tunes; a memorization probe showed the
    # head organizes quickly given adequate step size. 3x LR on proj+head
    # (10x measured to thrash at full scale).
    opt = torch.optim.AdamW([
        {"params": model.backbone.parameters(), "lr": args.lr},
        {"params": model.proj.parameters(), "lr": args.lr * 3},
        {"params": head.parameters(), "lr": args.lr * 3},
    ], weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)
    scaler = torch.amp.GradScaler()
    start_epoch = 0
    run_catalog_fingerprint = catalog_fingerprint(entries)
    image_library_fingerprint = image_coverage["imageLibraryFingerprint"]
    hub_checkpoint_path = f"{args.hub_path_prefix}/arcface-checkpoint.pt"
    if args.hub_repo and not CKPT.exists():
        try:
            from huggingface_hub import hf_hub_download
            downloaded = hf_hub_download(args.hub_repo, hub_checkpoint_path)
            CKPT.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(downloaded, CKPT)
            print(f"downloaded resumable checkpoint from {args.hub_repo}", flush=True)
        except Exception as error:
            print(f"no resumable Hub checkpoint: {error}", flush=True)
    if CKPT.exists():
        ck = torch.load(CKPT, map_location=device)
        if ck.get("catalogFingerprint") != run_catalog_fingerprint:
            raise ValueError("checkpoint catalog does not match supplied metadata")
        if ck.get("imageLibraryFingerprint") != image_library_fingerprint:
            raise ValueError(
                "checkpoint image library does not match the validated training bytes"
            )
        if ck.get("sourceImageLibrary") != image_coverage.get("sourceLibrary"):
            raise ValueError(
                "checkpoint durable image-library revision does not match this run"
            )
        checkpoint_config = ck.get("config", {})
        checkpoint_training_views = checkpoint_config.get("trainingViewsPerCard")
        if (
            checkpoint_training_views is not None
            and checkpoint_training_views != training_views_per_card
        ):
            raise ValueError(
                "checkpoint training-view count does not match this run "
                f"({checkpoint_training_views} != {training_views_per_card})"
            )
        model.load_state_dict(ck["model"])
        head.load_state_dict(ck["head"])
        opt.load_state_dict(ck["opt"])
        sched.load_state_dict(ck["sched"])
        start_epoch = ck["epoch"] + 1
        print(f"resumed after epoch {ck['epoch']}", flush=True)

    loader = DataLoader(
        CardViews(
            training_indices,
            train=True,
            views=training_views_per_card,
            labels=row_training_labels,
        ),
        batch_size=args.batch,
        shuffle=True,
        num_workers=args.workers,
        pin_memory=True,
        drop_last=True,
        persistent_workers=True,
    )

    for epoch in range(start_epoch, args.epochs):
        # Margin ramp: margin-free through epoch 3 — at 21.8k classes the head
        # needs ~300+ plain-softmax steps before liftoff (measured; a ramp
        # starting at epoch 1 froze training at chance) — then linear to the
        # full ArcFace margin over epochs 4-8.
        head.margin = ARC_M * min(1.0, max(0.0, (epoch - 3) / 5.0))
        model.train(); head.train()
        t0, seen, loss_sum, correct = time.time(), 0, 0.0, 0
        window_loss, window_correct, window_seen, step = 0.0, 0, 0, 0
        for x, y in loader:
            x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
            opt.zero_grad(set_to_none=True)
            with torch.amp.autocast("cuda"):
                logits = head(model(x), y)
                loss = F.cross_entropy(logits, y)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            seen += y.numel()
            loss_sum += loss.item() * y.numel()
            correct += (logits.argmax(1) == y).sum().item()
            window_seen += y.numel()
            window_loss += loss.item() * y.numel()
            window_correct += (logits.argmax(1) == y).sum().item()
            step += 1
            if step % 100 == 0:
                # Step-level visibility: epoch averages hid whether the model
                # was lifting off or sitting flat at chance.
                write_status(phase="training-step", epoch=epoch, step=step,
                             window_loss=round(window_loss / window_seen, 3),
                             window_acc=round(window_correct / window_seen, 4),
                             margin=round(head.margin, 3))
                window_loss, window_correct, window_seen = 0.0, 0, 0
        sched.step()
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        torch.save({"model": model.state_dict(), "head": head.state_dict(),
                    "opt": opt.state_dict(), "sched": sched.state_dict(),
                    "epoch": epoch,
                    "catalogFingerprint": run_catalog_fingerprint,
                    "imageLibraryFingerprint": image_library_fingerprint,
                    "sourceImageLibrary": image_coverage.get("sourceLibrary"),
                    "config": {
                        "backbone": args.backbone,
                        "dim": EMBED_DIM,
                        "recognitionContract": "tcger-two-stage-recognition-v1",
                        "trainingRecognitionFamilies": len(training_family_ids),
                        "trainingRows": len(training_indices),
                        "heldOutEvaluationRows": len(held_out_eval_indices),
                        "trainingViewsPerCard": training_views_per_card,
                        "evaluationViewsPerCard": args.views_per_card,
                        "coverageSchema": image_coverage["schema"],
                    }}, CKPT)
        write_status(phase="training", epoch=epoch, epochs=args.epochs,
                     loss=round(loss_sum / seen, 4), train_acc=round(correct / seen, 4),
                     margin=round(head.margin, 3),
                     minutes=round((time.time() - t0) / 60, 1))
        if args.hub_repo:
            from huggingface_hub import HfApi
            api = HfApi()
            api.upload_file(
                path_or_fileobj=str(CKPT),
                path_in_repo=hub_checkpoint_path,
                repo_id=args.hub_repo,
            )
            api.upload_file(
                path_or_fileobj=str(STATUS),
                path_in_repo=f"{args.hub_path_prefix}/status.json",
                repo_id=args.hub_repo,
            )

    # ---- Eval: catalog self-retrieval -------------------------------------
    @torch.no_grad()
    def embed_all(ds, bs=512):
        model.eval()
        out = torch.empty(len(ds), EMBED_DIM)
        row = 0
        for x, _ in DataLoader(ds, batch_size=bs, num_workers=args.workers):
            e = model(x.to(device))
            out[row:row + len(e)] = e.cpu()
            row += len(e)
        return out

    gallery = embed_all(CardViews(valid, train=False))
    rng = random.Random(SEED)
    eval_indices = []
    for game in game_counts:
        held_out_candidates = [
            index for index in held_out_eval_indices
            if entries[index]["game"] == game
        ]
        candidates = held_out_candidates or [
            index for index in valid if entries[index]["game"] == game
        ]
        rng.shuffle(candidates)
        eval_indices.extend(candidates[:args.eval_cards_per_game])
    queries = embed_all(CardViews(eval_indices, train=True))
    qlabels = torch.tensor([
        eval_indices[k % len(eval_indices)]
        for k in range(len(eval_indices) * args.views_per_card)
    ])
    glabels = torch.tensor(valid)
    gallery_gpu = gallery.to(device)
    top_chunks = []
    for start in range(0, len(queries), 512):
        sims = queries[start:start + 512].to(device) @ gallery_gpu.t()
        top_chunks.append(sims.topk(5, dim=1).indices.cpu())
    top = torch.cat(top_chunks)
    hits = glabels[top] == qlabels[:, None]
    all_family_ids = sorted({recognition_family(entry) for entry in entries})
    family_number = {family: index for index, family in enumerate(all_family_ids)}
    gallery_family_labels = torch.tensor([
        family_number[recognition_family(entries[index])] for index in valid
    ])
    query_family_labels = torch.tensor([
        family_number[recognition_family(entries[eval_indices[k % len(eval_indices)]])]
        for k in range(len(eval_indices) * args.views_per_card)
    ])
    family_hits = gallery_family_labels[top] == query_family_labels[:, None]
    student = {
        f"recall@{k}": family_hits[:, :k].any(1).float().mean().item()
        for k in (1, 5)
    }
    printing_row = {
        f"recall@{k}": hits[:, :k].any(1).float().mean().item()
        for k in (1, 5)
    }
    by_game = {}
    query_labels = qlabels.tolist()
    for game in game_counts:
        game_indices = {
            index for index, entry in enumerate(entries) if entry["game"] == game
        }
        mask = torch.tensor([label in game_indices for label in query_labels])
        if mask.any():
            by_game[game] = {
                f"recall@{k}": family_hits[mask, :k].any(1).float().mean().item()
                for k in (1, 5)
            }
    evaluation = {
        "student": student,
        "printingRow": printing_row,
        "byGame": by_game,
        "evaluationProtocol": {
            "primaryIdentity": "recognitionFamilyId",
            "secondaryIdentity": "exactPrintingId",
            "queryPartition": (
                "durable-family-disjoint-held-out"
                if held_out_eval_indices else "legacy-random-catalog-sample"
            ),
            "trainingRows": len(training_indices),
            "trainingRecognitionFamilies": len(training_family_ids),
            "heldOutEvaluationRows": len(held_out_eval_indices),
            "abstainWhenExactPrintingIsUnresolved": True,
        },
        "epochs": args.epochs,
        "backbone": args.backbone,
        "trainingViewsPerCard": training_views_per_card,
        "evaluationViewsPerCard": args.views_per_card,
        "optimizerStepsPerEpoch": len(loader),
        "configuredOptimizerSteps": len(loader) * args.epochs,
        "catalogFingerprint": run_catalog_fingerprint,
        "imageLibraryFingerprint": image_library_fingerprint,
        "sourceImageLibrary": image_coverage.get("sourceLibrary"),
        "imageCoverage": {
            key: image_coverage[key]
            for key in (
                "total",
                "valid",
                "missing",
                "unavailable",
                "corrupt",
                "quarantined",
            )
        },
        "catalogRows": len(entries),
        "preparedRepresentativeRows": len(valid),
    }

    if args.pokemon_baseline_onnx:
        baseline_path = args.pokemon_baseline_onnx
        if not baseline_path.is_file():
            raise FileNotFoundError(f"Pokemon baseline ONNX not found: {baseline_path}")

        import onnxruntime as ort

        available = ort.get_available_providers()
        providers = [
            provider for provider in ("CUDAExecutionProvider", "CPUExecutionProvider")
            if provider in available
        ]
        baseline = ort.InferenceSession(str(baseline_path), providers=providers)
        baseline_input = baseline.get_inputs()[0].name
        baseline_batch = baseline.get_inputs()[0].shape[0]

        @torch.no_grad()
        def embed_ab(ds, bs=256):
            model.eval()
            student_rows, baseline_rows = [], []
            baseline_mean = np.asarray(IMNET_MEAN, dtype=np.float32).reshape(1, 3, 1, 1)
            baseline_std = np.asarray(IMNET_STD, dtype=np.float32).reshape(1, 3, 1, 1)
            for normalized, _ in DataLoader(ds, batch_size=bs, num_workers=args.workers):
                student_rows.append(model(normalized.to(device)).cpu())
                # CardViews returns ImageNet-normalized tensors because that is
                # the training-time contract of the universal PyTorch model.
                # The shipped production ONNX has ImageNet normalization baked
                # into its graph and instead expects the same RGB pixels in
                # [0, 1]. Undo only normalization; geometry and augmentations
                # remain byte-for-byte paired between both models.
                baseline_numpy = np.clip(
                    normalized.numpy() * baseline_std + baseline_mean,
                    0.0,
                    1.0,
                )
                if isinstance(baseline_batch, int) and baseline_batch == 1:
                    baseline_output = np.concatenate([
                        baseline.run(None, {baseline_input: sample[None]})[0]
                        for sample in baseline_numpy
                    ])
                else:
                    baseline_output = baseline.run(
                        None, {baseline_input: baseline_numpy}
                    )[0]
                baseline_rows.append(F.normalize(
                    torch.from_numpy(baseline_output).float(), dim=-1
                ))
            return torch.cat(student_rows), torch.cat(baseline_rows)

        pokemon_gallery_indices = [
            index for index in valid if entries[index]["game"] == "pokemon"
        ]
        pokemon_query_indices = [
            index for index in eval_indices if entries[index]["game"] == "pokemon"
        ]
        if pokemon_gallery_indices and pokemon_query_indices:
            pokemon_gallery_student, pokemon_gallery_baseline = embed_ab(
                CardViews(pokemon_gallery_indices, train=False)
            )
            pokemon_query_student, pokemon_query_baseline = embed_ab(
                CardViews(pokemon_query_indices, train=True)
            )
            pokemon_query_labels = torch.tensor([
                pokemon_query_indices[k % len(pokemon_query_indices)]
                for k in range(len(pokemon_query_indices) * args.views_per_card)
            ])
            pokemon_gallery_labels = torch.tensor(pokemon_gallery_indices)

            def retrieval_metrics(query_embeddings, gallery_embeddings):
                gallery_device = gallery_embeddings.to(device)
                hit_chunks = []
                for start in range(0, len(query_embeddings), 512):
                    scores = (
                        query_embeddings[start:start + 512].to(device)
                        @ gallery_device.t()
                    )
                    nearest = scores.topk(5, dim=1).indices.cpu()
                    hit_chunks.append(
                        pokemon_gallery_labels[nearest]
                        == pokemon_query_labels[start:start + len(nearest), None]
                    )
                paired_hits = torch.cat(hit_chunks)
                return {
                    f"recall@{k}": paired_hits[:, :k].any(1).float().mean().item()
                    for k in (1, 5)
                }

            universal_metrics = retrieval_metrics(
                pokemon_query_student, pokemon_gallery_student
            )
            production_metrics = retrieval_metrics(
                pokemon_query_baseline, pokemon_gallery_baseline
            )
            evaluation["pokemonComparison"] = {
                "galleryIdentities": len(pokemon_gallery_indices),
                "queryIdentities": len(pokemon_query_indices),
                "queriesPerIdentity": args.views_per_card,
                "baselineArtifact": {
                    "filename": baseline_path.name,
                    "sha256": hashlib.sha256(baseline_path.read_bytes()).hexdigest(),
                    "providers": baseline.get_providers(),
                    "inputContract": "RGB float32 [0,1]; ImageNet normalization baked into ONNX",
                },
                "universalPokemonShard": universal_metrics,
                "productionArcFace": production_metrics,
                "delta": {
                    key: universal_metrics[key] - production_metrics[key]
                    for key in universal_metrics
                },
            }

    json.dump(
        evaluation,
        open(OUT_DIR / "arcface-eval.json", "w"),
        indent=1,
    )
    write_status(phase="evaluated", **{k: round(v, 4) for k, v in student.items()})

    # ---- Export: Core ML + int8 index -------------------------------------
    import coremltools as ct

    class Deploy(nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m
            self.register_buffer("mean", torch.tensor(IMNET_MEAN).view(1, 3, 1, 1))
            self.register_buffer("std", torch.tensor(IMNET_STD).view(1, 3, 1, 1))

        def forward(self, x):
            return self.m((x - self.mean) / self.std)

    deploy = Deploy(model.float().cpu()).eval()
    example = torch.rand(1, 3, IMG_SIZE, IMG_SIZE)
    traced = torch.jit.trace(deploy, example)
    ml = ct.convert(
        traced,
        convert_to="mlprogram",
        minimum_deployment_target=ct.target.iOS18,
        compute_units=ct.ComputeUnit.ALL,
        inputs=[ct.ImageType(name="image", shape=example.shape, scale=1 / 255.0,
                             color_layout=ct.colorlayout.RGB)],
        outputs=[ct.TensorType(name="embedding")],
    )
    # Core ML/Xcode packages are directory artifacts. They must be replaced as
    # a unit rather than saved over a previous conversion.
    remove_exact_generated_path(
        PACKAGE_DIR,
        OUT_DIR.parent,
        "CardEmbeddings-arcface.mlpackage",
    )
    ml.save(str(PACKAGE_DIR))
    shutil.make_archive(str(OUT_DIR / "CardEmbeddings-arcface.mlpackage"), "zip",
                        PACKAGE_DIR.parent, PACKAGE_DIR.name)

    # The prepared pack contains bounded representatives. Export one vector
    # per visual family and retain exact printings as lightweight nested
    # metadata. This avoids duplicating an identical vector for every reprint.
    family_vectors = {}
    for gallery_index, catalog_index in enumerate(valid):
        family_vectors.setdefault(
            recognition_family(entries[catalog_index]), gallery[gallery_index]
        )
    missing_vector_families = sorted({
        recognition_family(entry) for entry in entries
        if recognition_family(entry) not in family_vectors
    })
    if missing_vector_families:
        raise RuntimeError(
            "prepared gallery lacks vectors for catalog families: "
            + ", ".join(missing_vector_families[:5])
        )
    family_entries = family_runtime_metadata_entries(entries)
    full = torch.stack([
        family_vectors[entry["recognitionFamilyId"]]
        for entry in family_entries
    ])

    def write_vector_file(path, vectors):
        path.parent.mkdir(parents=True, exist_ok=True)
        quantized = torch.clamp(torch.round(vectors * 127), -127, 127)
        quantized = quantized.to(torch.int8).numpy()
        with open(path, "wb") as output:
            output.write(struct.pack("<ii", len(vectors), EMBED_DIM))
            output.write(quantized.tobytes())

    # Keep the combined output for the current iOS packaging path.
    write_vector_file(OUT_DIR / "CardsIndexVectors-arcface.bin", full)
    with open(OUT_DIR / "CardsIndexMetadata.json", "w") as output:
        json.dump(family_entries, output, separators=(",", ":"))

    # Game-specific modes download only their catalog. Automatic mode loads
    # compatible shards together and still runs this single encoder once.
    for game in game_counts:
        indices = [
            index for index, entry in enumerate(family_entries) if entry["game"] == game
        ]
        shard_entries = []
        for shard_index, global_index in enumerate(indices):
            item = dict(family_entries[global_index])
            item["annIndex"] = shard_index
            shard_entries.append(item)
        shard_dir = OUT_DIR / "shards" / game
        shard_dir.mkdir(parents=True, exist_ok=True)
        with open(shard_dir / "CardsIndexMetadata.json", "w") as output:
            json.dump(
                # ``shard_entries`` already came from the sanitized family
                # runtime projection above. Running it through the legacy
                # flat-row projector a second time drops ``printings`` and
                # makes the per-game pack unusable by the two-stage runtime.
                shard_entries,
                output,
                separators=(",", ":"),
            )
        write_vector_file(
            shard_dir / "CardsIndexVectors-arcface.bin",
            full[torch.tensor(indices)],
        )
    write_status(
        phase="done",
        vectorFamilies=len(family_entries),
        exactPrintingRows=len(entries),
        outputs=sorted(p.name for p in OUT_DIR.iterdir()),
    )


if __name__ == "__main__":
    main()
