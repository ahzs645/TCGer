"""Fail-first, pass-second Hugging Face CPU smoke for the geometry preflight.

This is a local orchestrator. It never gives one Job authority to create
another: it uploads the pinned tooling, submits a CPU Job, waits for it, reads
its report, and only then decides whether to submit the next Job.

    1. `git archive` the geometry tooling and schemas at a clean HEAD into a
       tarball, and upload it to the private model repo under
       `geometry/tooling/<git-sha>/`. The Hub commit oid is captured so the
       Jobs download exactly those bytes.
    2. Submit a CPU Job that runs the preflight against a release that must
       fail with one specific check code. For a pinned dataset release, the
       Job changes one image byte and requires exactly `IMAGE_HASH`. The run is accepted only if the
       preflight exit code is 2 and `failedChecks` equals the expected set.
       An authentication, download, or dependency failure produces a
       different exit code or a missing report and is reported as such,
       never as a passing rejection test.
    3. Only if step 2 behaved, submit the positive Job against the valid
       fixture release and require exit 0 with `readyFor: tooling`.
    4. Upload both reports under a path containing the corpus hash, capture the
       returned commit oids, and write a local summary with all provenance.

Requires `HF_TOKEN` (or a logged-in `hf` CLI) with write access to the model
repo. Run with `--dry-run` to print the Job commands without submitting.

Usage from the repository root:

    python3 tools/card-geometry/hf_preflight_smoke.py \
        --hub-repo ahzs645/tcger-universal-arcface \
        --summary .artifacts/card-geometry/smoke-summary.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_fixture_releases import EXPECTED_FAILED_CHECKS, EXPECTED_READY_FOR  # noqa: E402
from corpus_release import REPOSITORY, sha256_file  # noqa: E402
from preflight import (  # noqa: E402
    EXIT_CHECKS_FAILED,
    EXIT_OK,
    REPORT_MARKER_BEGIN,
    REPORT_MARKER_END,
)

TOOLING_PATHS = ("tools/card-geometry", "docs/scanner-system/schemas")
TERMINAL_STAGES = {"COMPLETED", "ERROR", "CANCELED", "CANCELLED", "DELETED"}
EXIT_MARKER = "PREFLIGHT_EXIT="

PINNED_JSONSCHEMA = "jsonschema==4.23.0"
PINNED_HUB = "huggingface_hub==1.28.0"
PINNED_CPU_IMAGE = (
    "python:3.12-slim@"
    "sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea"
)


def run(command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=True, text=True, capture_output=True, **kwargs)


def git_head(allow_dirty: bool) -> str:
    status = run(
        ["git", "-C", str(REPOSITORY), "status", "--porcelain", "--", *TOOLING_PATHS]
    ).stdout
    if status.strip() and not allow_dirty:
        raise SystemExit(
            "tooling paths have uncommitted changes; commit them or pass --allow-dirty"
        )
    return run(["git", "-C", str(REPOSITORY), "rev-parse", "HEAD"]).stdout.strip()


def archive_tooling(revision: str, destination: Path) -> str:
    with destination.open("wb") as handle:
        subprocess.run(
            [
                "git",
                "-C",
                str(REPOSITORY),
                "archive",
                "--format=tar.gz",
                revision,
                *TOOLING_PATHS,
            ],
            check=True,
            stdout=handle,
        )
    return sha256_file(destination)


def job_script(
    *,
    hub_repo: str,
    tooling_path: str,
    tooling_oid: str,
    tooling_sha256: str,
    release_name: str | None,
    git_revision: str,
    dataset_repo: str | None = None,
    dataset_revision: str | None = None,
    release_path: str | None = None,
    expected_corpus_hash: str | None = None,
    expected_policy_sha256: str | None = None,
    expected_policy_id: str | None = None,
    expected_purpose: str | None = None,
    mutate_image: bool = False,
) -> str:
    """Bash executed inside the Job. Downloads pinned bytes, verifies, runs the preflight."""
    download = f"""
