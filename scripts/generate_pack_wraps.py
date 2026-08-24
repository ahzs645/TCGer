#!/usr/bin/env python3
"""Generate flat booster-wrapper sheets from packshot references with agy."""

from __future__ import annotations

import argparse
import concurrent.futures
import fnmatch
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import threading
import time
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path.home() / "Downloads" / "ptcg-assets-main"
DEFAULT_OUTPUT = (
    Path.home()
    / "Library"
    / "CloudStorage"
    / "GoogleDrive-ahzs645@gmail.com"
    / "My Drive"
    / "Projects"
    / "TCG"
    / "Packs"
)
DEFAULT_PROMPT = REPO_ROOT / "scripts" / "prompts" / "pack-flat-wrap.txt"
DEFAULT_MODEL = "gemini-3.7-flash-low"
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".avif"}
EXPECTED_SIZE = (1024, 512)
QUOTA_MARKERS = (
    "quota has been exhausted",
    "quota is exhausted",
    "capacity will reset",
    "quota for the image generation model",
)
PRINT_LOCK = threading.Lock()
MANIFEST_LOCK = threading.Lock()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate 1024x512 flat wrapper sheets for images under packshots/ "
            "directories. Existing valid outputs are skipped."
        )
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=Path(os.environ.get("PTCG_ASSETS_ROOT", DEFAULT_SOURCE)),
        help="Asset repository containing set/packshots directories.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(os.environ.get("TCG_PACK_WRAPS_DIR", DEFAULT_OUTPUT)),
        help="Destination root. Outputs are grouped by set ID.",
    )
    parser.add_argument(
        "--prompt",
        type=Path,
        default=DEFAULT_PROMPT,
        help="Reusable generation prompt template.",
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("AGY_PACK_MODEL", DEFAULT_MODEL),
        help="agy model name.",
    )
    parser.add_argument(
        "--jobs",
        type=int,
        default=1,
        help="Concurrent agy processes. Start at 1; use 2 after confirming quota.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Process at most this many matching references; 0 means all.",
    )
    parser.add_argument(
        "--match",
        action="append",
        default=[],
        metavar="GLOB",
        help="Only include relative paths matching this glob; repeatable.",
    )
    parser.add_argument(
        "--set",
        dest="sets",
        action="append",
        default=[],
        help="Only include this set directory name; repeatable.",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=2,
        help="Retries after the first attempt.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=600,
        help="Maximum seconds per attempt.",
    )
    parser.add_argument(
        "--settle-seconds",
        type=int,
        default=10,
        help="Stop a lingering agy process after a valid output is stable this long.",
    )
    parser.add_argument(
        "--quota-backoff",
        type=int,
        default=3600,
        help=(
            "Fallback seconds to pause when image quota is exhausted. If agy reports "
            "a reset duration, that duration plus five minutes is used instead."
        ),
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Regenerate and replace valid existing outputs.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List planned work without creating directories or running agy.",
    )
    return parser.parse_args()


def packshot_set_id(source_root: Path, image_path: Path) -> str | None:
    relative = image_path.relative_to(source_root)
    parts = relative.parts
    try:
        packshots_index = parts.index("packshots")
    except ValueError:
        return None
    if packshots_index == 0:
        return None
    return parts[packshots_index - 1]


def discover_images(
    source_root: Path, sets: set[str], patterns: list[str]
) -> list[tuple[str, Path]]:
    discovered: list[tuple[str, Path]] = []
    for image_path in source_root.rglob("*"):
        if not image_path.is_file() or image_path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        set_id = packshot_set_id(source_root, image_path)
        if set_id is None or (sets and set_id not in sets):
            continue
        relative_text = image_path.relative_to(source_root).as_posix()
        if patterns and not any(
            fnmatch.fnmatch(relative_text, pattern)
            or fnmatch.fnmatch(image_path.name, pattern)
            for pattern in patterns
        ):
            continue
        discovered.append((set_id, image_path))
    return sorted(discovered, key=lambda item: item[1].as_posix().casefold())


def png_dimensions(path: Path) -> tuple[int, int] | None:
    try:
        with path.open("rb") as image_file:
            header = image_file.read(24)
    except OSError:
        return None
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", header[16:24])


def is_valid_output(path: Path) -> bool:
    return png_dimensions(path) == EXPECTED_SIZE


def output_path(output_root: Path, set_id: str, reference: Path) -> Path:
    return output_root / set_id / f"{reference.stem}-flat-wrap.png"


