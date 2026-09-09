#!/usr/bin/env python3
"""Rebuild a labeling queue and replay reviews after a padding-only dataset repair."""
import argparse
import json
from pathlib import Path

from build_archive_corner_label_queue import build_queue
from corpus_release import load_json, write_json
from repair_archive_padding import migrate_journal


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-queue", type=Path, required=True)
    parser.add_argument("--source-release", type=Path, required=True)
    parser.add_argument("--source-journal", type=Path, required=True)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--output-queue", type=Path, required=True)
    parser.add_argument("--output-journal", type=Path, required=True)
    args = parser.parse_args()
    if args.output_queue.exists() or args.output_journal.exists():
        raise FileExistsError("Use new output queue and journal paths")
    original = load_json(args.source_queue)
    queue = build_queue(args.release, splits=tuple(original["selection"]["splits"]),
                        slices=tuple(original["selection"]["sceneSlices"]),
                        canonical_corpus_sha256=original["canonicalCorpusSha256"])
    if [f["recordId"] for f in original["frames"]] != [f["recordId"] for f in queue["frames"]]:
        raise ValueError("Review queue frame order changed; explicit reconciliation is required")
    write_json(args.output_queue, queue)
    counts = migrate_journal(args.source_queue, args.source_release, args.source_journal,
                             args.output_queue, args.release, args.output_journal)
    print(json.dumps(counts, indent=2))


if __name__ == "__main__":
    main()