import hashlib, os, sys
from huggingface_hub import hf_hub_download
path = hf_hub_download(
    repo_id={hub_repo!r}, filename={tooling_path!r}, revision={tooling_oid!r},
    repo_type="model", token=os.environ["HF_TOKEN"], local_dir="/work/download",
)
digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
if digest != {tooling_sha256!r}:
    print("TOOLING_SHA256_MISMATCH", digest, file=sys.stderr)
    sys.exit(97)
print(path)
"""
    commands = [
        "set -u",
        "mkdir -p /work/download /work/src",
        f"pip install -q {PINNED_HUB} {PINNED_JSONSCHEMA} || exit 96",
        f"TARBALL=$(python - <<'PY'\n{download}\nPY\n) || exit $?",
        'tar -xzf "$TARBALL" -C /work/src || exit 95',
        "cd /work/src",
    ]
    if dataset_repo:
        dataset_download = f"""
import os
from pathlib import Path
from huggingface_hub import snapshot_download
root = snapshot_download(
    repo_id={dataset_repo!r}, revision={dataset_revision!r}, repo_type="dataset",
    token=os.environ["HF_TOKEN"], allow_patterns=[{release_path!r}, {f"{release_path}/**"!r}],
)
release = Path(root) / {release_path!r}
if not (release / "manifest.json").is_file():
    raise SystemExit(f"release not found at {{release}}")
