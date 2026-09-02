import copy
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from build_fixture_releases import (  # noqa: E402
    BUILDERS,
    EXPECTED_FAILED_CHECKS,
    EXPECTED_READY_FOR,
    FIXTURE_POLICY,
    TRAINING_POLICY,
    build_all,
)
from corpus_release import (  # noqa: E402
    MANIFEST_SCHEMA_FILE,
    POLICY_SCHEMA_FILE,
    RELEASES_DIR,
    corpus_hash,
    load_json,
    load_schema,
    make_validator,
    sha256_file,
    validation_errors,
    write_json,
)
from hf_preflight_smoke import job_script  # noqa: E402
from preflight import (  # noqa: E402
    CHECK_ORDER,
    EXIT_CHECKS_FAILED,
    EXIT_OK,
    EXIT_UNREADABLE,
    Expectations,
    run_preflight,
)


def _tree(root: Path) -> dict[str, bytes]:
    return {
        str(path.relative_to(root)): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


class ReleaseSchemaTests(unittest.TestCase):
    def test_new_schemas_are_valid_draft_2020_12(self):
        for filename in (MANIFEST_SCHEMA_FILE, POLICY_SCHEMA_FILE):
            with self.subTest(schema=filename):
                schema = load_schema(filename)
                self.assertEqual(
                    schema["$schema"], "https://json-schema.org/draft/2020-12/schema"
                )
                self.assertFalse(schema["additionalProperties"])
                make_validator(schema)

    def test_bundled_policies_validate(self):
        validator = make_validator(load_schema(POLICY_SCHEMA_FILE))
        for policy in (FIXTURE_POLICY, TRAINING_POLICY):
            with self.subTest(policy=policy["policyId"]):
                self.assertEqual(validation_errors(validator, policy), [])

    def test_manifest_schema_rejects_parent_traversal_paths(self):
        validator = make_validator(load_schema(MANIFEST_SCHEMA_FILE))
        manifest = load_json(RELEASES_DIR / "valid-fixture" / "manifest.json")
        manifest["readiness"]["readinessPolicyPath"] = "../policy.json"
        errors = validation_errors(validator, manifest)
        self.assertTrue(any("readinessPolicyPath" in error for error in errors), errors)


class FixtureReleaseTests(unittest.TestCase):
    def test_committed_releases_match_the_generator(self):
        with tempfile.TemporaryDirectory() as tmp:
            regenerated = Path(tmp)
            build_all(regenerated)
            for name in BUILDERS:
                with self.subTest(release=name):
                    self.assertEqual(
                        _tree(regenerated / name), _tree(RELEASES_DIR / name)
                    )

    def test_expected_outcome_tables_cover_every_release(self):
        self.assertEqual(set(BUILDERS), set(EXPECTED_FAILED_CHECKS))
        self.assertEqual(set(BUILDERS), set(EXPECTED_READY_FOR))
        for codes in EXPECTED_FAILED_CHECKS.values():
            self.assertTrue(codes <= set(CHECK_ORDER), codes)


class PreflightTests(unittest.TestCase):
    def run_release(self, name: str, **expectations) -> dict:
        return run_preflight(
            RELEASES_DIR / name,
            expectations=Expectations(**expectations),
            tooling_revision="test",
        )

    def test_every_release_fails_exactly_its_expected_checks(self):
        for name, expected in EXPECTED_FAILED_CHECKS.items():
            with self.subTest(release=name):
                report = self.run_release(name)
                self.assertEqual(set(report["failedChecks"]), set(expected))
                self.assertEqual(report["readyFor"], EXPECTED_READY_FOR[name])
                self.assertEqual(
                    [check["code"] for check in report["checks"]], list(CHECK_ORDER)
                )

    def test_valid_fixture_release_is_never_ready_for_training(self):
        report = self.run_release("valid-fixture")
        self.assertEqual(report["failedChecks"], [])
        self.assertEqual(report["readyFor"], "tooling")

        gated = self.run_release("valid-fixture", purpose="training")
        self.assertEqual(gated["failedChecks"], ["RELEASE_PURPOSE"])
        self.assertEqual(gated["readyFor"], "none")

    def test_policy_hash_expectation_is_enforced(self):
        policy_sha = sha256_file(RELEASES_DIR / "valid-fixture" / "policy.json")
        matching = self.run_release(
            "valid-fixture", policy_sha256=policy_sha, policy_id="fixture-minimums-v1"
        )
        self.assertEqual(matching["failedChecks"], [])

        mismatched = self.run_release("valid-fixture", policy_sha256="0" * 64)
        self.assertEqual(mismatched["failedChecks"], ["POLICY_HASH"])
        self.assertEqual(mismatched["readyFor"], "none")

        wrong_id = self.run_release(
            "valid-fixture", policy_id="training-minimums-draft-v1"
        )
        self.assertEqual(wrong_id["failedChecks"], ["POLICY_HASH"])

    def test_corpus_hash_expectation_is_enforced(self):
        declared = load_json(RELEASES_DIR / "valid-fixture" / "manifest.json")[
            "corpusHash"
        ]
        matching = self.run_release("valid-fixture", corpus_hash=declared)
        self.assertEqual(matching["failedChecks"], [])
        mismatched = self.run_release("valid-fixture", corpus_hash="0" * 64)
        self.assertEqual(mismatched["failedChecks"], ["CORPUS_HASH"])
        self.assertEqual(mismatched["readyFor"], "none")

    def test_empty_training_release_fails_minimums_and_is_not_ready(self):
        report = self.run_release("empty-training", purpose="training")
        self.assertEqual(report["failedChecks"], ["READINESS_MINIMUMS"])
        self.assertEqual(report["readyFor"], "none")
        minimums = next(
            check for check in report["checks"] if check["code"] == "READINESS_MINIMUMS"
        )
        self.assertIn(
            "required split train has no records", minimums["details"]["shortfalls"]
        )

    def test_corner_counts_report_evaluated_eligible_skipped_by_slice(self):
        report = self.run_release("valid-fixture")
        counts = report["cornerCounts"]
        self.assertEqual(counts["bySourceKind"]["synthetic"]["eligible"], 8)
        self.assertEqual(counts["bySourceKind"]["synthetic"]["skipped"], 0)
        self.assertEqual(
            counts["bySourceKind"]["synthetic"]["visibility:outsideFrame"], 2
        )
        self.assertEqual(counts["bySourceKind"]["real"]["eligible"], 8)
        self.assertEqual(counts["bySourceKind"]["real"]["skipped"], 1)
        self.assertEqual(counts["bySceneSlice"]["single_handheld"]["evaluated"], 7)

        # Corner provenance: the synthetic frame is metric-eligible in full, the
        # real validation frame carries one maskFit corner that is reported but
        # excluded, and evaluated always equals metricEligible + metricExcluded.
        self.assertEqual(counts["metricEligibleCornerSources"], ["human", "synthetic"])
        synthetic = counts["bySourceKind"]["synthetic"]
        self.assertEqual(synthetic["metricEligible"], 8)
        self.assertEqual(synthetic["metricExcluded"], 0)
        self.assertEqual(synthetic["cornerSource:synthetic"], 8)
        real = counts["bySourceKind"]["real"]
        self.assertEqual(real["evaluated"], 7)
        self.assertEqual(real["metricEligible"], 6)
        self.assertEqual(real["metricExcluded"], 1)
        self.assertEqual(real["cornerSource:human"], 6)
        self.assertEqual(real["cornerSource:maskFit"], 1)
        for bucket in (*counts["bySourceKind"].values(), *counts["bySplit"].values()):
            self.assertEqual(
                bucket["evaluated"], bucket["metricEligible"] + bucket["metricExcluded"]
            )

    def test_known_corner_requires_a_corner_source(self):
        from corpus_release import RECORD_SCHEMA_FILE

        validator = make_validator(load_schema(RECORD_SCHEMA_FILE))
        record = load_json(
            RELEASES_DIR / "valid-fixture" / "records" / "fx-test-real-001.json"
        )
        self.assertEqual(validation_errors(validator, record), [])
        del record["instances"][0]["corners"][0]["cornerSource"]
        errors = validation_errors(validator, record)
        self.assertTrue(any("cornerSource" in error for error in errors), errors)

        record["instances"][0]["corners"][0]["cornerSource"] = "detector"
        self.assertEqual(validation_errors(validator, record), [])

    def test_policy_cannot_admit_fitted_or_detected_corners_to_metrics(self):
        validator = make_validator(load_schema(POLICY_SCHEMA_FILE))
        policy = copy.deepcopy(FIXTURE_POLICY)
        for source in ("maskFit", "detector"):
            policy["metricEligibleCornerSources"] = ["human", source]
            errors = validation_errors(validator, policy)
            self.assertTrue(
                any("metricEligibleCornerSources" in error for error in errors), errors
            )
        del policy["metricEligibleCornerSources"]
        errors = validation_errors(validator, policy)
        self.assertTrue(
            any("metricEligibleCornerSources" in error for error in errors), errors
        )

    def test_source_archive_is_a_cross_split_leakage_key(self):
        report = self.run_release("invalid-source-archive-leakage")
        self.assertEqual(report["failedChecks"], ["LEAKAGE_DISJOINT"])
        leakage = next(
            check for check in report["checks"] if check["code"] == "LEAKAGE_DISJOINT"
        )
        self.assertEqual(
            leakage["details"]["leaks"],
            {
                "sourceArchiveId:fixture-devmode-validation": [
                    "test",
                    "validation",
                ]
            },
        )

    def test_duplicate_manifest_records_cannot_inflate_readiness(self):
        with tempfile.TemporaryDirectory() as tmp:
            release = Path(tmp) / "duplicate-record"
            shutil.copytree(RELEASES_DIR / "valid-fixture", release)
            manifest_path = release / "manifest.json"
            manifest = load_json(manifest_path)
            manifest["records"].append(copy.deepcopy(manifest["records"][0]))
            manifest["corpusHash"] = corpus_hash(manifest)
            write_json(manifest_path, manifest)

            report = run_preflight(release, tooling_revision="test")

        self.assertEqual(report["failedChecks"], ["MANIFEST_RECORD_CONSISTENCY"])
        consistency = next(
            check
            for check in report["checks"]
            if check["code"] == "MANIFEST_RECORD_CONSISTENCY"
        )
        self.assertTrue(
            any(
                detail.startswith("duplicate record recordId")
                for detail in consistency["details"]["failures"]["<manifest>"]
            )
        )

    def test_missing_release_is_unreadable(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = run_preflight(Path(tmp) / "nowhere", tooling_revision="test")
        self.assertEqual(report["failedChecks"], ["MANIFEST_LOAD"])
        self.assertEqual(report["readyFor"], "none")


class PreflightCliTests(unittest.TestCase):
    def run_cli(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [
                sys.executable,
                str(ROOT / "preflight.py"),
                "--tooling-revision",
                "test",
                *args,
            ],
            capture_output=True,
            text=True,
        )

    def test_exit_codes_and_report_markers(self):
        with tempfile.TemporaryDirectory() as tmp:
            report_path = Path(tmp) / "report.json"
            ok = self.run_cli(
                "--release-root",
                str(RELEASES_DIR / "valid-fixture"),
                "--report",
                str(report_path),
                "--print-report",
            )
            self.assertEqual(ok.returncode, EXIT_OK, ok.stdout + ok.stderr)
            self.assertIn("PREFLIGHT_REPORT_BEGIN", ok.stdout)
            written = json.loads(report_path.read_text())
            self.assertEqual(written["readyFor"], "tooling")

            failed = self.run_cli(
                "--release-root", str(RELEASES_DIR / "invalid-leakage")
            )
            self.assertEqual(failed.returncode, EXIT_CHECKS_FAILED)
            self.assertIn("fail  LEAKAGE_DISJOINT", failed.stdout)

            unreadable = self.run_cli("--release-root", str(Path(tmp) / "missing"))
            self.assertEqual(unreadable.returncode, EXIT_UNREADABLE)

    def test_hf_smoke_rejects_mutable_container_tags(self):
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "hf_preflight_smoke.py"),
                "--dry-run",
                "--image",
                "python:3.12-slim",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("--image must be pinned by sha256 digest", result.stderr)

    def test_real_release_job_pins_dataset_and_mutates_only_an_image(self):
        script = job_script(
            hub_repo="owner/model",
            tooling_path="geometry/tooling/rev/tooling.tar.gz",
            tooling_oid="a" * 40,
            tooling_sha256="b" * 64,
            release_name=None,
            git_revision="c" * 40,
            dataset_repo="owner/private-data",
            dataset_revision="d" * 40,
            release_path="geometry/releases/smoke-v1",
            expected_corpus_hash="e" * 64,
            expected_policy_sha256="f" * 64,
            expected_policy_id="real-ingestion-smoke-v1",
            expected_purpose="smoke",
            mutate_image=True,
        )
        self.assertIn("revision='dddddddddddddddddddddddddddddddddddddddd'", script)
        self.assertIn("manifest['records'][0]['images'][0]['path']", script)
        self.assertIn("--expected-corpus-hash " + "e" * 64, script)
        self.assertIn("--expected-policy-sha256 " + "f" * 64, script)
        self.assertNotIn("manifest.json').write", script)

    def test_hf_smoke_rejects_mutable_dataset_revision(self):
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "hf_preflight_smoke.py"),
                "--dry-run",
                "--dataset-repo",
                "owner/data",
                "--dataset-revision",
                "main",
                "--release-path",
                "geometry/releases/smoke-v1",
                "--expected-corpus-hash",
                "e" * 64,
                "--expected-policy-sha256",
                "f" * 64,
                "--expected-purpose",
                "smoke",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("immutable 40-hex commit oid", result.stderr)


if __name__ == "__main__":
    unittest.main()
