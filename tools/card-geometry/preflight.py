"""Model-independent preflight for a card-geometry corpus release.

The preflight answers one question before any GPU is billed: is this release
structurally sound, leakage-free, and content-complete enough for the purpose
it declares? It runs the same way locally, in unit tests, and inside a
Hugging Face CPU Job, and it produces one JSON report with a structured
`checks` list so a caller can assert on a specific check code rather than on a
bare exit status.

    python3 tools/card-geometry/preflight.py \
        --release-root tools/card-geometry/fixtures/releases/valid-fixture \
        --report /tmp/preflight.json

Exit codes: 0 when every check passes, 2 when at least one check fails, and 3
when the release cannot be read at all (the report still records why).

`readyFor` in the report is `training` only when every check passes and the
release declares `releasePurpose: training`; `tooling` when every check passes
for a `fixture` or `smoke` release; otherwise `none`. A tiny fixture release
therefore can never authorize training, whatever its bound policy says. The
GPU wrapper additionally passes `--expected-purpose training` and
`--expected-policy-sha256`, so a release cannot lower its own bar by binding a
weaker policy.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus_release import (  # noqa: E402
    FIXTURES_DIR,
    MANIFEST_FILENAME,
    MANIFEST_SCHEMA_FILE,
    POLICY_SCHEMA_FILE,
    RECORD_SCHEMA_FILE,
    REPORT_SCHEMA_ID,
    REPOSITORY,
    SPLITS,
    corpus_hash,
    leakage_keys_from_record,
    load_json,
    load_schema,
    make_validator,
    png_dimensions,
    sha256_bytes,
    sha256_file,
    validation_errors,
)
from reference_geometry import (  # noqa: E402
    canonical_round,
    forward_source_pixel,
    inverse_model_pixel,
    process_candidates,
)

REPORT_MARKER_BEGIN = "PREFLIGHT_REPORT_BEGIN"
REPORT_MARKER_END = "PREFLIGHT_REPORT_END"

EXIT_OK = 0
EXIT_CHECKS_FAILED = 2
EXIT_UNREADABLE = 3

PASS = "pass"
FAIL = "fail"
SKIP = "skip"

CHECK_ORDER = (
    "MANIFEST_LOAD",
    "MANIFEST_SCHEMA",
    "POLICY_LOAD",
    "POLICY_SCHEMA",
    "POLICY_HASH",
    "CORPUS_HASH",
    "RECORD_SCHEMA",
    "RECORD_HASH",
    "IMAGE_HASH",
    "MANIFEST_RECORD_CONSISTENCY",
    "LEAKAGE_KEYS_PRESENT",
    "LEAKAGE_DISJOINT",
    "EVAL_DENYLIST",
    "SPLIT_REAL_ONLY",
    "SOURCE_TIER",
    "SHARED_FIXTURES",
    "CORNER_COUNTS",
    "READINESS_MINIMUMS",
    "RELEASE_PURPOSE",
)


@dataclass
class Check:
    code: str
    status: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "status": self.status,
            "message": self.message,
            "details": self.details,
        }


@dataclass
class Expectations:
    corpus_hash: str | None = None
    policy_sha256: str | None = None
    policy_id: str | None = None
    purpose: str | None = None


@dataclass
class Context:
    root: Path
    fixtures_dir: Path
    expectations: Expectations
    tooling_revision: str | None
    checks: list[Check] = field(default_factory=list)
    manifest: dict[str, Any] | None = None
    manifest_valid: bool = False
    policy: dict[str, Any] | None = None
    policy_valid: bool = False
    records: dict[str, dict[str, Any]] = field(default_factory=dict)
    record_valid: dict[str, bool] = field(default_factory=dict)

    def add(self, code: str, status: str, message: str, **details: Any) -> Check:
        check = Check(code, status, message, details)
        self.checks.append(check)
        return check

    def failed(self) -> list[str]:
        return [check.code for check in self.checks if check.status == FAIL]


def _safe_path(root: Path, relative: str) -> Path | None:
    """Resolve a manifest-relative path, refusing escapes from the release root."""
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    return candidate


def check_manifest(ctx: Context) -> None:
    path = ctx.root / MANIFEST_FILENAME
    if not path.is_file():
        ctx.add("MANIFEST_LOAD", FAIL, f"{MANIFEST_FILENAME} not found", path=str(path))
        return
    try:
        manifest = load_json(path)
    except (OSError, json.JSONDecodeError) as error:
        ctx.add(
            "MANIFEST_LOAD",
            FAIL,
            f"{MANIFEST_FILENAME} is unreadable",
            error=str(error),
        )
        return
    if not isinstance(manifest, dict):
        ctx.add("MANIFEST_LOAD", FAIL, f"{MANIFEST_FILENAME} is not a JSON object")
        return
    ctx.manifest = manifest
    ctx.add("MANIFEST_LOAD", PASS, "manifest loaded", path=str(path))

    validator = make_validator(load_schema(MANIFEST_SCHEMA_FILE))
    errors = validation_errors(validator, manifest)
    if errors:
        ctx.add("MANIFEST_SCHEMA", FAIL, "manifest violates its schema", errors=errors)
    else:
        ctx.manifest_valid = True
        ctx.add("MANIFEST_SCHEMA", PASS, "manifest matches the release-manifest schema")


def check_policy(ctx: Context) -> None:
    if not ctx.manifest_valid:
        for code in ("POLICY_LOAD", "POLICY_SCHEMA", "POLICY_HASH"):
            ctx.add(code, SKIP, "manifest invalid")
        return
    assert ctx.manifest is not None
    readiness = ctx.manifest["readiness"]
    path = _safe_path(ctx.root, readiness["readinessPolicyPath"])
    if path is None or not path.is_file():
        ctx.add(
            "POLICY_LOAD",
            FAIL,
            "readiness policy file missing or outside the release",
            path=readiness["readinessPolicyPath"],
        )
        ctx.add("POLICY_SCHEMA", SKIP, "policy not loaded")
        ctx.add("POLICY_HASH", SKIP, "policy not loaded")
        return
    try:
        policy = load_json(path)
    except (OSError, json.JSONDecodeError) as error:
        ctx.add("POLICY_LOAD", FAIL, "readiness policy unreadable", error=str(error))
        ctx.add("POLICY_SCHEMA", SKIP, "policy not loaded")
        ctx.add("POLICY_HASH", SKIP, "policy not loaded")
        return
    ctx.policy = policy
    ctx.add("POLICY_LOAD", PASS, "readiness policy loaded", path=str(path))

    validator = make_validator(load_schema(POLICY_SCHEMA_FILE))
    errors = validation_errors(validator, policy)
    if errors:
        ctx.add(
            "POLICY_SCHEMA", FAIL, "readiness policy violates its schema", errors=errors
        )
    else:
        ctx.policy_valid = True
        ctx.add("POLICY_SCHEMA", PASS, "readiness policy matches its schema")

    actual_sha = sha256_file(path)
    problems = []
    if actual_sha != readiness["readinessPolicySha256"]:
        problems.append(
            "policy file hash differs from manifest.readiness.readinessPolicySha256"
        )
    declared_id = policy.get("policyId") if isinstance(policy, dict) else None
    if declared_id != readiness["readinessPolicyId"]:
        problems.append(
            "policy.policyId differs from manifest.readiness.readinessPolicyId"
        )
    expected = ctx.expectations
    if expected.policy_sha256 and actual_sha != expected.policy_sha256:
        problems.append("policy file hash differs from the caller's expected hash")
    if expected.policy_id and declared_id != expected.policy_id:
        problems.append("policy id differs from the caller's expected id")
    details = {
        "actualSha256": actual_sha,
        "manifestSha256": readiness["readinessPolicySha256"],
        "expectedSha256": expected.policy_sha256,
        "policyId": declared_id,
        "expectedPolicyId": expected.policy_id,
    }
    if problems:
        ctx.add("POLICY_HASH", FAIL, "; ".join(problems), **details)
    else:
        ctx.add(
            "POLICY_HASH", PASS, "policy identity and hash bound correctly", **details
        )


def check_corpus_hash(ctx: Context) -> None:
    if not ctx.manifest_valid:
        ctx.add("CORPUS_HASH", SKIP, "manifest invalid")
        return
    assert ctx.manifest is not None
    recomputed = corpus_hash(ctx.manifest)
    declared = ctx.manifest["corpusHash"]
    expected = ctx.expectations.corpus_hash
    if recomputed == declared and (expected is None or declared == expected):
        ctx.add(
            "CORPUS_HASH",
            PASS,
            "corpusHash matches canonical manifest content",
            corpusHash=declared,
            expectedCorpusHash=expected,
        )
    else:
        ctx.add(
            "CORPUS_HASH",
            FAIL,
            "corpusHash does not match canonical manifest content or caller expectation",
            declared=declared,
            recomputed=recomputed,
            expected=expected,
        )


def check_records(ctx: Context) -> None:
    codes = (
        "RECORD_SCHEMA",
        "RECORD_HASH",
        "IMAGE_HASH",
        "MANIFEST_RECORD_CONSISTENCY",
    )
    if not ctx.manifest_valid:
        for code in codes:
            ctx.add(code, SKIP, "manifest invalid")
        return
    assert ctx.manifest is not None
    validator = make_validator(load_schema(RECORD_SCHEMA_FILE))
    schema_failures: dict[str, Any] = {}
    hash_failures: dict[str, str] = {}
    image_failures: dict[str, list[str]] = defaultdict(list)
    consistency_failures: dict[str, list[str]] = defaultdict(list)

    # A manifest entry is one source frame. Repeating an identity, record
    # path, or record payload could inflate readiness counts without adding
    # corpus coverage, so reject those duplicates even within one split.
    unique_fields = {
        "recordId": [entry["recordId"] for entry in ctx.manifest["records"]],
        "path": [entry["path"] for entry in ctx.manifest["records"]],
        "sha256": [entry["sha256"] for entry in ctx.manifest["records"]],
    }
    for field_name, values in unique_fields.items():
        duplicates = sorted(
            value for value, count in Counter(values).items() if count > 1
        )
        if duplicates:
            consistency_failures["<manifest>"].append(
                f"duplicate record {field_name}: {duplicates}"
            )

    for entry in ctx.manifest["records"]:
        record_id = entry["recordId"]
        path = _safe_path(ctx.root, entry["path"])
        if path is None or not path.is_file():
            hash_failures[record_id] = "record file missing or outside the release"
            schema_failures[record_id] = ["record file missing"]
            continue
        data = path.read_bytes()
        if sha256_bytes(data) != entry["sha256"]:
            hash_failures[record_id] = "record file hash differs from manifest"
        try:
            record = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            schema_failures[record_id] = [f"unparseable: {error}"]
            continue
        errors = validation_errors(validator, record)
        ctx.record_valid[record_id] = not errors
        if errors:
            schema_failures[record_id] = errors
        if isinstance(record, dict):
            ctx.records[record_id] = record

        manifest_images = {image["path"]: image["sha256"] for image in entry["images"]}
        for image_rel, expected_sha in manifest_images.items():
            image_path = _safe_path(ctx.root, image_rel)
            if image_path is None or not image_path.is_file():
                image_failures[record_id].append(
                    f"{image_rel}: missing or outside the release"
                )
                continue
            image_bytes = image_path.read_bytes()
            if sha256_bytes(image_bytes) != expected_sha:
                image_failures[record_id].append(
                    f"{image_rel}: file hash differs from manifest"
                )
            if (
                isinstance(record, dict)
                and record.get("source", {}).get("path") == image_rel
            ):
                dimensions = png_dimensions(image_bytes)
                source = record["source"]
                if dimensions and dimensions != (
                    source.get("width"),
                    source.get("height"),
                ):
                    image_failures[record_id].append(
                        f"{image_rel}: PNG is {dimensions[0]}x{dimensions[1]} but record says {source.get('width')}x{source.get('height')}"
                    )
        if isinstance(record, dict):
            source = record.get("source", {})
            source_path = source.get("path")
            if source_path not in manifest_images:
                image_failures[record_id].append(
                    f"record source image {source_path!r} is not listed in the manifest entry"
                )
            elif source.get("sha256") != manifest_images[source_path]:
                image_failures[record_id].append(
                    "record source.sha256 differs from the manifest image hash"
                )

            if record.get("recordId") != record_id:
                consistency_failures[record_id].append(
                    "recordId differs between manifest and record"
                )
            try:
                derived = leakage_keys_from_record(record, ctx.manifest["sourceArchiveAliases"])
            except ValueError as error:
                consistency_failures[record_id].append(str(error))
                continue
            declared = entry["leakageKeys"]
            for key in (
                "sourceKind",
                "sourceArchiveId",
                "physicalCardIds",
                "sourceAssetIds",
            ):
                if declared.get(key) != derived.get(key):
                    consistency_failures[record_id].append(
                        f"leakageKeys.{key} is {declared.get(key)!r} in the manifest but {derived.get(key)!r} in the record"
                    )
            if declared.get("sessionId") != derived.get("sessionId"):
                consistency_failures[record_id].append(
                    f"leakageKeys.sessionId is {declared.get('sessionId')!r} in the manifest but {derived.get('sessionId')!r} in the record"
                )

    total = len(ctx.manifest["records"])
    if schema_failures:
        ctx.add(
            "RECORD_SCHEMA",
            FAIL,
            f"{len(schema_failures)} of {total} records violate the corpus-record schema",
            failures=schema_failures,
        )
    else:
        ctx.add(
            "RECORD_SCHEMA", PASS, f"all {total} records match the corpus-record schema"
        )
    if hash_failures:
        ctx.add(
            "RECORD_HASH",
            FAIL,
            f"{len(hash_failures)} record files do not match their manifest hash",
            failures=hash_failures,
        )
    else:
        ctx.add(
            "RECORD_HASH", PASS, f"all {total} record files match their manifest hash"
        )
    if image_failures:
        ctx.add(
            "IMAGE_HASH",
            FAIL,
            f"{len(image_failures)} records have image hash or dimension problems",
            failures=dict(image_failures),
        )
    else:
        ctx.add("IMAGE_HASH", PASS, "all images match their manifest and record hashes")
    if consistency_failures:
        ctx.add(
            "MANIFEST_RECORD_CONSISTENCY",
            FAIL,
            f"{len(consistency_failures)} manifest entries disagree with their records",
            failures=dict(consistency_failures),
        )
    else:
        ctx.add(
            "MANIFEST_RECORD_CONSISTENCY",
            PASS,
            "manifest leakage keys agree with record content",
        )


def _entries_with_records(
    ctx: Context,
) -> list[tuple[dict[str, Any], dict[str, Any] | None]]:
    assert ctx.manifest is not None
    return [
        (entry, ctx.records.get(entry["recordId"])) for entry in ctx.manifest["records"]
    ]


def check_leakage(ctx: Context) -> None:
    codes = (
        "LEAKAGE_KEYS_PRESENT",
        "LEAKAGE_DISJOINT",
        "EVAL_DENYLIST",
        "SPLIT_REAL_ONLY",
        "SOURCE_TIER",
    )
    if not ctx.manifest_valid:
        for code in codes:
            ctx.add(code, SKIP, "manifest invalid")
        return
    assert ctx.manifest is not None

    # Presence of required keys, by source kind, from the policy.
    if ctx.policy_valid:
        assert ctx.policy is not None
        required = ctx.policy["requiredLeakageKeys"]
        missing: dict[str, list[str]] = defaultdict(list)
        for entry, record in _entries_with_records(ctx):
            keys = entry["leakageKeys"]
            kind = keys["sourceKind"]
            for key in required.get(kind, []):
                if key == "sessionId" and not keys.get("sessionId"):
                    missing[entry["recordId"]].append("sessionId")
                elif key in ("physicalCardIds", "sourceAssetIds"):
                    instance_key = key[:-1]
                    instances = (
                        record.get("instances", []) if isinstance(record, dict) else []
                    )
                    if not keys.get(key) or any(
                        instance_key not in instance for instance in instances
                    ):
                        missing[entry["recordId"]].append(instance_key)
        if missing:
            ctx.add(
                "LEAKAGE_KEYS_PRESENT",
                FAIL,
                f"{len(missing)} records lack a required leakage key",
                missing=dict(missing),
            )
        else:
            ctx.add(
                "LEAKAGE_KEYS_PRESENT",
                PASS,
                "every record carries the leakage keys its source kind requires",
            )
    else:
        ctx.add("LEAKAGE_KEYS_PRESENT", SKIP, "policy invalid")

    # Disjointness across splits.
    seen: dict[tuple[str, str], set[str]] = defaultdict(set)
    alias_errors: dict[str, str] = {}
    aliases = ctx.manifest["sourceArchiveAliases"]
    for archive_id, canonical_id in aliases.items():
        if aliases.get(canonical_id) != canonical_id:
            alias_errors[archive_id] = "alias must point directly to a self-mapped canonical id"
    for entry in ctx.manifest["records"]:
        split = entry["split"]
        keys = entry["leakageKeys"]
        record = ctx.records.get(entry["recordId"])
        if record is not None and ctx.record_valid.get(entry["recordId"]):
            try:
                keys = leakage_keys_from_record(record, aliases)
            except ValueError as error:
                alias_errors[entry["recordId"]] = str(error)
        seen[("sourceArchiveId", keys["sourceArchiveId"])].add(split)
        assignment = ctx.manifest["splitAssignment"].get("archiveSplits")
        if assignment is not None and assignment.get(keys["sourceArchiveId"]) != split:
            alias_errors[entry["recordId"]] = "record split disagrees with computed archive assignment"
        if keys.get("sessionId"):
            seen[("sessionId", keys["sessionId"])].add(split)
        for value in keys.get("physicalCardIds", []):
            seen[("physicalCardId", value)].add(split)
        for value in keys.get("sourceAssetIds", []):
            seen[("sourceAssetId", value)].add(split)
        seen[("recordSha256", entry["sha256"])].add(split)
        for image in entry["images"]:
            seen[("imageSha256", image["sha256"])].add(split)
    leaks = {
        f"{kind}:{value}": sorted(splits)
        for (kind, value), splits in seen.items()
        if len(splits) > 1
    }
    if leaks or alias_errors:
        ctx.add(
            "LEAKAGE_DISJOINT",
            FAIL,
            f"{len(leaks)} leakage keys cross splits; {len(alias_errors)} archive mapping errors",
            leaks=leaks,
            **({"archiveAliasErrors": alias_errors} if alias_errors else {}),
        )
    else:
        ctx.add("LEAKAGE_DISJOINT", PASS, "no leakage key is shared between splits")

    # Frozen evaluation sessions may only appear in test.
    denylist = set(ctx.manifest["evaluationSessionDenylist"])
    violations = {
        entry["recordId"]: {
            "sessionId": entry["leakageKeys"]["sessionId"],
            "split": entry["split"],
        }
        for entry in ctx.manifest["records"]
        if entry["leakageKeys"].get("sessionId") in denylist
        and entry["split"] != "test"
    }
    if violations:
        ctx.add(
            "EVAL_DENYLIST",
            FAIL,
            f"{len(violations)} records from frozen evaluation sessions are outside the test split",
            violations=violations,
        )
    else:
        ctx.add(
            "EVAL_DENYLIST",
            PASS,
            "frozen evaluation sessions appear only in the test split",
            denylistedSessions=sorted(denylist),
        )

    # Synthetic records are forbidden in real-only splits.
    if ctx.policy_valid:
        assert ctx.policy is not None
        real_only = set(ctx.policy["realOnlySplits"])
        offenders = {
            entry["recordId"]: entry["split"]
            for entry in ctx.manifest["records"]
            if entry["split"] in real_only
            and entry["leakageKeys"]["sourceKind"] == "synthetic"
        }
        if offenders:
            ctx.add(
                "SPLIT_REAL_ONLY",
                FAIL,
                f"{len(offenders)} synthetic records sit in real-only splits",
                offenders=offenders,
            )
        else:
            ctx.add(
                "SPLIT_REAL_ONLY",
                PASS,
                "no synthetic records in real-only splits",
                realOnlySplits=sorted(real_only),
            )
    else:
        ctx.add("SPLIT_REAL_ONLY", SKIP, "policy invalid")

    # Immutable legacy smoke releases predate source tiers. New policies opt
    # into the gate; every record must then declare an admitted tier.
    if ctx.policy_valid:
        assert ctx.policy is not None
        allowed = ctx.policy.get("allowedSourceTiers")
        if allowed is None:
            if ctx.manifest["releasePurpose"] == "training":
                ctx.add(
                    "SOURCE_TIER",
                    FAIL,
                    "training policy must declare allowedSourceTiers",
                )
            else:
                ctx.add(
                    "SOURCE_TIER",
                    SKIP,
                    "legacy policy does not declare allowedSourceTiers",
                )
        else:
            allowed_set = set(allowed)
            offenders = {
                entry["recordId"]: entry.get("sourceTier", "missing")
                for entry in ctx.manifest["records"]
                if entry.get("sourceTier") not in allowed_set
            }
            if offenders:
                ctx.add(
                    "SOURCE_TIER",
                    FAIL,
                    f"{len(offenders)} records have a missing or disallowed source tier",
                    allowedSourceTiers=sorted(allowed_set),
                    offenders=offenders,
                )
            else:
                ctx.add(
                    "SOURCE_TIER",
                    PASS,
                    "every record belongs to a source tier admitted by policy",
                    allowedSourceTiers=sorted(allowed_set),
                )
    else:
        ctx.add("SOURCE_TIER", SKIP, "policy invalid")


def check_shared_fixtures(ctx: Context) -> None:
    """Re-run the model-agnostic contract fixtures inside this environment."""
    problems: list[str] = []
    try:
        nms = load_json(ctx.fixtures_dir / "validation-nms.v1.json")
        decimals = nms["roundingDecimals"]
        for case in nms["cases"]:
            actual = process_candidates(
                case["candidates"], case["config"], nms["modelIdentity"]
            )
            if canonical_round(actual, decimals) != case["expected"]:
                problems.append(f"validation-nms: {case['name']}")
        roundtrip = load_json(ctx.fixtures_dir / "context-letterbox-roundtrip.v1.json")
        transform = roundtrip["transform"]
        decimals = roundtrip["roundingDecimals"]
        for case in roundtrip["cases"]:
            model = forward_source_pixel(case["sourcePixel"], transform)
            if canonical_round(model, decimals) != case["modelPixel"]:
                problems.append(f"roundtrip forward: {case['name']}")
            recovered = canonical_round(inverse_model_pixel(model, transform), decimals)
            if recovered != case["recoveredSourcePixel"]:
                problems.append(f"roundtrip inverse: {case['name']}")
    except (OSError, KeyError, json.JSONDecodeError) as error:
        problems.append(f"fixtures unreadable: {error}")
    if problems:
        ctx.add(
            "SHARED_FIXTURES",
            FAIL,
            f"{len(problems)} shared geometry fixture cases failed",
            failures=problems,
        )
    else:
        ctx.add(
            "SHARED_FIXTURES",
            PASS,
            "shared validation/NMS and coordinate round-trip fixtures reproduce",
            fixturesDir=str(ctx.fixtures_dir),
        )


def corner_counts(ctx: Context) -> dict[str, Any]:
    """Annotation-side corner counts.

    `eligible` is every corner, `evaluated` those with a known coordinate,
    `skipped` those without. The evaluated corners divide further into
    `metricEligible` (known coordinate whose `cornerSource` is listed in the
    policy's `metricEligibleCornerSources`) and `metricExcluded` (known
    coordinate from any other or absent source). `evaluated` always equals
    `metricEligible + metricExcluded`. Per-source and per-visibility
    breakdowns are reported alongside.
    """
    if not ctx.manifest_valid:
        return {}
    eligible_sources: set[str] = (
        set(ctx.policy["metricEligibleCornerSources"])
        if ctx.policy_valid and ctx.policy is not None
        else set()
    )
    by_kind: dict[str, Counter] = defaultdict(Counter)
    by_slice: dict[str, Counter] = defaultdict(Counter)
    by_split: dict[str, Counter] = defaultdict(Counter)
    for entry, record in _entries_with_records(ctx):
        if not isinstance(record, dict):
            continue
        kind = entry["leakageKeys"]["sourceKind"]
        for instance in record.get("instances", []):
            for corner in instance.get("corners", []):
                known = bool(corner.get("coordinateKnown"))
                source = corner.get("cornerSource")
                for bucket in (
                    by_kind[kind],
                    by_slice[entry["sceneSlice"]],
                    by_split[entry["split"]],
                ):
                    bucket["eligible"] += 1
                    bucket["evaluated" if known else "skipped"] += 1
                    if known:
                        bucket[
                            "metricEligible"
                            if source in eligible_sources
                            else "metricExcluded"
                        ] += 1
                        bucket[f"cornerSource:{source or 'unknown'}"] += 1
                    bucket[f"visibility:{corner.get('visibility')}"] += 1

    def complete(bucket: Counter) -> dict[str, int]:
        # Always emit the headline counts, even when zero, so consumers never
        # have to treat a missing key as zero.
        return {
            "eligible": 0,
            "evaluated": 0,
            "skipped": 0,
            "metricEligible": 0,
            "metricExcluded": 0,
            **dict(sorted(bucket.items())),
        }

    return {
        "metricEligibleCornerSources": sorted(eligible_sources),
        "bySourceKind": {
            key: complete(value) for key, value in sorted(by_kind.items())
        },
        "bySceneSlice": {
            key: complete(value) for key, value in sorted(by_slice.items())
        },
        "bySplit": {key: complete(value) for key, value in sorted(by_split.items())},
    }


def check_readiness(ctx: Context) -> None:
    if not (ctx.manifest_valid and ctx.policy_valid):
        ctx.add("READINESS_MINIMUMS", SKIP, "manifest or policy invalid")
        return
    assert ctx.manifest is not None and ctx.policy is not None
    policy = ctx.policy
    records_per_split: Counter = Counter()
    instances_per_split: Counter = Counter()
    metric_eligible_instances_per_split: Counter = Counter()
    slice_instances: Counter = Counter()
    slice_metric_eligible_instances: Counter = Counter()
    test_real_sessions: set[str] = set()
    for entry, record in _entries_with_records(ctx):
        split = entry["split"]
        records_per_split[split] += 1
        count = len(record.get("instances", [])) if isinstance(record, dict) else 0
        instances_per_split[split] += count
        eligible_sources = set(policy["metricEligibleCornerSources"])
        if isinstance(record, dict):
            eligible_count = sum(
                len(instance.get("corners", [])) == 4
                and all(
                    corner.get("coordinateKnown")
                    and corner.get("cornerSource") in eligible_sources
                    for corner in instance.get("corners", [])
                )
                for instance in record.get("instances", [])
            )
            metric_eligible_instances_per_split[split] += eligible_count
            slice_metric_eligible_instances[(entry["sceneSlice"], split)] += eligible_count
        slice_instances[(entry["sceneSlice"], split)] += count
        if (
            split == "test"
            and entry["leakageKeys"]["sourceKind"] == "real"
            and entry["leakageKeys"].get("sessionId")
        ):
            test_real_sessions.add(entry["leakageKeys"]["sessionId"])

    shortfalls: list[str] = []
    if (
        ctx.manifest["releasePurpose"] == "training"
        and "minimumMetricEligibleInstances" not in policy
    ):
        shortfalls.append("training policy omits minimumMetricEligibleInstances")
    for split in policy["requiredSplits"]:
        if records_per_split[split] == 0:
            shortfalls.append(f"required split {split} has no records")
    for split, minimum in policy["minimumRecordsPerSplit"].items():
        if records_per_split[split] < minimum:
            shortfalls.append(
                f"{split}: {records_per_split[split]} records < {minimum}"
            )
    for split, minimum in policy["minimumInstancesPerSplit"].items():
        if instances_per_split[split] < minimum:
            shortfalls.append(
                f"{split}: {instances_per_split[split]} instances < {minimum}"
            )
    for split, minimum in policy.get("minimumMetricEligibleInstances", {}).items():
        if metric_eligible_instances_per_split[split] < minimum:
            shortfalls.append(
                f"{split}: {metric_eligible_instances_per_split[split]} metric-eligible instances < {minimum}"
            )
    if len(test_real_sessions) < policy["minimumRealEvaluationSessions"]:
        shortfalls.append(
            f"test: {len(test_real_sessions)} real sessions < {policy['minimumRealEvaluationSessions']}"
        )
    for requirement in policy["requiredSceneSlices"]:
        key = (requirement["sceneSlice"], requirement["split"])
        if slice_instances[key] < requirement["minimumInstances"]:
            shortfalls.append(
                f"{requirement['split']}/{requirement['sceneSlice']}: {slice_instances[key]} instances < {requirement['minimumInstances']}"
            )
        metric_minimum = requirement.get("minimumMetricEligibleInstances")
        if metric_minimum is None and ctx.manifest["releasePurpose"] == "training":
            shortfalls.append(
                f"{requirement['split']}/{requirement['sceneSlice']}: policy omits minimumMetricEligibleInstances"
            )
        elif (
            metric_minimum is not None
            and slice_metric_eligible_instances[key] < metric_minimum
        ):
            shortfalls.append(
                f"{requirement['split']}/{requirement['sceneSlice']}: "
                f"{slice_metric_eligible_instances[key]} metric-eligible instances < {metric_minimum}"
            )

    reported_slice_keys = sorted(
        set(slice_instances)
        | set(slice_metric_eligible_instances)
        | {
            (requirement["sceneSlice"], requirement["split"])
            for requirement in policy["requiredSceneSlices"]
        }
    )
    details = {
        "policyId": policy["policyId"],
        "recordsPerSplit": {split: records_per_split[split] for split in SPLITS},
        "instancesPerSplit": {split: instances_per_split[split] for split in SPLITS},
        "metricEligibleInstancesPerSplit": {
            split: metric_eligible_instances_per_split[split] for split in SPLITS
        },
        "testRealSessions": sorted(test_real_sessions),
        "sceneSliceInstances": {
            f"{split}/{scene}": slice_instances[(scene, split)]
            for scene, split in reported_slice_keys
        },
        "sceneSliceMetricEligibleInstances": {
            f"{split}/{scene}": slice_metric_eligible_instances[(scene, split)]
            for scene, split in reported_slice_keys
        },
    }
    if shortfalls:
        ctx.add(
            "READINESS_MINIMUMS",
            FAIL,
            f"{len(shortfalls)} readiness minimums unmet",
            shortfalls=shortfalls,
            **details,
        )
    else:
        ctx.add(
            "READINESS_MINIMUMS",
            PASS,
            "release meets its readiness policy minimums",
            **details,
        )


def check_purpose(ctx: Context) -> None:
    if not ctx.manifest_valid:
        ctx.add("RELEASE_PURPOSE", SKIP, "manifest invalid")
        return
    assert ctx.manifest is not None
    purpose = ctx.manifest["releasePurpose"]
    expected = ctx.expectations.purpose
    if expected and purpose != expected:
        ctx.add(
            "RELEASE_PURPOSE",
            FAIL,
            f"release purpose is {purpose!r} but the caller requires {expected!r}",
            releasePurpose=purpose,
            expectedPurpose=expected,
        )
    else:
        ctx.add(
            "RELEASE_PURPOSE",
            PASS,
            f"release purpose is {purpose!r}",
            releasePurpose=purpose,
            expectedPurpose=expected,
        )


def ready_for(ctx: Context) -> str:
    if ctx.failed() or not ctx.manifest_valid:
        return "none"
    assert ctx.manifest is not None
    return "training" if ctx.manifest["releasePurpose"] == "training" else "tooling"


def detect_tooling_revision() -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(REPOSITORY), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() or None


def run_preflight(
    release_root: Path,
    *,
    expectations: Expectations | None = None,
    fixtures_dir: Path = FIXTURES_DIR,
    tooling_revision: str | None = None,
) -> dict[str, Any]:
    ctx = Context(
        root=release_root,
        fixtures_dir=fixtures_dir,
        expectations=expectations or Expectations(),
        tooling_revision=tooling_revision
        if tooling_revision is not None
        else detect_tooling_revision(),
    )
    check_manifest(ctx)
    check_policy(ctx)
    check_corpus_hash(ctx)
    check_records(ctx)
    check_leakage(ctx)
    check_shared_fixtures(ctx)
    counts = corner_counts(ctx)
    ctx.add(
        "CORNER_COUNTS",
        PASS if ctx.manifest_valid else SKIP,
        "annotation corner counts recorded"
        if ctx.manifest_valid
        else "manifest invalid",
        **counts,
    )
    check_readiness(ctx)
    check_purpose(ctx)

    order = {code: index for index, code in enumerate(CHECK_ORDER)}
    checks = sorted(ctx.checks, key=lambda check: order.get(check.code, len(order)))
    manifest = ctx.manifest if ctx.manifest_valid else None
    return {
        "schema": REPORT_SCHEMA_ID,
        "releaseRoot": str(release_root),
        "releaseId": manifest["releaseId"] if manifest else None,
        "releasePurpose": manifest["releasePurpose"] if manifest else None,
        "declaredCorpusHash": manifest["corpusHash"] if manifest else None,
        "recomputedCorpusHash": corpus_hash(manifest) if manifest else None,
        "readinessPolicyId": manifest["readiness"]["readinessPolicyId"]
        if manifest
        else None,
        "readinessPolicySha256": manifest["readiness"]["readinessPolicySha256"]
        if manifest
        else None,
        "expectations": {
            "corpusHash": ctx.expectations.corpus_hash,
            "policySha256": ctx.expectations.policy_sha256,
            "policyId": ctx.expectations.policy_id,
            "purpose": ctx.expectations.purpose,
        },
        "toolingRevision": ctx.tooling_revision,
        "checks": [check.as_dict() for check in checks],
        "failedChecks": sorted(
            ctx.failed(), key=lambda code: order.get(code, len(order))
        ),
        "cornerCounts": counts,
        "readyFor": ready_for(ctx),
    }


def exit_code_for(report: dict[str, Any]) -> int:
    failed = set(report["failedChecks"])
    if "MANIFEST_LOAD" in failed:
        return EXIT_UNREADABLE
    return EXIT_CHECKS_FAILED if failed else EXIT_OK


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--report", type=Path, help="Write the JSON report here")
    parser.add_argument(
        "--expected-corpus-hash",
        help="Fail CORPUS_HASH unless the release declares this corpus hash",
    )
    parser.add_argument(
        "--expected-policy-sha256",
        help="Fail POLICY_HASH unless the bound policy file has this hash",
    )
    parser.add_argument(
        "--expected-policy-id",
        help="Fail POLICY_HASH unless the bound policy has this id",
    )
    parser.add_argument(
        "--expected-purpose",
        choices=("fixture", "smoke", "training"),
        help="Fail RELEASE_PURPOSE unless the release declares this purpose",
    )
    parser.add_argument(
        "--tooling-revision",
        help="Git revision of the tooling (pass inside jobs where git is unavailable)",
    )
    parser.add_argument("--fixtures-dir", type=Path, default=FIXTURES_DIR)
    parser.add_argument(
        "--print-report",
        action="store_true",
        help=f"Print the JSON report between {REPORT_MARKER_BEGIN} and {REPORT_MARKER_END} markers",
    )
    args = parser.parse_args(argv)

    report = run_preflight(
        args.release_root,
        expectations=Expectations(
            corpus_hash=args.expected_corpus_hash,
            policy_sha256=args.expected_policy_sha256,
            policy_id=args.expected_policy_id,
            purpose=args.expected_purpose,
        ),
        fixtures_dir=args.fixtures_dir,
        tooling_revision=args.tooling_revision,
    )
    for check in report["checks"]:
        print(f"{check['status']:<5} {check['code']:<28} {check['message']}")
    print(f"readyFor: {report['readyFor']}")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        print(f"report: {args.report}")
    if args.print_report:
        print(REPORT_MARKER_BEGIN)
        print(json.dumps(report, sort_keys=True))
        print(REPORT_MARKER_END)
    return exit_code_for(report)


if __name__ == "__main__":
    sys.exit(main())
