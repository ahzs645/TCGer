import copy
import json
import shutil
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from corpus_release import (  # noqa: E402
    RELEASES_DIR,
    corpus_hash,
    leakage_keys_from_record,
    load_json,
    load_schema,
    make_validator,
    validation_errors,
    sha256_file,
    write_json,
)
from run_card_geometry_hf_job import (  # noqa: E402
    CONFIG_SCHEMA_FILE,
    ConfigurationError,
    PublicationBlocked,
    assert_export_allowed,
    checkpoint_prefix,
    check_cross_release_leakage,
    descriptor,
    execute,
    experiment_hash,
    export_checkpoint_patterns,
    fairness_hash,
    materialize_downloaded_release,
    resolve_config,
    prepare_training_evaluations,
    _download_evaluation_release,
)

FIXTURE = ROOT / "fixtures" / "experiment-config.evaluation-only.v1.json"


class CrossReleaseLeakageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.training = self.root / "training"
        self.evaluation = self.root / "evaluation"
        shutil.copytree(RELEASES_DIR / "cross-release-fork-training", self.training)
        shutil.copytree(RELEASES_DIR / "cross-release-fork-evaluation", self.evaluation)

    def test_fork_in_training_leaks_against_evaluation_parent(self):
        report = check_cross_release_leakage(self.training, {"real": self.evaluation})
        self.assertEqual(report["failedChecks"], ["CROSS_RELEASE_LEAKAGE_DISJOINT"])
        self.assertEqual(report["leaks"], {"real": ["sourceArchiveId:card-seg-j74w1"]})

    def test_identical_image_in_independent_archive_leaks(self):
        training = RELEASES_DIR / "cross-release-image-training"
        train_manifest = load_json(training / "manifest.json")
        eval_manifest = load_json(self.evaluation / "manifest.json")
        train_image = train_manifest["records"][0]["images"][0]
        eval_image = eval_manifest["records"][0]["images"][0]
        self.assertEqual((training / train_image["path"]).read_bytes(), (self.evaluation / eval_image["path"]).read_bytes())
        self.assertEqual(train_manifest["sourceArchiveAliases"], {"fixture-independent-training": "fixture-independent-training"})
        self.assertTrue(set(train_manifest["sourceArchiveAliases"]).isdisjoint(eval_manifest["sourceArchiveAliases"]))
        report = check_cross_release_leakage(training, {"real": self.evaluation})
        self.assertEqual(report["failedChecks"], ["CROSS_RELEASE_LEAKAGE_DISJOINT"])
        self.assertEqual(report["archiveAliasConflicts"], {})
        self.assertEqual(report["leaks"], {"real": [f"imageSha256:{train_image['sha256']}"]})

    def test_conflicting_alias_knowledge_fails_closed(self):
        self._separate_archives()
        manifest = load_json(self.evaluation / "manifest.json")
        manifest["sourceArchiveAliases"]["card-seg-j74w1-q8yst"] = "card-seg-j74w1"
        write_json(self.evaluation / "manifest.json", manifest)
        self._refresh(self.evaluation)
        report = check_cross_release_leakage(self.training, {"real": self.evaluation})
        self.assertEqual(report["failedChecks"], ["CROSS_RELEASE_LEAKAGE_DISJOINT"])
        self.assertIn("card-seg-j74w1-q8yst", report["archiveAliasConflicts"])

    def test_download_preflight_enforces_evaluation_hash_pin(self):
        hub = types.SimpleNamespace(snapshot_download=lambda **kwargs: str(self.root))
        spec = {"datasetRepo": "fixture/repo", "datasetRevision": "a" * 40, "releasePath": "evaluation", "corpusHash": "0" * 64}
        with patch.dict(sys.modules, {"huggingface_hub": hub}):
            with self.assertRaisesRegex(RuntimeError, "CORPUS_HASH"):
                _download_evaluation_release(spec, "unused", self.root / "job", "real")

    def _separate_archives(self):
        manifest = load_json(self.training / "manifest.json")
        manifest["sourceArchiveAliases"]["card-seg-j74w1-q8yst"] = "independent-training"
        manifest["sourceArchiveAliases"]["independent-training"] = "independent-training"
        write_json(self.training / "manifest.json", manifest)
        self._refresh(self.training)

    def _refresh(self, root):
        manifest = load_json(root / "manifest.json")
        for entry in manifest["records"]:
            record = load_json(root / entry["path"])
            entry["sha256"] = sha256_file(root / entry["path"])
            entry["leakageKeys"] = leakage_keys_from_record(record, manifest["sourceArchiveAliases"])
        manifest["corpusHash"] = corpus_hash(manifest)
        write_json(root / "manifest.json", manifest)

    def test_other_leakage_keys_are_independent_of_archive_id(self):
        self._separate_archives()
        self.assertEqual(check_cross_release_leakage(self.training, {"real": self.evaluation})["failedChecks"], [])
        for key in ("sessionId", "sourceAssetId", "physicalCardId"):
            saved = []
            for root in (self.training, self.evaluation):
                manifest = load_json(root / "manifest.json")
                path = root / manifest["records"][0]["path"]
                saved.append((path, path.read_bytes()))
                record = load_json(path)
                if key == "sessionId":
                    record["grouping"][key] = "shared"
                else:
                    record["instances"][0][key] = "shared"
                write_json(path, record)
                self._refresh(root)
            with self.subTest(key=key):
                report = check_cross_release_leakage(self.training, {"real": self.evaluation})
                self.assertEqual(report["leaks"]["real"], [f"{key}:shared"])
            for path, content in saved:
                path.write_bytes(content)
            self._refresh(self.training)
            self._refresh(self.evaluation)

    def test_all_pinned_releases_checked_without_evaluation_command(self):
        self._separate_archives()
        resolved = resolve_config(load_json(FIXTURE))
        self.assertNotIn("evaluationCommand", resolved["execution"])
        spec = resolved["evaluations"]["frozenRealV3"]
        resolved["evaluations"]["thirdEvaluation"] = spec
        output = self.root / "output"
        output.mkdir()
        with patch("run_card_geometry_hf_job._download_evaluation_release", return_value=self.evaluation) as download:
            roots = prepare_training_evaluations(resolved, self.training, "unused", self.root, output)
        self.assertEqual(set(roots), {"frozenRealV3", "syntheticDuelField", "thirdEvaluation"})
        self.assertEqual(download.call_count, 3)
        self.assertEqual(load_json(output / "cross-release-leakage.json")["failedChecks"], [])

    def test_leakage_blocks_train_command(self):
        resolved = resolve_config(load_json(FIXTURE))
        module = "run_card_geometry_hf_job"
        hub = types.SimpleNamespace(HfApi=lambda **kwargs: object(), snapshot_download=lambda **kwargs: None)
        for training in (self.training, RELEASES_DIR / "cross-release-image-training"):
            with self.subTest(training=training.name):
                self._assert_training_blocked(resolved, module, hub, training)

    def _assert_training_blocked(self, resolved, module, hub, training):
        with patch.dict(sys.modules, {"huggingface_hub": hub}), \
             patch(f"{module}._verify_local_artifacts"), \
             patch(f"{module}._hub_token", return_value="unused"), \
             patch(f"{module}._require_private_model_repo"), \
             patch(f"{module}._upload_json", return_value="fixture-commit"), \
             patch(f"{module}._download_and_preflight", return_value=(training, {})), \
             patch(f"{module}._download_evaluation_release", return_value=self.evaluation), \
             patch(f"{module}._run") as run:
            with self.assertRaisesRegex(RuntimeError, "CROSS_RELEASE_LEAKAGE_DISJOINT"):
                execute(resolved, action="train", export_format=None, export_destination="private-model-repo", workdir=self.root / f"job-{training.name}")
        run.assert_not_called()



