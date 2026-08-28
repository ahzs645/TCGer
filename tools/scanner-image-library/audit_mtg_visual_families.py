#!/usr/bin/env python3
"""Audit MTG catalog reprints, reused art, split leakage, and index collisions.

The scanner's compact metadata intentionally keeps only runtime fields.  This
tool joins it back to the matching Scryfall bulk snapshot by canonical image
URL, then distinguishes:

* duplicate runtime rows or image URLs (usually defects);
* multiple visible faces for one Scryfall printing (intentional);
* reprints sharing an Oracle rules identity (intentional catalog structure);
* printings sharing an illustration (a recognition family that must not leak
  across training/evaluation partitions); and
* identical or near-identical rows in an exported int8 scanner index.

It is read-only and does not download card images.  The resulting JSON is an
inspectable gate for catalog/image-library preparation and model evaluation.
"""

from __future__ import annotations

import argparse
import collections
import gzip
import hashlib
import json
import struct
from pathlib import Path
from typing import Iterable, Iterator
from urllib.parse import urlsplit, urlunsplit

import numpy as np


SCHEMA_VERSION = 1


def canonical_url(value: str) -> str:
    parsed = urlsplit(value)
    return urlunsplit((parsed.scheme.casefold(), parsed.netloc.casefold(), parsed.path, "", ""))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def json_records(path: Path) -> Iterator[dict]:
    with path.open("rb") as raw_source:
        is_gzip = raw_source.read(2) == b"\x1f\x8b"
    opener = gzip.open if is_gzip else open
    with opener(path, "rt", encoding="utf-8") as source:
        first = source.read(1)
        source.seek(0)
        if first == "[":
            payload = json.load(source)
            if not isinstance(payload, list):
                raise ValueError(f"expected an array in {path}")
            yield from payload
            return
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"expected an object at {path}:{line_number}")
            yield value


def scryfall_faces(path: Path) -> Iterator[dict]:
    for card in json_records(path):
        if card.get("object") != "card" or card.get("digital"):
            continue
        if "paper" not in (card.get("games") or []):
            continue
        faces = [card] if card.get("image_uris") else [
            face for face in card.get("card_faces") or [] if face.get("image_uris")
        ]
        for face_index, face in enumerate(faces):
            image_uris = face.get("image_uris") or {}
            image_url = image_uris.get("normal") or image_uris.get("large")
            if not image_url:
                continue
            yield {
                "cardId": str(card["id"]),
                "oracleId": face.get("oracle_id") or card.get("oracle_id"),
                "illustrationId": face.get("illustration_id") or card.get("illustration_id"),
                "name": face.get("name") or card.get("name"),
                "compoundName": card.get("name"),
                "setCode": card.get("set"),
                "setName": card.get("set_name"),
                "setType": card.get("set_type"),
                "collectorNumber": card.get("collector_number"),
                "layout": card.get("layout"),
                "faceIndex": face_index,
                "side": "back" if "/back/" in image_url else "front",
                "imageURL": image_url,
                "canonicalImageURL": canonical_url(image_url),
            }


def group_profile(rows: Iterable[dict], key: str) -> dict:
    counts = collections.Counter(row.get(key) for row in rows if row.get(key))
    repeated = [count for count in counts.values() if count > 1]
    return {
        "unique": len(counts),
        "repeatedGroups": len(repeated),
        "affectedRows": sum(repeated),
        "extraRows": sum(count - 1 for count in repeated),
        "largestGroup": max(counts.values(), default=0),
    }


def top_groups(rows: list[dict], key: str, limit: int = 20) -> list[dict]:
    grouped: dict[str, list[dict]] = collections.defaultdict(list)
    for row in rows:
        value = row.get(key)
        if value:
            grouped[str(value)].append(row)
    output = []
    for value, members in sorted(grouped.items(), key=lambda item: (-len(item[1]), item[0])):
        if len(members) < 2:
            continue
        output.append({
            "id": value,
            "rows": len(members),
            "name": members[0].get("name"),
            "oracleIdentities": len({row.get("oracleId") for row in members if row.get("oracleId")}),
            "illustrations": len({row.get("illustrationId") for row in members if row.get("illustrationId")}),
            "sets": sorted({str(row.get("setCode")) for row in members if row.get("setCode")}),
        })
        if len(output) >= limit:
            break
    return output