def append_manifest(manifest: Path, payload: dict[str, object]) -> None:
    line = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    with MANIFEST_LOCK:
        with manifest.open("a", encoding="utf-8") as manifest_file:
            manifest_file.write(line + "\n")


def emit(message: str) -> None:
    with PRINT_LOCK:
        print(message, flush=True)


def stop_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def build_prompt(template: str, reference: Path, temporary_output: Path) -> str:
    return (
        f"{template.rstrip()}\n\n"
        f"Reference image: @{reference}\n"
        f"Reference role: visual reference only; do not alter the source file.\n"
        f"Save the generated image to exactly: {temporary_output}\n"
        "Do not modify any other file."
    )


def quota_backoff_seconds(log_path: Path, fallback_seconds: int) -> int | None:
    try:
        log_text = log_path.read_text(encoding="utf-8", errors="replace").casefold()
    except OSError:
        return None
    explicit_marker = any(marker in log_text for marker in QUOTA_MARKERS)
    generic_quota_error = "quota" in log_text and any(
        indicator in log_text
        for indicator in ("exhausted", "quota limit", "too many requests", "error 429")
    )
    if not explicit_marker and not generic_quota_error:
        return None

    hours_match = re.search(
        r"(\d+)\s+hours?(?:\s+(?:and\s+)?(\d+)\s+minutes?)?", log_text
    )
    if hours_match:
        hours = int(hours_match.group(1))
        minutes = int(hours_match.group(2) or 0)
        return hours * 3600 + minutes * 60 + 300
    minutes_match = re.search(r"(\d+)\s+minutes?", log_text)
    if minutes_match:
        return int(minutes_match.group(1)) * 60 + 300
    return fallback_seconds


def run_attempt(
    *,
    reference: Path,
    temporary_output: Path,
    prompt_template: str,
    source_root: Path,
    output_root: Path,
    model: str,
    timeout: int,
    settle_seconds: int,
    quota_backoff: int,
    log_path: Path,
) -> tuple[str, str, int]:
    temporary_output.unlink(missing_ok=True)
    command = [
        "agy",
        "--model",
        model,
        "--mode",
        "accept-edits",
        "--sandbox",
        "--dangerously-skip-permissions",
        "--add-dir",
        str(source_root),
        "--add-dir",
        str(output_root),
        "--print-timeout",
        f"{timeout}s",
        "-p",
        build_prompt(prompt_template, reference, temporary_output),
    ]
    started = time.monotonic()
    stable_since: float | None = None
    last_size = -1
    with log_path.open("wb") as log_file:
        process = subprocess.Popen(
            command,
            cwd=REPO_ROOT,
            stdin=subprocess.DEVNULL,
            stdout=log_file,
            stderr=subprocess.STDOUT,
        )
        while process.poll() is None:
            elapsed = time.monotonic() - started
            if elapsed >= timeout:
                stop_process(process)
                break
            if is_valid_output(temporary_output):
                current_size = temporary_output.stat().st_size
                if current_size != last_size:
                    last_size = current_size
                    stable_since = time.monotonic()
                elif stable_since is not None and time.monotonic() - stable_since >= settle_seconds:
                    stop_process(process)
                    break
            else:
                stable_since = None
                last_size = -1
            time.sleep(1)

    if is_valid_output(temporary_output):
        elapsed = time.monotonic() - started
        return "success", f"valid 1024x512 PNG in {elapsed:.1f}s", 0
    quota_wait = quota_backoff_seconds(log_path, quota_backoff)
    if quota_wait is not None:
        return "quota", f"image quota exhausted; pausing {quota_wait}s", quota_wait
    dimensions = png_dimensions(temporary_output)
    elapsed = time.monotonic() - started
    if dimensions:
        return (
            "failure",
            f"wrong dimensions {dimensions[0]}x{dimensions[1]} after {elapsed:.1f}s",
            0,
        )
    return "failure", f"no valid PNG after {elapsed:.1f}s; see {log_path}", 0


