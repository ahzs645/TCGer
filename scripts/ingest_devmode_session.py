#!/usr/bin/env python3
"""Ingest TCGer Dev Mode scan sessions into the reference library.

Takes any number of sources — an "Export All" zip from the app, a single
extracted `scan-session-*` directory, or a folder containing several — and
merges the sessions it finds into the canonical library at
`~/Downloads/Reference/TCGer-Session-Reference`, keeping `manifest.json`,
`provenance.csv`, and `checksums.sha256` in sync.

Duplicate handling is byte-for-byte: a session whose directory name already
exists in the library is re-hashed file by file. Identical content is
recorded as another sighting of the same session; different content aborts
that session with a conflict report and touches nothing.

Aggregate session digests for newly ingested sessions use recipe v2
(documented below). Entries created by the original 2026-08-10 cleanup keep
their v1 digests — the v1 recipe was not preserved, so those values are
historical only; per-file checksums are the verifiable ground truth for
every session, old and new:

    shasum -a 256 -c checksums.sha256   # from the library root

Usage:
    python3 scripts/ingest_devmode_session.py ~/Downloads/TCGer-DevMode-All-*.zip
    python3 scripts/ingest_devmode_session.py /path/to/scan-session-20260811-123456
    python3 scripts/ingest_devmode_session.py --library /path/to/library source...
"""

import argparse
import csv
import hashlib
import json
import shutil
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_LIBRARY = Path.home() / "Downloads/Reference/TCGer-Session-Reference"
DIGEST_RECIPE_V2 = "v2: sha256 over concatenated 'relpath LF filehash LF' pairs, relpaths sorted"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hash_session(session_dir: Path) -> dict:
    """Relative path -> sha256 for every file in the session."""
    hashes = {}
    for path in sorted(session_dir.rglob("*")):
        if path.is_file() and path.name != ".DS_Store":
            hashes[str(path.relative_to(session_dir))] = sha256_file(path)
    return hashes


def session_digest_v2(hashes: dict) -> str:
    blob = b"".join(
        f"{rel}\n{hashes[rel]}\n".encode() for rel in sorted(hashes)
    )
    return hashlib.sha256(blob).hexdigest()


def find_session_dirs(source: Path, scratch: Path) -> list:
    """Resolve a source argument to concrete scan-session-* directories."""
    if source.is_dir():
        if source.name.startswith("scan-session-"):
            return [source]
        return sorted(
            p for p in source.iterdir()
            if p.is_dir() and p.name.startswith("scan-session-")
        )
    if source.suffix == ".zip":
        extract_root = scratch / source.stem
        with zipfile.ZipFile(source) as archive:
            archive.extractall(extract_root)
        return sorted(
            p for p in extract_root.rglob("scan-session-*")
            if p.is_dir()
        )
    raise SystemExit(f"unsupported source (expected dir or .zip): {source}")


def captured_at(session_dir: Path) -> str:
    try:
        results = json.loads((session_dir / "results.json").read_text())
        value = results.get("summary", {}).get("capturedAt")
        if value:
            return value
    except (OSError, json.JSONDecodeError):
        pass
    # Fallback: derive from the directory name, marked as local wall clock.
    stamp = session_dir.name.replace("scan-session-", "")
    try:
        return datetime.strptime(stamp, "%Y%m%d-%H%M%S").isoformat() + " (local, from name)"
    except ValueError:
        return "unknown"