def current_visual_identity(row: dict) -> str:
    supplied = row.get("visualIdentityId")
    if supplied:
        return str(supplied)
    key = f"magic:{row['cardId']}:{row['side']}"
    return "vi_" + hashlib.sha256(key.encode()).hexdigest()[:32]


def partition_for(visual_identity_id: str) -> str:
    bucket = int(hashlib.sha256(visual_identity_id.encode()).hexdigest()[:8], 16) % 100
    if bucket < 90:
        return "train"
    if bucket < 95:
        return "validation"
    return "test"


def split_leakage(rows: list[dict]) -> dict:
    groups: dict[str, list[dict]] = collections.defaultdict(list)
    for row in rows:
        if row.get("illustrationId"):
            groups[str(row["illustrationId"])].append(row)
    repeated = [members for members in groups.values() if len(members) > 1]
    spanning = 0
    evaluation_rows = 0
    evaluation_rows_with_train_twin = 0
    for members in repeated:
        partitions = {
            partition_for(current_visual_identity(row))
            for row in members
        }
        if len(partitions) > 1:
            spanning += 1
        for row in members:
            if partition_for(current_visual_identity(row)) == "train":
                continue
            evaluation_rows += 1
            if "train" in partitions:
                evaluation_rows_with_train_twin += 1
    return {
        "groupingKey": "Scryfall illustration_id",
        "currentPartitionKey": "per-printing visualIdentityId",
        "repeatedIllustrationGroups": len(repeated),
        "groupsSpanningPartitions": spanning,
        "groupsSpanningPartitionsRate": spanning / len(repeated) if repeated else 0,
        "evaluationRows": evaluation_rows,
        "evaluationRowsWithTrainIllustrationTwin": evaluation_rows_with_train_twin,
        "evaluationLeakageRate": (
            evaluation_rows_with_train_twin / evaluation_rows if evaluation_rows else 0
        ),
    }


def read_vectors(path: Path, expected_count: int) -> np.ndarray:
    with path.open("rb") as source:
        header = source.read(8)
        if len(header) != 8:
            raise ValueError(f"truncated vector header: {path}")
        count, dimension = struct.unpack("<II", header)
        payload = source.read()
    if count != expected_count:
        raise ValueError(f"vector count {count} does not match metadata count {expected_count}")
    expected_bytes = count * dimension
    if len(payload) != expected_bytes:
        raise ValueError(f"vector payload is {len(payload)} bytes, expected {expected_bytes}")
    return np.frombuffer(payload, dtype=np.int8).reshape(count, dimension)


def collision_member(row: dict) -> dict:
    return {
        "annIndex": row["annIndex"],
        "cardId": row["cardId"],
        "oracleId": row.get("oracleId"),
        "illustrationId": row.get("illustrationId"),
        "name": row.get("name"),
        "setCode": row.get("setCode"),
        "collectorNumber": row.get("collectorNumber"),
        "layout": row.get("layout"),
        "side": row.get("side"),
    }


