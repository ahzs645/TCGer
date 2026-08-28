#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10,<3.14"
# ///
"""Plan catalog and image-library work from provider release metadata.

This stage never downloads card images. It snapshots small provider registries,
compares them with a previous ledger, and emits explicit actions for catalog
download, normalization, image probing, and sampled revalidation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Callable


SCHEMA_VERSION = 1
REQUEST_HEADERS = {
    "User-Agent": "TCGer scanner source planner/1.0 (https://github.com/ahzs645/TCGer)",
    "Accept": "application/json;q=0.9,*/*;q=0.8",
}


class PlannerError(RuntimeError):
    """Operator-actionable provider or configuration error."""


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def fingerprint(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def path_value(value: object, path: str | None, default=None):
    if not path:
        return value
    current = value
    for component in path.split("."):
        if isinstance(current, list):
            try:
                current = current[int(component)]
            except (ValueError, IndexError) as error:
                raise PlannerError(f"cannot resolve list path {path}") from error
        elif isinstance(current, dict) and component in current:
            current = current[component]
        else:
            return default
    return current


def normalize_date(value) -> str | None:
    if value in (None, ""):
        return None
    text = str(value).strip().replace("/", "-")
    return text[:10] if len(text) >= 10 else text


def normalized_set(**values) -> dict:
    expected = values.get("expectedCards")
    printed = values.get("printedCards")
    return {
        "setId": str(values.get("setId") or values.get("setCode") or values.get("name") or "").strip(),
        "setCode": str(values.get("setCode") or "").strip() or None,
        "name": str(values.get("name") or "").strip(),
        "releaseDate": normalize_date(values.get("releaseDate")),
        "expectedCards": int(expected) if expected not in (None, "") else None,
        "printedCards": int(printed) if printed not in (None, "") else None,
        "updatedAt": str(values.get("updatedAt") or "").strip() or None,
        "digital": bool(values.get("digital", False)),
        "setType": str(values.get("setType") or "").strip() or None,
    }


def sorted_sets(rows: list[dict]) -> list[dict]:
    rows = [row for row in rows if row["setId"] and row["name"] and not row["digital"]]
    duplicates = len(rows) - len({row["setId"] for row in rows})
    if duplicates:
        raise PlannerError(f"provider returned {duplicates} duplicate set identifiers")
    return sorted(rows, key=lambda row: (row["setId"], row["name"]))


def http_json(
    url: str,
    headers: dict[str, str] | None = None,
    timeout: float = 45.0,
    attempts: int = 4,
):
    request_headers = {**REQUEST_HEADERS, **(headers or {})}
    request = urllib.request.Request(url, headers=request_headers)
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
            retryable = not isinstance(error, urllib.error.HTTPError) or error.code in {408, 429, 500, 502, 503, 504}
            if attempt + 1 >= attempts or not retryable:
                raise PlannerError(f"provider request failed after {attempt + 1} attempt(s): {url}: {error}") from error
            time.sleep(2 ** attempt)


def with_query(url: str, **values: int) -> str:
    parsed = urllib.parse.urlsplit(url)
    query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
    query.update({key: str(value) for key, value in values.items()})
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(query), parsed.fragment))


@dataclass(frozen=True)
class ProviderSnapshot:
    game: str
    provider: str
    revision: str
    sets: list[dict]
    catalog: dict
    signals: list[dict]
    assumptions: list[dict]

    def ledger(self) -> dict:
        return {
            "game": self.game,
            "provider": self.provider,
            "revision": self.revision,
            "setsFingerprint": fingerprint(self.sets),
            "setCount": len(self.sets),
            "sets": self.sets,
            "catalog": self.catalog,
            "signals": self.signals,
            "assumptions": self.assumptions,
        }


def pokemon_snapshot(config: dict, fetch: Callable) -> ProviderSnapshot:
    headers = {}
    key_name = config.get("apiKeyEnvironment")
    if key_name and os.environ.get(key_name):
        headers["X-Api-Key"] = os.environ[key_name]
    registry_source = config["setsURL"]
    try:
        payload = fetch(registry_source, headers=headers)
    except PlannerError:
        registry_source = config.get("setsFallbackURL")
        if not registry_source:
            raise
        payload = fetch(registry_source)
    if isinstance(payload, list):
        source_rows = list(payload)
    else:
        source_rows = list(payload.get("data", []))
        total_count = int(payload.get("totalCount") or len(source_rows))
        page_size = int(payload.get("pageSize") or max(len(source_rows), 1))
        page = int(payload.get("page") or 1)
        while len(source_rows) < total_count:
            page += 1
            next_payload = fetch(with_query(registry_source, page=page, pageSize=page_size), headers=headers)
            next_rows = list(next_payload.get("data", []))
            if not next_rows:
                raise PlannerError("Pokémon set pagination ended before totalCount")
            source_rows.extend(next_rows)
    rows = sorted_sets([
        normalized_set(
            setId=row.get("id"), setCode=row.get("ptcgoCode"), name=row.get("name"),
            releaseDate=row.get("releaseDate"), expectedCards=row.get("total"),
            printedCards=row.get("printedTotal"), updatedAt=row.get("updatedAt"),
            setType=row.get("series"),
        )
        for row in source_rows
    ])
    revision = fingerprint([{"id": row["setId"], "total": row["expectedCards"], "updatedAt": row["updatedAt"]} for row in rows])
    return ProviderSnapshot(
        game=config["game"], provider=config["provider"], revision=revision, sets=rows,
        catalog={
            "kind": "paginated-json-api", "url": config["catalogURL"],
            "fallbackURL": config.get("catalogFallbackURL"),
            "revision": revision, "bytes": None,
        },
        signals=[
            {"name": "set-registry-source", "confidence": "high", "value": registry_source},
            {"name": "set-registry-fingerprint", "confidence": "high", "value": revision},
            {"name": "set-updated-at", "confidence": "high", "value": max((row["updatedAt"] or "" for row in rows), default="")},
        ],
        assumptions=[
            {"claim": "A new set, increased total, or changed updatedAt requires a card-catalog diff.", "risk": "low"},
            {"claim": "Unchanged set metadata implies unchanged card artwork.", "risk": "medium", "fallback": "weekly catalog diff plus rotating image audit"},
        ],
    )


def scryfall_snapshot(config: dict, fetch: Callable) -> ProviderSnapshot:
    bulk = fetch(config["catalogMetadataURL"])
    payload = fetch(config["setsURL"])
    rows = sorted_sets([
        normalized_set(
            setId=row.get("id"), setCode=row.get("code"), name=row.get("name"),
            releaseDate=row.get("released_at"), expectedCards=row.get("card_count"),
            updatedAt=row.get("updated_at"), digital=row.get("digital"),
            setType=row.get("set_type"),
        )
        for row in payload.get("data", [])
    ])
    revision = str(bulk.get("updated_at") or "")
    catalog_url = bulk.get("jsonl_download_uri") or bulk.get("download_uri")
    if not revision or not catalog_url:
        raise PlannerError("Scryfall bulk metadata lacks revision or download URI")
    return ProviderSnapshot(
        game=config["game"], provider=config["provider"], revision=revision, sets=rows,
        catalog={
            "kind": "jsonl-gzip" if str(catalog_url).endswith(".gz") else "json",
            "url": catalog_url, "revision": revision,
            "bytes": bulk.get("compressed_size") or bulk.get("size"),
        },
        signals=[
            {"name": "bulk-updated-at", "confidence": "high", "value": revision},
            {"name": "bulk-compressed-size", "confidence": "medium", "value": bulk.get("compressed_size")},
            {"name": "set-registry-fingerprint", "confidence": "high", "value": fingerprint(rows)},
        ],
        assumptions=[
            {"claim": "A changed bulk revision means catalog metadata changed, not necessarily artwork.", "risk": "low"},
            {"claim": "New sets or changed card counts should trigger immediate bulk normalization.", "risk": "low"},
        ],
    )


def ygoprodeck_snapshot(config: dict, fetch: Callable) -> ProviderSnapshot:
    version_payload = fetch(config["revisionURL"])
    version_row = version_payload[0] if isinstance(version_payload, list) and version_payload else version_payload
    revision = str(version_row.get("database_version") or version_row.get("last_update") or "")
    payload = fetch(config["setsURL"])
    rows = sorted_sets([
        normalized_set(
            setId=f"{row.get('set_code') or ''}:{row.get('set_name') or ''}",
            setCode=row.get("set_code"), name=row.get("set_name"),
            releaseDate=row.get("tcg_date"), expectedCards=row.get("num_of_cards"),
            updatedAt=None, setType="tcg-set",
        )
        for row in payload
    ])
    if not revision:
        raise PlannerError("YGOPRODeck database version is missing")
    return ProviderSnapshot(
        game=config["game"], provider=config["provider"], revision=revision, sets=rows,
        catalog={"kind": "json-api", "url": config["catalogURL"], "revision": revision, "bytes": None},
        signals=[
            {"name": "database-version", "confidence": "high", "value": revision},
            {"name": "database-last-update", "confidence": "high", "value": version_row.get("last_update")},
            {"name": "set-registry-fingerprint", "confidence": "high", "value": fingerprint(rows)},
        ],
        assumptions=[
            {"claim": "A changed database version requires a catalog diff because cards or metadata changed.", "risk": "low"},
            {"claim": "Images with unchanged artwork IDs normally reuse prior bytes.", "risk": "medium", "fallback": "rotating hash/decode audit"},
        ],
    )


def generic_snapshot(config: dict, fetch: Callable) -> ProviderSnapshot:
    set_config = config["sets"]
    payload = fetch(set_config["url"])
    items = path_value(payload, set_config.get("itemsPath"), [])
    fields = set_config["fields"]
    rows = sorted_sets([
        normalized_set(**{
            target: path_value(row, source)
            for target, source in fields.items()
        })
        for row in items
    ])
    revision_config = config.get("revision")
    if revision_config:
        revision_payload = fetch(revision_config["url"])
        revision = str(path_value(revision_payload, revision_config.get("path"), ""))
    else:
        revision = fingerprint(rows)
    catalog_config = config.get("catalog") or {}
    return ProviderSnapshot(
        game=config["game"], provider=config["provider"], revision=revision, sets=rows,
        catalog={
            "kind": catalog_config.get("kind", "json-api"),
            "url": catalog_config.get("url"), "revision": revision,
            "bytes": catalog_config.get("bytes"),
        },
        signals=[{"name": "provider-revision", "confidence": "high", "value": revision},
                 {"name": "set-registry-fingerprint", "confidence": "high", "value": fingerprint(rows)}],
        assumptions=config.get("assumptions", [
            {"claim": "Provider revision or set-registry changes require a catalog diff.", "risk": "medium"}
        ]),
    )


ADAPTERS = {
    "pokemon-tcg-api": pokemon_snapshot,
    "scryfall": scryfall_snapshot,
    "ygoprodeck": ygoprodeck_snapshot,
    "generic-json": generic_snapshot,
}


def set_diff(current: list[dict], previous: list[dict]) -> dict:
    current_by_id = {row["setId"]: row for row in current}
    previous_by_id = {row["setId"]: row for row in previous}
    added = sorted(set(current_by_id) - set(previous_by_id))
    removed = sorted(set(previous_by_id) - set(current_by_id))
    count_changed = sorted(
        set_id for set_id in set(current_by_id) & set(previous_by_id)
        if current_by_id[set_id].get("expectedCards") != previous_by_id[set_id].get("expectedCards")
    )
    metadata_changed = sorted(
        set_id for set_id in set(current_by_id) & set(previous_by_id)
        if current_by_id[set_id] != previous_by_id[set_id] and set_id not in count_changed
    )
    return {
        "added": added, "removed": removed, "countChanged": count_changed,
        "metadataChanged": metadata_changed,
        "counts": {"added": len(added), "removed": len(removed),
                   "countChanged": len(count_changed), "metadataChanged": len(metadata_changed)},
    }


def release_window_sets(rows: list[dict], policy: dict, today: date) -> list[str]:
    before = int(policy.get("releaseWindowDaysBefore", 14))
    after = int(policy.get("releaseWindowDaysAfter", 21))
    result = []
    for row in rows:
        try:
            released = date.fromisoformat(row["releaseDate"])
        except (TypeError, ValueError):
            continue
        delta = (released - today).days
        if -after <= delta <= before:
            result.append(row["setId"])
    return sorted(result)


def build_plan(
    current: dict,
    previous: dict | None,
    policy: dict,
    today: date,
    materialized_revision: str | None = None,
) -> dict:
    diff = set_diff(current["sets"], (previous or {}).get("sets", []))
    baseline = previous is None
    revision_changed = baseline or current["revision"] != previous.get("revision")
    catalog_changed = baseline or current["catalog"] != previous.get("catalog")
    set_signal = any(diff["counts"].values())
    current_is_materialized = materialized_revision == current["revision"]
    release_window = release_window_sets(current["sets"], policy, today)
    actions = []
    if not current_is_materialized:
        actions.append({
            "action": "download-catalog", "priority": "required",
            "reason": "no audited image-library contract materializes the current provider revision",
        })
    elif baseline:
        actions.append({
            "action": "reuse-catalog", "priority": "safe",
            "reason": "the audited image-library contract establishes the initial source baseline",
        })
    elif set_signal:
        actions.append({"action": "download-catalog", "priority": "required", "reason": "set registry changed"})
    elif revision_changed or catalog_changed:
        actions.append({"action": "download-catalog", "priority": "scheduled", "reason": "provider catalog revision changed"})
    else:
        actions.append({"action": "reuse-catalog", "priority": "safe", "reason": "provider and set signals are unchanged"})
    if actions[0]["action"] == "reuse-catalog":
        actions.append({
            "action": "refresh-catalog-on-cadence", "priority": "scheduled",
            "everyHours": int(policy.get("catalogRefreshHours", 168)),
            "then": ["normalize-and-diff-catalog", "probe-image-delta", "materialize-image-delta"],
            "reason": "catch card-level changes that do not alter provider release signals",
        })
    if release_window and actions[0]["action"] == "reuse-catalog":
        actions.append({
            "action": "recheck-release-window", "priority": "scheduled",
            "sets": release_window,
            "reason": "a configured release is near even though provider metadata is unchanged",
        })
    if actions[0]["action"] == "download-catalog":
        actions.extend([
            {"action": "normalize-and-diff-catalog", "priority": actions[0]["priority"],
             "reason": "identify card/artwork additions without downloading images"},
            {"action": "probe-image-delta", "priority": "required",
             "reason": "probe only added or changed artwork URLs"},
            {"action": "materialize-image-delta", "priority": "conditional",
             "reason": "download only images the catalog diff cannot reuse"},
        ])
    actions.append({
        "action": "sample-unchanged-images", "priority": "scheduled",
        "percent": int(policy.get("unchangedImageAuditPercent", 2)),
        "reason": "detect silent upstream replacement at stable URLs",
    })
    return {
        "game": current["game"], "provider": current["provider"],
        "baseline": baseline, "providerRevisionChanged": revision_changed,
        "materializedRevision": materialized_revision,
        "currentRevisionIsMaterialized": current_is_materialized,
        "catalogSignalChanged": catalog_changed, "setDiff": diff,
        "setsInReleaseWindow": release_window,
        "cadence": {"catalogRefreshHours": int(policy.get("catalogRefreshHours", 168))},
        "actions": actions,
    }


def load_json(path: Path | None, default):
    if path is None or not path.is_file():
        return default
    with path.open(encoding="utf-8") as source:
        return json.load(source)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("source-providers.json"))
    parser.add_argument("--previous-ledger", type=Path)
    parser.add_argument(
        "--library-contract", type=Path,
        help="audited prior library.json; required before an unchanged catalog may be reused",
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--game", action="append", help="limit to one or more configured game keys")
    parser.add_argument("--today", type=date.fromisoformat, default=date.today(), help="test/plan date in YYYY-MM-DD")
    args = parser.parse_args()

    config = load_json(args.config, {})
    if config.get("schemaVersion") != SCHEMA_VERSION:
        raise PlannerError("unsupported source-provider configuration schema")
    requested = set(args.game or [])
    configured = [row for row in config.get("games", []) if not requested or row.get("game") in requested]
    missing = requested - {row.get("game") for row in configured}
    if missing:
        raise PlannerError(f"games are not configured: {', '.join(sorted(missing))}")
    previous = load_json(args.previous_ledger, {"games": {}})
    library_contract = load_json(args.library_contract, {})
    if args.library_contract and library_contract.get("schemaVersion") != SCHEMA_VERSION:
        raise PlannerError("unsupported image-library contract schema")
    materialized_revisions = library_contract.get("sourceRevisions", {})
    ledgers = {}
    plans = {}
    for provider_config in configured:
        adapter_name = provider_config.get("adapter")
        if adapter_name not in ADAPTERS:
            raise PlannerError(f"unknown provider adapter: {adapter_name}")
        snapshot = ADAPTERS[adapter_name](provider_config, http_json)
        ledger = snapshot.ledger()
        ledgers[snapshot.game] = ledger
        plans[snapshot.game] = build_plan(
            ledger, previous.get("games", {}).get(snapshot.game),
            provider_config.get("policy", {}), args.today,
            materialized_revisions.get(snapshot.game),
        )

    checked_at = datetime.now(timezone.utc).isoformat()
    ledger_document = {
        "schemaVersion": SCHEMA_VERSION, "checkedAt": checked_at,
        "configFingerprint": fingerprint(config), "games": ledgers,
    }
    plan_document = {
        "schemaVersion": SCHEMA_VERSION, "createdAt": checked_at,
        "previousLedger": str(args.previous_ledger) if args.previous_ledger else None,
        "libraryContract": str(args.library_contract) if args.library_contract else None,
        "games": plans,
        "summary": {
            "games": len(plans),
            "requiredCatalogDownloads": sum(
                any(action["action"] == "download-catalog" and action["priority"] == "required"
                    for action in plan["actions"])
                for plan in plans.values()
            ),
            "scheduledCatalogDownloads": sum(
                any(action["action"] == "download-catalog" and action["priority"] == "scheduled"
                    for action in plan["actions"])
                for plan in plans.values()
            ),
        },
    }
    write_json(args.output / "source-ledger.json", ledger_document)
    write_json(args.output / "source-plan.json", plan_document)
    print(canonical_json(plan_document["summary"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
