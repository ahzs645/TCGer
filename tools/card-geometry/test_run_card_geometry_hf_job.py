import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from corpus_release import load_json, load_schema, make_validator, validation_errors
from run_card_geometry_hf_job import (
    CONFIG_SCHEMA_FILE,
    ConfigurationError,
    PublicationBlocked,
    assert_export_allowed,
    checkpoint_prefix,
    descriptor,
    execute,
    experiment_hash,
    fairness_hash,
    resolve_config,
)

FIXTURE = ROOT / "fixtures" / "experiment-config.evaluation-only.v1.json"


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


if __name__ == "__main__":
    unittest.main()