def vector_audit(rows: list[dict], vectors_path: Path) -> dict:
    quantized = read_vectors(vectors_path, len(rows))
    norms = np.linalg.norm(quantized.astype(np.float32), axis=1)
    if np.any(norms == 0):
        normalized = quantized.astype(np.float32)
        normalized[norms > 0] /= norms[norms > 0, None]
    else:
        normalized = quantized.astype(np.float32) / norms[:, None]

    exact_groups: dict[str, list[int]] = collections.defaultdict(list)
    for index, vector in enumerate(quantized):
        exact_groups[hashlib.sha256(vector.tobytes()).hexdigest()].append(index)
    collisions = [indices for indices in exact_groups.values() if len(indices) > 1]
    collisions.sort(key=lambda indices: (-len(indices), indices[0]))
    art_series_back_groups = [
        indices for indices in collisions
        if all(
            rows[index].get("layout") == "art_series"
            and rows[index].get("setType") == "memorabilia"
            and rows[index].get("side") == "back"
            for index in indices
        )
    ]
    art_series_rows = sum(len(indices) for indices in art_series_back_groups)

    illustration_groups: dict[str, list[int]] = collections.defaultdict(list)
    for index, row in enumerate(rows):
        if row.get("illustrationId"):
            illustration_groups[str(row["illustrationId"])].append(index)
    pair_similarities: list[np.ndarray] = []
    nearest_twins: list[np.ndarray] = []
    family_best_pairs = []
    for illustration_id, indices in illustration_groups.items():
        if len(indices) < 2:
            continue
        similarities = normalized[indices] @ normalized[indices].T
        upper = np.triu_indices(len(indices), 1)
        pair_similarities.append(similarities[upper])
        np.fill_diagonal(similarities, -2)
        nearest_twins.append(similarities.max(axis=1))
        flat_index = int(np.argmax(similarities))
        left, right = np.unravel_index(flat_index, similarities.shape)
        family_best_pairs.append({
            "illustrationId": illustration_id,
            "familyRows": len(indices),
            "cosineSimilarity": float(similarities[left, right]),
            "left": collision_member(rows[indices[left]]),
            "right": collision_member(rows[indices[right]]),
        })

    pairs = np.concatenate(pair_similarities) if pair_similarities else np.array([], dtype=np.float32)
    twins = np.concatenate(nearest_twins) if nearest_twins else np.array([], dtype=np.float32)
    thresholds = (0.90, 0.95, 0.98, 0.99, 0.995)
    non_art_collisions = [indices for indices in collisions if indices not in art_series_back_groups]
    return {
        "path": str(vectors_path),
        "sha256": sha256_file(vectors_path),
        "count": len(rows),
        "dimension": int(quantized.shape[1]),
        "zeroVectors": int(np.count_nonzero(norms == 0)),
        "exactQ8VectorCollisions": {
            "groups": len(collisions),
            "affectedRows": sum(len(indices) for indices in collisions),
            "extraRows": sum(len(indices) - 1 for indices in collisions),
            "largestGroup": max((len(indices) for indices in collisions), default=0),
            "artSeriesBackGroups": len(art_series_back_groups),
            "artSeriesBackRows": art_series_rows,
            "otherGroups": len(non_art_collisions),
            "otherAffectedRows": sum(len(indices) for indices in non_art_collisions),
            "otherCrossOracleGroups": sum(
                len({rows[index].get("oracleId") for index in indices}) > 1
                for indices in non_art_collisions
            ),
            "largestExamples": [
                {
                    "rows": len(indices),
                    "oracleIdentities": len({rows[index].get("oracleId") for index in indices}),
                    "members": [collision_member(rows[index]) for index in indices[:12]],
                }
                for indices in collisions[:20]
            ],
        },
        "sameIllustrationSimilarity": {
            "pairs": int(pairs.size),
            "mean": float(pairs.mean()) if pairs.size else None,
            "quantiles": {
                str(quantile): float(np.quantile(pairs, quantile))
                for quantile in (0.1, 0.5, 0.9, 0.95, 0.99)
            } if pairs.size else {},
            "pairsAtOrAbove": {
                str(threshold): int(np.count_nonzero(pairs >= threshold))
                for threshold in thresholds
            },
            "pairRatesAtOrAbove": {
                str(threshold): float(np.mean(pairs >= threshold)) if pairs.size else 0
                for threshold in thresholds
            },
            "rowsWithNearestTwinAtOrAbove095": int(np.count_nonzero(twins >= 0.95)),
            "rowsWithRepeatedIllustration": int(twins.size),
            "nearestTwinAtOrAbove095Rate": float(np.mean(twins >= 0.95)) if twins.size else 0,
            "highestSimilarityFamilies": sorted(
                family_best_pairs,
                key=lambda pair: (-pair["cosineSimilarity"], pair["illustrationId"]),
            )[:30],
        },
    }