print(release)
"""
        commands.extend(
            [
                f"DATASET_RELEASE=$(python - <<'PY'\n{dataset_download}\nPY\n) || exit $?",
                'cp -R "$DATASET_RELEASE" /work/release || exit 94',
            ]
        )
        if mutate_image:
            commands.append(
                "python - <<'PY'\n"
                "import json\n"
                "from pathlib import Path\n"
                "root = Path('/work/release')\n"
                "manifest = json.loads((root / 'manifest.json').read_text())\n"
                "image = root / manifest['records'][0]['images'][0]['path']\n"
                "data = bytearray(image.read_bytes())\n"
                "data[len(data) // 2] ^= 1\n"
                "image.write_bytes(data)\n"
                "print('MUTATED_IMAGE', image)\n"
                "PY"
            )
        expected_args = [
            f"--expected-corpus-hash {expected_corpus_hash}",
            f"--expected-policy-sha256 {expected_policy_sha256}",
            f"--expected-purpose {expected_purpose}",
        ]
        if expected_policy_id:
            expected_args.append(f"--expected-policy-id {expected_policy_id}")
        commands.append(
            "python tools/card-geometry/preflight.py --release-root /work/release "
            f"{' '.join(expected_args)} --tooling-revision {git_revision} --print-report"
        )
    else:
        commands.append(
            "python tools/card-geometry/preflight.py "
            f"--release-root tools/card-geometry/fixtures/releases/{release_name} "
            f"--tooling-revision {git_revision} --print-report"
        )
    commands.append(f'echo "{EXIT_MARKER}$?"')
    return "\n".join(commands)


def parse_logs(lines: list[str]) -> tuple[int | None, dict[str, Any] | None]:
    exit_code = None
    report = None
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(EXIT_MARKER):
            match = re.search(r"(\d+)$", stripped)
            exit_code = int(match.group(1)) if match else None
        if (
            stripped == REPORT_MARKER_BEGIN
            and index + 2 < len(lines)
            and lines[index + 2].strip() == REPORT_MARKER_END
        ):
            try:
                report = json.loads(lines[index + 1])
            except json.JSONDecodeError:
                report = None
    return exit_code, report


def _stage(job: Any) -> str:
    status = getattr(job, "status", None)
    stage = getattr(status, "stage", None) if status is not None else None
    if stage is None and isinstance(status, dict):
        stage = status.get("stage")
    return str(getattr(stage, "value", stage) or "").upper()


def wait_for_job(
    api: Any, job_id: str, timeout_seconds: int, poll_seconds: int = 15
) -> str:
    deadline = time.monotonic() + timeout_seconds
    while True:
        job = api.inspect_job(job_id=job_id)
        stage = _stage(job)
        if stage in TERMINAL_STAGES:
            return stage
        if time.monotonic() > deadline:
            raise TimeoutError(
                f"job {job_id} still {stage or 'unknown'} after {timeout_seconds}s"
            )
        time.sleep(poll_seconds)


def fetch_logs(api: Any, job_id: str) -> list[str]:
    return [str(line) for line in api.fetch_job_logs(job_id=job_id)]


def submit_and_collect(
    api: Any,
    *,
    image: str,
    flavor: str,
    timeout_seconds: int,
    script: str,
    token: str,
) -> dict[str, Any]:
    job = api.run_job(
        image=image,
        command=["bash", "-lc", script],
        secrets={"HF_TOKEN": token},
        flavor=flavor,
        timeout=f"{timeout_seconds}s",
    )
    job_id = getattr(job, "id", None) or getattr(job, "job_id", None)
    if not job_id:
        raise RuntimeError(f"run_job returned no id: {job!r}")
    stage = wait_for_job(api, job_id, timeout_seconds + 300)
    logs = fetch_logs(api, job_id)
    exit_code, report = parse_logs(logs)
    return {
        "jobId": job_id,
        "stage": stage,
        "preflightExit": exit_code,
        "report": report,
        "logTail": logs[-40:],
    }


def evaluate_negative(
    result: dict[str, Any],
    release_name: str | None,
    expected_checks: set[str] | None = None,
) -> list[str]:
    problems = []
    expected = expected_checks or set(EXPECTED_FAILED_CHECKS[release_name])
    if result["preflightExit"] != EXIT_CHECKS_FAILED:
        problems.append(
            f"expected preflight exit {EXIT_CHECKS_FAILED}, got {result['preflightExit']!r}"
        )
    report = result["report"]
    if report is None:
        problems.append(
            "no preflight report found in job logs; failure is infrastructural, not a rejection"
        )
        return problems
    if set(report["failedChecks"]) != expected:
        problems.append(
            f"expected failedChecks {sorted(expected)}, got {report['failedChecks']}"
        )
    expected_ready = (
        "none" if expected_checks is not None else EXPECTED_READY_FOR[release_name]
    )
    if report["readyFor"] != expected_ready:
        problems.append(
            f"expected readyFor {expected_ready!r}, got {report['readyFor']!r}"
        )
    if (
        "MANIFEST_LOAD" in report["failedChecks"]
        or "SHARED_FIXTURES" in report["failedChecks"]
    ):
        problems.append(
            "structural checks failed; the rejection did not come from the intended defect"
        )
    return problems


def evaluate_positive(
    result: dict[str, Any], release_name: str | None, expected_ready: str | None = None
) -> list[str]:
    problems = []
    if result["preflightExit"] != EXIT_OK:
        problems.append(
            f"expected preflight exit {EXIT_OK}, got {result['preflightExit']!r}"
        )
    report = result["report"]
    if report is None:
        problems.append("no preflight report found in job logs")
        return problems
    if report["failedChecks"]:
        problems.append(f"unexpected failed checks {report['failedChecks']}")
    ready = expected_ready or EXPECTED_READY_FOR[release_name]
    if report["readyFor"] != ready:
        problems.append(f"expected readyFor {ready!r}, got {report['readyFor']!r}")
    if report["readyFor"] == "training":
        problems.append("a fixture release must never be ready for training")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--hub-repo", default="ahzs645/tcger-universal-arcface")
    parser.add_argument(
        "--dataset-repo", help="Private Hub dataset containing a real release"
    )
    parser.add_argument(
        "--dataset-revision",
        help="Immutable 40-hex Hub commit oid for --dataset-repo",
    )
    parser.add_argument(
        "--release-path",
        help="Directory inside the pinned dataset revision containing manifest.json",
    )
    parser.add_argument("--expected-corpus-hash")
    parser.add_argument("--expected-policy-sha256")
    parser.add_argument("--expected-policy-id")
    parser.add_argument("--expected-purpose", choices=("fixture", "smoke", "training"))
    parser.add_argument("--flavor", default="cpu-basic")
    parser.add_argument("--image", default=PINNED_CPU_IMAGE)
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument(
        "--negative-release",
        default="invalid-leakage",
        choices=sorted(EXPECTED_FAILED_CHECKS),
    )
    parser.add_argument(
        "--positive-release",
        default="valid-fixture",
        choices=sorted(EXPECTED_FAILED_CHECKS),
    )
    parser.add_argument(
        "--summary",
        type=Path,
        default=REPOSITORY / ".artifacts" / "card-geometry" / "smoke-summary.json",
    )
    parser.add_argument("--allow-dirty", action="store_true")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the job scripts and exit without uploading or submitting",
    )
    args = parser.parse_args()

    if not re.fullmatch(r"[^@]+@sha256:[0-9a-f]{64}", args.image):
        parser.error("--image must be pinned by sha256 digest")

    dataset_fields = (
        args.dataset_repo,
        args.dataset_revision,
        args.release_path,
        args.expected_corpus_hash,
        args.expected_policy_sha256,
        args.expected_purpose,
    )
    dataset_mode = any(dataset_fields)
    if dataset_mode and not all(dataset_fields):
        parser.error(
            "real-release smoke requires --dataset-repo, --dataset-revision, "
            "--release-path, --expected-corpus-hash, --expected-policy-sha256, "
            "and --expected-purpose"
        )
    if dataset_mode:
        if not re.fullmatch(r"[0-9a-f]{40}", args.dataset_revision):
            parser.error("--dataset-revision must be an immutable 40-hex commit oid")
        release_parts = Path(args.release_path).parts
        if Path(args.release_path).is_absolute() or ".." in release_parts:
            parser.error("--release-path must be a safe dataset-relative path")
        for name, value in (
            ("--expected-corpus-hash", args.expected_corpus_hash),
            ("--expected-policy-sha256", args.expected_policy_sha256),
        ):
            if not re.fullmatch(r"[0-9a-f]{64}", value):
                parser.error(f"{name} must be a lowercase SHA-256")

    if not dataset_mode and not EXPECTED_FAILED_CHECKS[args.negative_release]:
        parser.error("--negative-release must name a release that is expected to fail")
    if not dataset_mode and EXPECTED_FAILED_CHECKS[args.positive_release]:
        parser.error("--positive-release must name a release that is expected to pass")

    revision = git_head(args.allow_dirty)
    tooling_path = f"geometry/tooling/{revision}/card-geometry-tooling.tar.gz"

    with tempfile.TemporaryDirectory() as tmp:
        tarball = Path(tmp) / "card-geometry-tooling.tar.gz"
        tooling_sha256 = archive_tooling(revision, tarball)

        if args.dry_run:
            for label, name in (
                ("negative", args.negative_release),
                ("positive", args.positive_release),
            ):
                print(f"# --- job script for {name} ---")
                print(
                    job_script(
                        hub_repo=args.hub_repo,
                        tooling_path=tooling_path,
                        tooling_oid="<oid>",
                        tooling_sha256=tooling_sha256,
                        release_name=name,
                        git_revision=revision,
                        dataset_repo=args.dataset_repo,
                        dataset_revision=args.dataset_revision,
                        release_path=args.release_path,
                        expected_corpus_hash=args.expected_corpus_hash,
                        expected_policy_sha256=args.expected_policy_sha256,
                        expected_policy_id=args.expected_policy_id,
                        expected_purpose=args.expected_purpose,
                        mutate_image=dataset_mode and label == "negative",
                    )
                )
            print(
                f"# tooling tarball sha256 {tooling_sha256} would upload to {args.hub_repo}:{tooling_path}"
            )
            return 0

        from huggingface_hub import HfApi, get_token

        token = os.environ.get("HF_TOKEN") or get_token()
        if not token:
            raise SystemExit("HF_TOKEN is not set and no hf CLI login was found")
        api = HfApi(token=token)
        commit = api.upload_file(
            path_or_fileobj=str(tarball),
            path_in_repo=tooling_path,
            repo_id=args.hub_repo,
            repo_type="model",
            commit_message=f"card-geometry tooling {revision[:12]}",
        )
        tooling_oid = getattr(commit, "oid", None)
        if not tooling_oid:
            raise SystemExit(f"upload returned no commit oid: {commit!r}")
        print(
            f"uploaded tooling {tooling_sha256[:12]} as {tooling_path} at commit {tooling_oid}"
        )

    summary: dict[str, Any] = {
        "gitRevision": revision,
        "hubRepo": args.hub_repo,
        "datasetRepo": args.dataset_repo,
        "datasetRevision": args.dataset_revision,
        "releasePath": args.release_path,
        "expectedCorpusHash": args.expected_corpus_hash,
        "expectedPolicySha256": args.expected_policy_sha256,
        "expectedPolicyId": args.expected_policy_id,
        "expectedPurpose": args.expected_purpose,
        "toolingPath": tooling_path,
        "toolingOid": tooling_oid,
        "toolingSha256": tooling_sha256,
        "flavor": args.flavor,
        "image": args.image,
        "runs": {},
    }

    def submit(label: str, name: str) -> dict[str, Any]:
        script = job_script(
            hub_repo=args.hub_repo,
            tooling_path=tooling_path,
            tooling_oid=tooling_oid,
            tooling_sha256=tooling_sha256,
            release_name=name,
            git_revision=revision,
            dataset_repo=args.dataset_repo,
            dataset_revision=args.dataset_revision,
            release_path=args.release_path,
            expected_corpus_hash=args.expected_corpus_hash,
            expected_policy_sha256=args.expected_policy_sha256,
            expected_policy_id=args.expected_policy_id,
            expected_purpose=args.expected_purpose,
            mutate_image=dataset_mode and label == "negative",
        )
        print(f"submitting {args.flavor} job for {name} ...")
        result = submit_and_collect(
            api,
            image=args.image,
            flavor=args.flavor,
            timeout_seconds=args.timeout_seconds,
            script=script,
            token=token,
        )
        print(
            f"  job {result['jobId']} {result['stage']} preflight exit {result['preflightExit']}"
        )
        if result["report"] is not None:
            corpus = result["report"].get("declaredCorpusHash") or "unknown-corpus"
            report_path = f"geometry/preflight-reports/{corpus}/{revision}/{label}.json"
            report_bytes = (
                json.dumps(result["report"], indent=2, sort_keys=True) + "\n"
            ).encode("utf-8")
            report_commit = api.upload_file(
                path_or_fileobj=report_bytes,
                path_in_repo=report_path,
                repo_id=args.hub_repo,
                repo_type="model",
                commit_message=f"card-geometry preflight {label} {corpus[:12]}",
            )
            report_oid = getattr(report_commit, "oid", None)
            if not report_oid:
                raise RuntimeError(
                    f"report upload returned no commit oid: {report_commit!r}"
                )
            result["reportArtifact"] = {
                "path": report_path,
                "oid": report_oid,
            }
            print(f"  report {report_path} at commit {report_oid}")
        return result

    def finish(status: str) -> int:
        summary["status"] = status
        args.summary.parent.mkdir(parents=True, exist_ok=True)
        args.summary.write_text(
            json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        print(f"summary: {args.summary} ({status})")
        return 0 if status == "passed" else 1

    negative = submit("negative", args.negative_release)
    negative["problems"] = evaluate_negative(
        negative,
        None if dataset_mode else args.negative_release,
        {"IMAGE_HASH"} if dataset_mode else None,
    )
    summary["runs"]["negative"] = {
        "release": args.release_path if dataset_mode else args.negative_release,
        **negative,
    }
    if negative["problems"]:
        for problem in negative["problems"]:
            print(f"  negative run problem: {problem}")
        print(
            "negative smoke did not reject for the expected reason; not submitting the positive run"
        )
        return finish("failed-negative")

    positive = submit("positive", args.positive_release)
    positive["problems"] = evaluate_positive(
        positive,
        None if dataset_mode else args.positive_release,
        "tooling" if dataset_mode else None,
    )
    summary["runs"]["positive"] = {
        "release": args.release_path if dataset_mode else args.positive_release,
        **positive,
    }
    if positive["problems"]:
        for problem in positive["problems"]:
            print(f"  positive run problem: {problem}")
        return finish("failed-positive")
    return finish("passed")


if __name__ == "__main__":
    sys.exit(main())