class CandidateExperimentConfigTests(unittest.TestCase):
    def setUp(self):
        self.raw = load_json(FIXTURE)

    def test_schema_is_draft_2020_12_and_fixture_validates(self):
        schema = load_schema(CONFIG_SCHEMA_FILE)
        self.assertEqual(
            schema["$schema"], "https://json-schema.org/draft/2020-12/schema"
        )
        self.assertFalse(schema["additionalProperties"])
        validator = make_validator(schema)
        self.assertEqual(validation_errors(validator, self.raw), [])

    def test_pipeline_smoke_is_hashed_and_restricted_to_yolo11n(self):
        raw = copy.deepcopy(self.raw)
        raw["fairness"]["budget"] = {"kind": "epochs", "value": 50}
        resolved = resolve_config(raw, pipeline_smoke=True)
        self.assertEqual(resolved["fairness"]["budget"], {"kind": "epochs", "value": 1})
        self.assertEqual(resolved["fairness"]["seedPolicy"]["repeatCount"], 1)
        self.assertEqual(resolved["deviations"][-1]["rule"], "budget")
        self.assertNotEqual(experiment_hash(resolved), experiment_hash(resolve_config(raw)))

        raw["candidate"] = "yolo11s-pose"
        with self.assertRaises(ConfigurationError):
            resolve_config(raw, pipeline_smoke=True)

    def test_defaults_are_applied_before_hashing(self):
        explicit = resolve_config(self.raw)
        relying_on_defaults = copy.deepcopy(self.raw)
        del relying_on_defaults["bakeoffId"]
        del relying_on_defaults["deviations"]
        del relying_on_defaults["measurements"]
        del relying_on_defaults["fairness"]["inputResolution"]
        del relying_on_defaults["fairness"]["augmentationProfile"]
        del relying_on_defaults["fairness"]["seedPolicy"]
        defaulted = resolve_config(relying_on_defaults)
        self.assertEqual(defaulted, explicit)
        self.assertEqual(experiment_hash(defaulted), experiment_hash(explicit))

    def test_checkpoint_path_is_content_scoped(self):
        resolved = resolve_config(self.raw)
        digest = experiment_hash(resolved)
        self.assertEqual(
            checkpoint_prefix(resolved),
            "geometry/yolo11n-pose/"
            + self.raw["corpus"]["corpusHash"]
            + "/"
            + digest,
        )
        run = descriptor(resolved)
        self.assertEqual(run["resolvedConfigSha256"], digest)
        self.assertEqual(run["experimentHash"], digest)

    def test_every_fairness_deviation_changes_experiment_identity(self):
        baseline = resolve_config(self.raw)
        changed = copy.deepcopy(self.raw)
        changed["deviations"] = [
            {
                "rule": "augmentation",
                "candidateValue": "framework-equivalent-v1",
                "reason": "MMYOLO cannot reproduce one photometric transform exactly",
            }
        ]
        self.assertNotEqual(
            experiment_hash(baseline), experiment_hash(resolve_config(changed))
        )

    def test_fairness_hash_is_shared_across_candidates(self):
        yolo = resolve_config(self.raw)
        yolox_raw = copy.deepcopy(self.raw)
        yolox_raw["candidate"] = "yolox-pose"
        yolox_raw["framework"] = "mmyolo"
        yolox_raw["licenseRoute"] = "permissive"
        yolox_raw["execution"]["trainCommand"] = ["python", "train_yolox.py"]
        yolox = resolve_config(yolox_raw)
        self.assertEqual(fairness_hash(yolo), fairness_hash(yolox))
        self.assertNotEqual(experiment_hash(yolo), experiment_hash(yolox))

        changed_budget = copy.deepcopy(yolox_raw)
        changed_budget["fairness"]["budget"]["value"] = 2
        self.assertNotEqual(
            fairness_hash(yolo), fairness_hash(resolve_config(changed_budget))
        )

    def test_candidate_framework_pair_is_enforced(self):
        invalid = copy.deepcopy(self.raw)
        invalid["framework"] = "mmyolo"
        with self.assertRaisesRegex(ConfigurationError, "requires framework"):
            resolve_config(invalid)

    def test_ultralytics_evaluation_only_can_train_but_cannot_publish(self):
        resolved = resolve_config(self.raw)
        assert_export_allowed(resolved, "private-model-repo")
        with self.assertRaisesRegex(PublicationBlocked, "evaluation-only"):
            assert_export_allowed(resolved, "asset-store")

        # The guard runs before Hub access, workdir creation, or an exporter command.
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "must-not-exist"
            with self.assertRaises(PublicationBlocked):
                execute(
                    resolved,
                    action="export",
                    export_format="onnx",
                    export_destination="asset-store",
                    workdir=target,
                )
            self.assertFalse(target.exists())

    def test_enterprise_and_agpl_unlock_ultralytics_publication(self):
        for route in ("enterprise", "agpl"):
            with self.subTest(route=route):
                raw = copy.deepcopy(self.raw)
                raw["licenseRoute"] = route
                assert_export_allowed(resolve_config(raw), "asset-store")

    def test_permissive_candidates_keep_permissive_route(self):
        cases = (
            ("yolox-pose", "mmyolo"),
            ("fastvit-t8-four-corner", "tcger-pytorch"),
        )
        for candidate, framework in cases:
            with self.subTest(candidate=candidate):
                raw = copy.deepcopy(self.raw)
                raw["candidate"] = candidate
                raw["framework"] = framework
                raw["licenseRoute"] = "permissive"
                resolved = resolve_config(raw)
                assert_export_allowed(resolved, "asset-store")

                raw["licenseRoute"] = "evaluation-only"
                with self.assertRaisesRegex(ConfigurationError, "permissive"):
                    resolve_config(raw)

    def test_training_policy_and_fairness_invariants_are_schema_enforced(self):
        invalid_cases = []
        wrong_policy = copy.deepcopy(self.raw)
        wrong_policy["corpus"]["policyId"] = "generated-from-corpus"
        invalid_cases.append(wrong_policy)
        wrong_resolution = copy.deepcopy(self.raw)
        wrong_resolution["fairness"]["inputResolution"] = 768
        invalid_cases.append(wrong_resolution)
        mutable_image = copy.deepcopy(self.raw)
        mutable_image["execution"]["containerImage"] = "example/image:latest"
        invalid_cases.append(mutable_image)
        public_repo = copy.deepcopy(self.raw)
        public_repo["execution"]["checkpointRepoPrivate"] = False
        invalid_cases.append(public_repo)

        for index, invalid in enumerate(invalid_cases):
            with self.subTest(case=index), self.assertRaises(ConfigurationError):
                resolve_config(invalid)

    def test_artifact_hash_is_checked_before_hub_access(self):
        invalid = copy.deepcopy(self.raw)
        invalid["fairness"]["evaluationScript"]["sha256"] = "0" * 64
        resolved = resolve_config(invalid)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "must-not-exist"
            with self.assertRaisesRegex(RuntimeError, "evaluationScript SHA-256"):
                execute(
                    resolved,
                    action="train",
                    export_format=None,
                    export_destination="private-model-repo",
                    workdir=target,
                )
            self.assertFalse(target.exists())

    def test_fixture_round_trips_as_json(self):
        resolved = resolve_config(self.raw)
        self.assertEqual(json.loads(json.dumps(resolved)), resolved)

    def test_export_downloads_only_the_release_checkpoint(self):
        prefix = "geometry/candidate/corpus/experiment"
        self.assertEqual(
            export_checkpoint_patterns("yolo11n-pose", prefix),
            [f"{prefix}/training-output/training/repeat-0/weights/best.pt"],
        )
        self.assertEqual(
            export_checkpoint_patterns("fastvit-t8-four-corner", prefix),
            [f"{prefix}/training-output/training/repeat-0/best.pt"],
        )
        yolox = export_checkpoint_patterns("yolox-pose", prefix)
        self.assertEqual(len(yolox), 2)
        self.assertTrue(yolox[0].endswith("/*.pth"))
        self.assertTrue(yolox[1].endswith("/yolox-pose-card.py"))

    def test_materializes_transport_shards_to_canonical_layout(self):
        import hashlib

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            canonical = Path("records/one.json")
            shard = hashlib.sha256(canonical.as_posix().encode("utf-8")).hexdigest()[:2]
            (source / "records" / shard).mkdir(parents=True)
            (source / "records" / shard / "one.json").write_text("{}")
            (source / "manifest.json").write_text("{}")
            (source / "_transport-layout.v1.json").write_text(
                json.dumps(
                    {
                        "schema": "https://tcger.app/datasets/card-geometry-transport-layout/v1",
                        "algorithm": "sha256-relative-path-prefix",
                        "prefixLength": 2,
                        "directories": ["records"],
                    }
                )
            )
            destination = root / "destination"
            materialize_downloaded_release(source, destination)
            self.assertEqual((destination / canonical).read_text(), "{}")
            self.assertEqual((destination / "manifest.json").read_text(), "{}")
            self.assertFalse((destination / "_transport-layout.v1.json").exists())

    def test_rejects_transport_file_in_wrong_shard(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            (source / "records/zz").mkdir(parents=True)
            (source / "records/zz/one.json").write_text("{}")
            (source / "_transport-layout.v1.json").write_text(
                json.dumps(
                    {
                        "schema": "https://tcger.app/datasets/card-geometry-transport-layout/v1",
                        "algorithm": "sha256-relative-path-prefix",
                        "prefixLength": 2,
                        "directories": ["records"],
                    }
                )
            )
            with self.assertRaisesRegex(RuntimeError, "transport shard mismatch"):
                materialize_downloaded_release(source, root / "destination")


if __name__ == "__main__":
    unittest.main()