def audit(metadata_path: Path, bulk_path: Path, vectors_path: Path | None = None) -> dict:
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if not isinstance(metadata, list):
        raise ValueError(f"expected an array in {metadata_path}")
    indices = [row.get("annIndex") for row in metadata]
    if indices != list(range(len(metadata))):
        raise ValueError("metadata annIndex values must be contiguous and ordered")

    source_rows = list(scryfall_faces(bulk_path))
    source_by_url = {row["canonicalImageURL"]: row for row in source_rows}
    metadata_urls = [canonical_url(str(row.get("imageURL") or "")) for row in metadata]
    enriched = []
    missing_from_source = []
    for metadata_row, image_url in zip(metadata, metadata_urls):
        source_row = source_by_url.get(image_url)
        if source_row is None:
            missing_from_source.append({
                "annIndex": metadata_row.get("annIndex"),
                "cardId": metadata_row.get("cardId"),
                "name": metadata_row.get("name"),
                "imageURL": metadata_row.get("imageURL"),
            })
            continue
        enriched.append({**metadata_row, **source_row})
    metadata_url_set = set(metadata_urls)
    new_source_rows = [
        row for row in source_rows if row["canonicalImageURL"] not in metadata_url_set
    ]

    runtime_row_counts = collections.Counter(
        (row.get("cardId"), canonical_url(str(row.get("imageURL") or "")))
        for row in metadata
    )
    exact_runtime_duplicates = [count for count in runtime_row_counts.values() if count > 1]
    result = {
        "schemaVersion": SCHEMA_VERSION,
        "status": "ready" if not missing_from_source else "needs-review",
        "inputs": {
            "metadata": {
                "path": str(metadata_path),
                "sha256": sha256_file(metadata_path),
                "rows": len(metadata),
            },
            "scryfallBulk": {
                "path": str(bulk_path),
                "sha256": sha256_file(bulk_path),
                "eligibleVisibleFaces": len(source_rows),
            },
        },
        "catalogJoin": {
            "matchedRows": len(enriched),
            "missingFromCurrentSource": len(missing_from_source),
            "missingExamples": missing_from_source[:20],
            "newCurrentSourceRows": len(new_source_rows),
            "newCurrentSourceExamples": [collision_member({**row, "annIndex": None}) for row in new_source_rows[:20]],
        },
        "quality": {
            "exactRuntimeDuplicateGroups": len(exact_runtime_duplicates),
            "exactRuntimeDuplicateRows": sum(exact_runtime_duplicates),
            "canonicalImageURL": group_profile(enriched, "canonicalImageURL"),
            "cardId": group_profile(enriched, "cardId"),
            "oracleId": group_profile(enriched, "oracleId"),
            "illustrationId": group_profile(enriched, "illustrationId"),
            "topOracleFamilies": top_groups(enriched, "oracleId"),
            "topIllustrationFamilies": top_groups(enriched, "illustrationId"),
        },
        "splitLeakage": split_leakage(enriched),
    }
    if vectors_path is not None:
        if len(enriched) != len(metadata):
            raise ValueError("cannot align vectors while metadata rows are missing from the Scryfall source")
        result["vectors"] = vector_audit(enriched, vectors_path)
    findings = []
    if missing_from_source:
        findings.append({
            "severity": "high",
            "code": "catalog-source-join-gap",
            "rows": len(missing_from_source),
            "message": "Runtime metadata rows no longer join to the reviewed Scryfall snapshot.",
        })
    if new_source_rows:
        findings.append({
            "severity": "medium",
            "code": "catalog-update-available",
            "rows": len(new_source_rows),
            "message": "The reviewed Scryfall snapshot contains visible paper faces absent from the released index.",
        })
    leakage = result["splitLeakage"]
    if leakage["evaluationRowsWithTrainIllustrationTwin"]:
        findings.append({
            "severity": "high",
            "code": "illustration-split-leakage",
            "rows": leakage["evaluationRowsWithTrainIllustrationTwin"],
            "message": "Evaluation rows share a Scryfall illustration with the training partition.",
        })
    vector_result = result.get("vectors")
    if vector_result:
        collisions = vector_result["exactQ8VectorCollisions"]
        if collisions["artSeriesBackRows"]:
            findings.append({
                "severity": "high",
                "code": "non-identifying-art-series-backs",
                "rows": collisions["artSeriesBackRows"],
                "message": "Generic Art Series reverse faces collapse to repeated scanner vectors.",
            })
        if collisions["otherCrossOracleGroups"]:
            findings.append({
                "severity": "high",
                "code": "cross-oracle-vector-collision",
                "groups": collisions["otherCrossOracleGroups"],
                "message": "Distinct Oracle identities have byte-identical exported int8 vectors.",
            })
    result["findings"] = findings
    if findings:
        result["status"] = "needs-review"
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--scryfall-bulk", type=Path, required=True)
    parser.add_argument("--vectors", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = audit(args.metadata, args.scryfall_bulk, args.vectors)
    rendered = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()
