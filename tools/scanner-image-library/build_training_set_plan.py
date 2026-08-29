#!/usr/bin/env python3
"""Build a small, game-neutral scanner TrainingSetPlan without image I/O.

The plan is the authority for which catalog references train the encoder and
which references form leakage-safe validation/test cohorts. It never downloads
card images. Optional validated-library manifests attach immutable shard/blob
locations so a later trainer can materialize only the selected samples.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import urllib.parse
from collections import defaultdict
from pathlib import Path
from typing import Iterable, Iterator


SCHEMA = "tcger-training-set-plan-v1"
SPLIT_POLICY = "recognition-family-sha256-90-5-5-v1"
SELECTION_POLICY = "family-representatives-v1"


class PlanError(RuntimeError):
    pass


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest_text(*parts: str) -> str:
    return hashlib.sha256("\0".join(parts).encode()).hexdigest()


def load_records(path: Path) -> Iterator[dict]:
    with path.open(encoding="utf-8") as source:
        first = source.read(1)
        source.seek(0)
        if first == "[":
            payload = json.load(source)
            if not isinstance(payload, list):
                raise PlanError(f"expected an array in {path}")
            yield from payload
            return
        for line_number, line in enumerate(source, 1):
            if line.strip():
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise PlanError(f"expected an object at {path}:{line_number}")
                yield value


def normalize_game(value: object) -> str:
    game = str(value or "").strip().casefold()
    aliases = {"mtg": "magic", "pokémon": "pokemon", "yu-gi-oh": "yugioh", "yu_gi_oh": "yugioh"}
    return aliases.get(game, game)


def is_pokemon_pocket(row: dict) -> bool:
    if normalize_game(row.get("game")) != "pokemon":
        return False
    series = row.get("series")
    values = [row.get("format"), row.get("gameFormat"), row.get("setSeries")]
    if isinstance(series, dict):
        values.extend((series.get("id"), series.get("name")))
    else:
        values.append(series)
    return any(str(value or "").strip().casefold() in {"pocket", "tcgp"} for value in values) or \
        "/tcgp/" in str(row.get("imageURL") or row.get("imageUrl") or "").casefold()


def source_locator(row: dict, catalog: Path) -> tuple[str, str]:
    image_path = row.get("imagePath") or row.get("image_path")
    if image_path:
        return "file", str(image_path)
    url = str(row.get("imageURL") or row.get("imageUrl") or row.get("image_url") or "").strip()
    if not url:
        raise PlanError(f"catalog row has no image reference: {catalog}:{row.get('cardId')}")
    parsed = urllib.parse.urlsplit(url)
    canonical = urllib.parse.urlunsplit((parsed.scheme.casefold(), parsed.netloc.casefold(), parsed.path, "", ""))
    return "url", canonical


def visual_identity(row: dict, game: str, locator: str) -> tuple[str, str]:
    discriminator = ""
    for key in ("visualIdentityId", "visual_identity_id", "artworkId", "artwork_id"):
        value = str(row.get(key) or "").strip()
        if value:
            discriminator = value
            break
    card_id = str(row.get("cardId") or row.get("card_id") or "").strip()
    if not card_id:
        raise PlanError("every catalog row requires cardId")
    if not discriminator and game == "magic":
        path = urllib.parse.urlparse(locator).path.casefold()
        discriminator = "back" if "/back/" in path else ("front" if "/front/" in path else "")
    identity_key = f"{game}:{card_id}" + (f":{discriminator}" if discriminator else "")
    return identity_key, "vi_" + digest_text(identity_key)[:32]


def recognition_family(row: dict, visual_id: str) -> str:
    for key in (
        "recognitionFamilyId", "recognition_family_id", "illustrationId",
        "illustration_id", "artworkId", "artwork_id",
    ):
        value = str(row.get(key) or "").strip()
        if value:
            return value
    return visual_id


def split_for(family_id: str) -> str:
    bucket = int(hashlib.sha256(family_id.encode()).hexdigest()[:8], 16) % 100
    return "train" if bucket < 90 else ("validation" if bucket < 95 else "test")


def representative_rank(sample: dict) -> tuple[str, str, str, str]:
    return (
        str(sample.get("releaseDate") or ""),
        str(sample.get("setCode") or ""),
        str(sample.get("collectorNumber") or ""),
        str(sample["sampleId"]),
    )


def parse_key_values(items: Iterable[str], label: str) -> dict[str, str]:
    output: dict[str, str] = {}
    for item in items:
        if "=" not in item:
            raise PlanError(f"{label} must use GAME=VALUE")
        game, value = item.split("=", 1)
        game = normalize_game(game)
        if not game or not value:
            raise PlanError(f"{label} must use non-empty GAME=VALUE")
        if game in output and output[game] != value:
            raise PlanError(f"conflicting {label} for {game}")
        output[game] = value
    return output


def load_validated_manifests(paths: dict[str, str]) -> dict[str, dict[str, dict]]:
    manifests: dict[str, dict[str, dict]] = {}
    for game, raw_path in paths.items():
        rows: dict[str, dict] = {}
        for row in load_records(Path(raw_path)):
            sample_id = str(row.get("sampleId") or "")
            if sample_id:
                rows[sample_id] = row
        manifests[game] = rows
    return manifests


def write_json(path: Path, value: object) -> None:
    path.write_text(canonical_json(value) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: Iterable[dict]) -> str:
    data = "".join(canonical_json(row) + "\n" for row in rows).encode()
    path.write_bytes(data)
    return sha256_bytes(data)


def build_plan(args: argparse.Namespace) -> dict:
    if args.output.exists():
        raise PlanError(f"output already exists: {args.output}")
    if args.training_samples_per_family < 1 or args.evaluation_samples_per_family < 1:
        raise PlanError("family sample caps must be at least 1")

    revisions = parse_key_values(args.source_revision, "--source-revision")
    manifest_paths = parse_key_values(args.validated_manifest, "--validated-manifest")
    repos = parse_key_values(args.validated_repo, "--validated-repo")
    library_revisions = parse_key_values(args.validated_revision, "--validated-revision")
    library_paths = parse_key_values(args.validated_path, "--validated-path")
    validated = load_validated_manifests(manifest_paths)

    samples: list[dict] = []
    catalog_contracts: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for catalog in args.catalog:
        catalog_bytes = catalog.read_bytes()
        catalog_games: set[str] = set()
        count = 0
        for row in load_records(catalog):
            game = normalize_game(row.get("game"))
            if not game:
                raise PlanError(f"catalog row has no game: {catalog}:{row.get('cardId')}")
            if is_pokemon_pocket(row):
                raise PlanError(f"physical scanner plan contains Pokemon Pocket row: {row.get('cardId')}")
            kind, locator = source_locator(row, catalog)
            identity_key, visual_id = visual_identity(row, game, locator)
            family_id = recognition_family(row, visual_id)
            sample_id = str(row.get("sampleId") or "sample_" + digest_text(visual_id, "catalog", locator)[:32])
            identity = (game, sample_id)
            if identity in seen:
                raise PlanError(f"duplicate sample identity: {game}:{sample_id}")
            seen.add(identity)
            card_id = str(row.get("cardId") or row.get("card_id"))
            samples.append({
                "schema": SCHEMA,
                "game": game,
                "sampleId": sample_id,
                "visualIdentityId": visual_id,
                "visualIdentityKey": identity_key,
                "catalogVisualIdentityId": row.get("visualIdentityId"),
                "recognitionFamilyId": family_id,
                "exactPrintingId": str(row.get("exactPrintingId") or card_id),
                "cardId": card_id,
                "name": row.get("name"),
                "setCode": row.get("setCode"),
                "collectorNumber": row.get("collectorNumber"),
                "releaseDate": row.get("releaseDate"),
                "sourceKind": kind,
                "sourceLocator": locator,
                "partition": split_for(family_id),
            })
            catalog_games.add(game)
            count += 1
        catalog_contracts.append({
            "file": catalog.name,
            "sha256": sha256_bytes(catalog_bytes),
            "rows": count,
            "games": sorted(catalog_games),
            "sourceRevisions": {game: revisions.get(game) for game in sorted(catalog_games)},
        })

    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for sample in samples:
        grouped[(sample["game"], sample["recognitionFamilyId"])].append(sample)

    selected: list[dict] = []
    families: list[dict] = []
    for (game, family_id), members in sorted(grouped.items()):
        partition = split_for(family_id)
        cap = args.training_samples_per_family if partition == "train" else args.evaluation_samples_per_family
        choices = sorted(members, key=representative_rank, reverse=True)[:cap]
        selected_ids = {row["sampleId"] for row in choices}
        materialized = 0
        for sample in choices:
            prior = validated.get(game, {}).get(sample["sampleId"])
            ready = bool(prior and prior.get("status") == "valid")
            if ready:
                materialized += 1
            sample["usage"] = "training" if partition == "train" else "evaluation"
            sample["selectionReason"] = "newest-family-representative" if len(choices) == 1 else "heldout-family-reference"
            sample["materialization"] = {
                "status": "validated" if ready else "needed",
                "repo": repos.get(game) if ready else None,
                "revision": library_revisions.get(game) if ready else None,
                "path": library_paths.get(game) if ready else None,
                "blobSha256": prior.get("blobSha256") if ready else None,
                "bytes": prior.get("bytes") if ready else None,
                "shard": prior.get("shard") if ready else None,
                "member": prior.get("member") if ready else None,
            }
            selected.append(sample)
        families.append({
            "schema": SCHEMA,
            "game": game,
            "recognitionFamilyId": family_id,
            "partition": partition,
            "usage": "training" if partition == "train" else "evaluation",
            "catalogMemberCount": len(members),
            "selectedSampleIds": sorted(selected_ids),
            "selectedCount": len(choices),
            "validatedCount": materialized,
        })

    selected.sort(key=lambda row: (row["game"], row["partition"], row["recognitionFamilyId"], row["sampleId"]))
    families.sort(key=lambda row: (row["game"], row["recognitionFamilyId"]))
    args.output.mkdir(parents=True)
    samples_sha = write_jsonl(args.output / "samples.jsonl", selected)
    families_sha = write_jsonl(args.output / "families.jsonl", families)

    games: dict[str, dict] = {}
    for game in sorted({row["game"] for row in samples}):
        game_catalog = [row for row in samples if row["game"] == game]
        game_selected = [row for row in selected if row["game"] == game]
        by_partition = {
            partition: sum(row["partition"] == partition for row in game_selected)
            for partition in ("train", "validation", "test")
        }
        validated_count = sum(row["materialization"]["status"] == "validated" for row in game_selected)
        games[game] = {
            "catalogRows": len(game_catalog),
            "families": sum(row["game"] == game for row in families),
            "selectedSamples": len(game_selected),
            "selectedByPartition": by_partition,
            "validatedSamples": validated_count,
            "neededImages": len(game_selected) - validated_count,
            "trainingReady": validated_count == len(game_selected),
        }

    root = {
        "schema": SCHEMA,
        "splitPolicy": SPLIT_POLICY,
        "selectionPolicy": {
            "name": SELECTION_POLICY,
            "trainingSamplesPerFamily": args.training_samples_per_family,
            "evaluationSamplesPerFamily": args.evaluation_samples_per_family,
            "selectionOccursBeforeImageMaterialization": True,
        },
        "identityContract": {
            "recognitionFamilyId": "visual class and split group",
            "exactPrintingId": "collection identity; never an encoder class",
            "futureGameRequirement": "normalized rows with game, cardId, image reference, and preferably recognitionFamilyId",
        },
        "files": {
            "samples": {"path": "samples.jsonl", "sha256": samples_sha, "rows": len(selected)},
            "families": {"path": "families.jsonl", "sha256": families_sha, "rows": len(families)},
        },
        "sourceCatalogs": catalog_contracts,
        "games": games,
        "summary": {
            "catalogRows": len(samples),
            "families": len(families),
            "selectedSamples": len(selected),
            "validatedSamples": sum(value["validatedSamples"] for value in games.values()),
            "neededImages": sum(value["neededImages"] for value in games.values()),
            "allGamesTrainingReady": all(value["trainingReady"] for value in games.values()),
        },
    }
    write_json(args.output / "training-set-plan.json", root)
    print(canonical_json(root["summary"]))
    return root


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--catalog", type=Path, action="append", required=True)
    result.add_argument("--output", type=Path, required=True)
    result.add_argument("--source-revision", action="append", default=[])
    result.add_argument("--validated-manifest", action="append", default=[])
    result.add_argument("--validated-repo", action="append", default=[])
    result.add_argument("--validated-revision", action="append", default=[])
    result.add_argument("--validated-path", action="append", default=[])
    result.add_argument("--training-samples-per-family", type=int, default=1)
    result.add_argument("--evaluation-samples-per-family", type=int, default=2)
    return result


def main() -> int:
    try:
        build_plan(parser().parse_args())
        return 0
    except (PlanError, OSError, json.JSONDecodeError) as error:
        print(canonical_json({"status": "error", "error": str(error)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