def summary_fields(session_dir: Path) -> dict:
    try:
        summary = json.loads((session_dir / "results.json").read_text()).get("summary", {})
    except (OSError, json.JSONDecodeError):
        summary = {}
    return {
        "frame_count": summary.get("frameCount", 0),
        "mode": summary.get("mode", "unknown"),
        "pipeline": summary.get("pipeline", "unknown"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("sources", nargs="+", type=Path)
    parser.add_argument("--library", type=Path, default=DEFAULT_LIBRARY)
    parser.add_argument(
        "--dry-run", action="store_true",
        help="report what would happen without writing anything",
    )
    args = parser.parse_args()

    library = args.library
    sessions_root = library / "sessions"
    manifest_path = library / "manifest.json"
    checksums_path = library / "checksums.sha256"
    provenance_path = library / "provenance.csv"
    for required in (sessions_root, manifest_path, checksums_path, provenance_path):
        if not required.exists():
            raise SystemExit(f"library incomplete, missing {required}")

    manifest = json.loads(manifest_path.read_text())
    by_id = {entry["session_id"]: entry for entry in manifest["sessions"]}

    ingested, duplicates, conflicts = [], [], []
    with tempfile.TemporaryDirectory(prefix="tcger-ingest-") as scratch_dir:
        scratch = Path(scratch_dir)
        candidates = []
        for source in args.sources:
            candidates.extend(
                (session_dir, source) for session_dir in find_session_dirs(source, scratch)
            )
        if not candidates:
            raise SystemExit("no scan-session-* directories found in the given sources")

        for session_dir, source in candidates:
            session_id = session_dir.name
            new_hashes = hash_session(session_dir)
            if not new_hashes:
                print(f"SKIP  {session_id}: empty directory")
                continue

            if session_id in by_id:
                existing_hashes = hash_session(sessions_root / session_id)
                if existing_hashes == new_hashes:
                    duplicates.append(session_id)
                    entry = by_id[session_id]
                    sighting = str(source)
                    if sighting not in entry.get("source_copies_found", []):
                        entry.setdefault("source_copies_found", []).append(sighting)
                    print(f"DUP   {session_id}: identical to library copy ({source})")
                else:
                    conflicts.append(session_id)
                    changed = sorted(
                        rel for rel in set(existing_hashes) | set(new_hashes)
                        if existing_hashes.get(rel) != new_hashes.get(rel)
                    )
                    print(f"CONFLICT {session_id}: same name, different bytes — NOT ingested.")
                    print(f"         differing files: {changed[:10]}")
                    print("         Resolve manually; never overwrite a canonical session.")
                continue

            print(f"NEW   {session_id}: {len(new_hashes)} files from {source}")
            if args.dry_run:
                ingested.append(session_id)
                continue

            destination = sessions_root / session_id
            shutil.copytree(session_dir, destination)
            for junk in destination.rglob(".DS_Store"):
                junk.unlink()

            entry = {
                "session_id": session_id,
                "captured_at": captured_at(destination),
                **summary_fields(destination),
                "file_count": len(new_hashes),
                "total_bytes": sum(
                    (destination / rel).stat().st_size for rel in new_hashes
                ),
                "session_sha256": session_digest_v2(new_hashes),
                "session_digest_recipe": DIGEST_RECIPE_V2,
                "canonical_source": str(destination),
                "source_copies_found": [str(source)],
            }
            by_id[session_id] = entry
            manifest["sessions"] = sorted(
                by_id.values(), key=lambda item: item["session_id"]
            )

            with open(checksums_path, "a") as handle:
                for rel in sorted(new_hashes):
                    handle.write(f"{new_hashes[rel]}  sessions/{session_id}/{rel}\n")

            with open(provenance_path, "a", newline="") as handle:
                csv.writer(handle).writerow([
                    session_id, entry["captured_at"], entry["frame_count"],
                    entry["file_count"], entry["total_bytes"],
                    entry["session_sha256"], entry["canonical_source"],
                    str(source), 1, 0, str(source),
                ])
            ingested.append(session_id)

        if not args.dry_run and (ingested or duplicates):
            manifest["deduplication"]["unique_sessions"] = len(by_id)
            manifest["last_ingest_at"] = datetime.now(timezone.utc).isoformat()
            manifest_path.write_text(json.dumps(manifest, indent=1) + "\n")

    print(
        f"\ndone: {len(ingested)} ingested, {len(duplicates)} duplicates, "
        f"{len(conflicts)} conflicts{' (dry run)' if args.dry_run else ''}"
    )
    if ingested and not args.dry_run:
        print(f"""
Next steps for the new sessions:
  1. Replay them against current baselines (env vars must be ON xcodebuild):
     env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \\
       TEST_RUNNER_DEVMODE_SESSIONS_DIR={sessions_root} \\
       xcodebuild test -project mobile-apps/ios/TCGer/TCGer.xcodeproj -scheme TCGer \\
       -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \\
       -only-testing:TCGerTests/DevModeSessionReplayTests \\
       -only-testing:TCGerTests/BinderSessionReplayTests
  2. Add ground-truth labels for the new frames to
     DevModeSessionReplayTests.expectedCards / expectedNoMatch (single-card)
     — clear shots and visible collector numbers pin exact printings.
  3. If a device-recorded outcome does not reproduce in the Simulator,
     verify with a pre-fix/pinned worktree control before allowlisting it in
     knownSimulatorDivergences (see docs/scanner-model-ai-handoff.md).""")
    if conflicts:
        sys.exit(2)


if __name__ == "__main__":
    main()