def process_one(
    *,
    index: int,
    total: int,
    set_id: str,
    reference: Path,
    args: argparse.Namespace,
    prompt_template: str,
    manifest: Path,
    log_root: Path,
) -> str:
    final_output = output_path(args.output, set_id, reference)
    if not args.force and is_valid_output(final_output):
        emit(f"[{index}/{total}] SKIP {set_id}/{reference.name}")
        return "skipped"

    final_output.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = final_output.with_name(final_output.stem + ".part.png")
    job_log_root = log_root / set_id
    job_log_root.mkdir(parents=True, exist_ok=True)
    started_at = time.time()
    emit(f"[{index}/{total}] START {set_id}/{reference.name}")

    last_reason = "not attempted"
    attempt = 1
    while attempt <= args.retries + 1:
        log_path = job_log_root / f"{reference.stem}.attempt-{attempt}.log"
        status, reason, quota_wait = run_attempt(
            reference=reference,
            temporary_output=temporary_output,
            prompt_template=prompt_template,
            source_root=args.source,
            output_root=args.output,
            model=args.model,
            timeout=args.timeout,
            settle_seconds=args.settle_seconds,
            quota_backoff=args.quota_backoff,
            log_path=log_path,
        )
        last_reason = reason
        if status == "success":
            os.replace(temporary_output, final_output)
            payload = {
                "status": "generated",
                "reference": str(reference),
                "output": str(final_output),
                "set": set_id,
                "model": args.model,
                "attempt": attempt,
                "duration_seconds": round(time.time() - started_at, 2),
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            }
            append_manifest(manifest, payload)
            emit(f"[{index}/{total}] DONE  {set_id}/{final_output.name} ({reason})")
            return "generated"
        if status == "quota":
            resume_at = time.strftime(
                "%Y-%m-%d %H:%M:%S %z", time.localtime(time.time() + quota_wait)
            )
            emit(
                f"[{index}/{total}] PAUSE {set_id}/{reference.name}: "
                f"{reason}; resume around {resume_at}"
            )
            time.sleep(quota_wait)
            continue
        emit(f"[{index}/{total}] RETRY {set_id}/{reference.name}: {reason}")
        attempt += 1

    temporary_output.unlink(missing_ok=True)
    append_manifest(
        manifest,
        {
            "status": "failed",
            "reference": str(reference),
            "output": str(final_output),
            "set": set_id,
            "model": args.model,
            "reason": last_reason,
            "duration_seconds": round(time.time() - started_at, 2),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        },
    )
    emit(f"[{index}/{total}] FAIL  {set_id}/{reference.name}: {last_reason}")
    return "failed"


def describe_plan(jobs: Iterable[tuple[str, Path]], output_root: Path) -> None:
    for set_id, reference in jobs:
        print(f"{reference} -> {output_path(output_root, set_id, reference)}")


def main() -> int:
    args = parse_args()
    args.source = args.source.expanduser().resolve()
    args.output = args.output.expanduser().resolve()
    args.prompt = args.prompt.expanduser().resolve()

    if (
        args.jobs < 1
        or args.limit < 0
        or args.retries < 0
        or args.timeout < 1
        or args.quota_backoff < 1
    ):
        print(
            "jobs must be >= 1; limit/retries >= 0; timeout/quota-backoff >= 1",
            file=sys.stderr,
        )
        return 2
    if not args.source.is_dir():
        print(f"source directory does not exist: {args.source}", file=sys.stderr)
        return 2
    if not args.prompt.is_file():
        print(f"prompt file does not exist: {args.prompt}", file=sys.stderr)
        return 2

    jobs = discover_images(args.source, set(args.sets), args.match)
    if args.limit:
        jobs = jobs[: args.limit]
    print(
        f"Found {len(jobs)} matching packshots | model={args.model} | "
        f"workers={args.jobs} | output={args.output}"
    )
    if args.dry_run:
        describe_plan(jobs, args.output)
        return 0
    if shutil.which("agy") is None:
        print("agy is not installed or not on PATH", file=sys.stderr)
        return 2
    if not jobs:
        return 0

    args.output.mkdir(parents=True, exist_ok=True)
    manifest = args.output / "_pack-wrap-manifest.jsonl"
    log_root = REPO_ROOT / "generated" / "flat-wrap-batch-logs"
    log_root.mkdir(parents=True, exist_ok=True)
    prompt_template = args.prompt.read_text(encoding="utf-8")

    results: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as executor:
        futures = [
            executor.submit(
                process_one,
                index=index,
                total=len(jobs),
                set_id=set_id,
                reference=reference,
                args=args,
                prompt_template=prompt_template,
                manifest=manifest,
                log_root=log_root,
            )
            for index, (set_id, reference) in enumerate(jobs, start=1)
        ]
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())

    generated = results.count("generated")
    skipped = results.count("skipped")
    failed = results.count("failed")
    print(f"Complete: generated={generated} skipped={skipped} failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
