import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/card-geometry"))

from launch_geometry_bakeoff import successor_config, base_config, bootstrap_command, round_two_config  # noqa: E402
from run_card_geometry_hf_job import descriptor, resolve_config  # noqa: E402


CORPUS = {
    "datasetRepo": "ahzs645/tcger-scanner-images",
    "datasetRevision": "a" * 40,
    "releasePath": "geometry/releases/training-v1",
    "corpusHash": "b" * 64,
    "policyId": "training-minimums-v2",
    "policySha256": "b86ce9823667212afdb0158113539a81c79e3a7cfe1509acea88f5afb186816d",
    "preflightReport": {
        "path": "geometry/preflights/report.json",
        "sha256": "d" * 64,
    },
}


class LaunchGeometryBakeoffTests(unittest.TestCase):
    def test_round_two_candidates_require_v3_and_share_fairness(self):
        corpus = {**CORPUS, "policyId": "training-minimums-v3",
                  "policySha256": "679dd02c8e6280f2043978e007ea16d9608eba9a0c74ea2766477b885c4e56da"}
        hashes = set()
        for candidate in ("yolo11n-pose", "yolo11s-pose", "yolox-pose", "fastvit-t8-four-corner"):
            config = round_two_config(candidate=candidate, corpus=corpus,
                                      tooling_revision="c" * 40, epochs=50)
            self.assertEqual(config["corpus"]["policyId"], "training-minimums-v3")
            self.assertIn("measurements", config)
            hashes.add(descriptor(config)["fairnessHash"])
        self.assertEqual(len(hashes), 1)
        with self.assertRaisesRegex(ValueError, "training-minimums-v3"):
            round_two_config(candidate="yolo11n-pose", corpus=CORPUS,
                             tooling_revision="c" * 40, epochs=50)

    def test_round_two_binds_real_padding_and_renamed_evaluation_keys(self):
        config = round_two_config(candidate="yolox-pose", corpus={**CORPUS, "policyId":"training-minimums-v3"},
                                  tooling_revision="c" * 40, epochs=50)
        self.assertTrue(config["schema"].endswith("/v2"))
        self.assertIn("frozenReal", config["evaluations"])
        self.assertIn("syntheticMultigame", config["evaluations"])
        self.assertNotIn("frozenRealV3", config["evaluations"])
        self.assertEqual(config["fairness"]["realContextMarginPolicy"]["fraction"], .15)
        self.assertFalse(config["deviations"])
        original = descriptor(config)["fairnessHash"]
        config["fairness"]["realContextMarginPolicy"]["fraction"] = .2
        self.assertNotEqual(original, descriptor(resolve_config(config))["fairnessHash"])
        del config["fairness"]["realContextMarginPolicy"]
        with self.assertRaisesRegex(ValueError, "realContextMarginPolicy"):
            resolve_config(config)

    def test_all_candidate_configs_resolve_with_one_fairness_hash(self):
        hashes = set()
        for candidate in (
            "yolo11n-pose",
            "yolo11s-pose",
            "yolox-pose",
            "fastvit-t8-four-corner",
        ):
            config = base_config(
                candidate=candidate,
                corpus=CORPUS,
                tooling_revision="c" * 40,
                epochs=50,
            )
            resolved = resolve_config(config)
            hashes.add(descriptor(resolved)["fairnessHash"])
            self.assertEqual(config["fairness"]["budget"], {"kind": "epochs", "value": 50})
            self.assertTrue(
                descriptor(resolved)["checkpointPrefix"].startswith(
                    f"geometry/{candidate}/"
                )
            )
        self.assertEqual(len(hashes), 1)

    def test_pipeline_smoke_descriptor_uses_worker_resolved_config(self):
        config = base_config(
            candidate="yolo11n-pose",
            corpus=CORPUS,
            tooling_revision="c" * 40,
            epochs=50,
        )
        resolved = resolve_config(config, pipeline_smoke=True)
        report = descriptor(resolved)
        self.assertEqual(resolved["fairness"]["budget"], {"kind": "epochs", "value": 1})
        self.assertEqual(report["resolvedConfigSha256"], report["experimentHash"])
        self.assertNotEqual(report["experimentHash"], descriptor(resolve_config(config))["experimentHash"])

    def test_bootstrap_never_embeds_token_value(self):
        command = bootstrap_command(
            candidate="yolo11n-pose",
            checkpoint_repo="owner/private",
            hub_revision="a" * 40,
            tooling_path="tooling.tar.gz",
            tooling_sha="b" * 64,
            config_path="config.json",
            config_sha="c" * 64,
            pipeline_smoke=True,
            preflight_path="geometry/preflights/report.json",
            preflight_sha="d" * 64,
            action="train",
        )
        self.assertIn("os.environ['HF_TOKEN']", command[-1])
        self.assertIn("--pipeline-smoke", command[-1])
        self.assertIn("Pillow==11.1.0", command[-1])
        self.assertIn("numpy==1.26.4", command[-1])
        self.assertIn("opencv-python-headless==4.10.0.84", command[-1])
        self.assertIn("HF_HUB_DOWNLOAD_TIMEOUT=120", command[-1])

    def test_training_bootstrap_reasserts_numpy_after_framework_dependencies(self):
        for candidate in ("yolo11n-pose", "yolo11s-pose", "yolox-pose", "fastvit-t8-four-corner"):
            command = bootstrap_command(candidate=candidate, checkpoint_repo="owner/private",
                hub_revision="a" * 40, tooling_path="tooling.tar.gz", tooling_sha="b" * 64,
                config_path="config.json", config_sha="c" * 64, pipeline_smoke=False,
                preflight_path="preflight.json", preflight_sha="d" * 64)[-1]
            installs = [line for line in command.splitlines() if line.startswith("python -m pip install")]
            self.assertEqual(installs[-1], "python -m pip install --no-cache-dir numpy==1.26.4")
            self.assertGreater(command.index("NUMPY_RUNTIME_PIN_OK"), command.rfind("python -m pip install"))
            if candidate == "yolox-pose":
                self.assertLess(command.index("python tools/card-geometry/validate_yolox_runtime.py"),
                                command.index("python tools/card-geometry/run_card_geometry_hf_job.py"))

    def test_export_bootstrap_is_private_and_installs_converter(self):
        command = bootstrap_command(
            candidate="fastvit-t8-four-corner",
            checkpoint_repo="owner/private",
            hub_revision="a" * 40,
            tooling_path="tooling.tar.gz",
            tooling_sha="b" * 64,
            config_path="config.json",
            config_sha="c" * 64,
            pipeline_smoke=False,
            preflight_path="geometry/preflights/report.json",
            preflight_sha="d" * 64,
            action="export",
            export_format="coreml",
        )
        self.assertIn("coremltools==9.0", command[-1])
        self.assertGreater(
            command[-1].rfind("numpy==1.26.4"),
            command[-1].find("coremltools==9.0"),
        )
        self.assertIn("--action export --export-format coreml", command[-1])
        self.assertNotIn("asset-store", command[-1])

    def test_export_bootstrap_can_split_training_and_export_revisions(self):
        command = bootstrap_command(
            candidate="yolo11n-pose",
            checkpoint_repo="owner/private",
            hub_revision="a" * 40,
            tooling_path="tooling.tar.gz",
            tooling_sha="b" * 64,
            config_path="config.json",
            config_sha="c" * 64,
            pipeline_smoke=False,
            preflight_path="geometry/preflights/report.json",
            preflight_sha="d" * 64,
            action="export",
            export_format="onnx",
            training_input_revision="e" * 40,
        )
        self.assertIn(f"revision = {'a' * 40!r}", command[-1])
        self.assertIn(f"training_revision = {'e' * 40!r}", command[-1])
        self.assertIn("revision=training_revision", command[-1])
        self.assertGreater(
            command[-1].rfind("numpy==1.26.4"),
            command[-1].find("onnx==1.22.0"),
        )

    def test_mmyolo_bootstrap_uses_compatible_binary_wheel(self):
        command = bootstrap_command(
            candidate="yolox-pose",
            checkpoint_repo="owner/private",
            hub_revision="a" * 40,
            tooling_path="tooling.tar.gz",
            tooling_sha="b" * 64,
            config_path="config.json",
            config_sha="c" * 64,
            pipeline_smoke=False,
            preflight_path="geometry/preflights/report.json",
            preflight_sha="d" * 64,
        )
        self.assertIn("mmcv==2.0.1", command[-1])
        self.assertIn("cu117/torch2.0/index.html", command[-1])
        self.assertIn("numpy==1.26.4", command[-1])
        self.assertIn("torchvision==0.15.2", command[-1])
        self.assertIn("opencv-python-headless==4.10.0.84", command[-1])
        self.assertIn("6a1f2e65b0746353e94cf87d172503e00e98cc9b2529bb38718d278e6be63d9c", command[-1])
        self.assertIn("mmyolo/archive/8c4d9dc503dc8e327bec8147e8dc97124052f693.tar.gz", command[-1])
        self.assertIn("archive.parent.mkdir(parents=True, exist_ok=True)", command[-1])
        self.assertNotIn("git clone", command[-1])
        self.assertNotIn("mim install", command[-1])

        config = base_config(
            candidate="yolox-pose",
            corpus=CORPUS,
            tooling_revision="c" * 40,
            epochs=50,
        )
        train_command = config["execution"]["trainCommand"]
        self.assertEqual(config["deviations"][0]["rule"], "framework-internal-validation")
        self.assertIn(
            "3a8dfbd76b4493580449925f6cd01d1ae3b2b7425c6d1ed168dbe5282920c9b3",
            train_command,
        )

    def test_yolox_resume_lineage_is_hashed_and_corpus_scoped(self):
        resume = {
            "checkpointPrefix": f"geometry/yolox-pose/{CORPUS['corpusHash']}/parent",
            "checkpointSha256": "e" * 64,
            "epoch": 50,
            "jobId": "job-parent",
        }
        baseline = base_config(
            candidate="yolox-pose",
            corpus=CORPUS,
            tooling_revision="c" * 40,
            epochs=50,
        )
        resumed = base_config(
            candidate="yolox-pose",
            corpus=CORPUS,
            tooling_revision="c" * 40,
            epochs=50,
            resume_from=resume,
        )
        self.assertEqual(resumed["execution"]["resumeFrom"], resume)
        self.assertEqual(resumed["deviations"][-1]["rule"], "training-resume-lineage")
        self.assertNotEqual(descriptor(baseline)["experimentHash"], descriptor(resumed)["experimentHash"])
        self.assertEqual(descriptor(baseline)["fairnessHash"], descriptor(resumed)["fairnessHash"])


class SuccessorConfigTests(unittest.TestCase):
    def test_successor_config_binds_v4_and_carries_declared_repairs(self):
        corpus = {**CORPUS, "policyId": "training-minimums-v4",
                  "preflightReport": {"path": "geometry/preflights/x/y.json", "sha256": "1" * 64}}
        evaluations = dict(real_evaluation={"datasetRepo": "ahzs645/tcger-scanner-images", "datasetRevision": "3" * 40,
                                            "releasePath": "geometry/releases/real", "corpusHash": "4" * 64},
                           synthetic_evaluation={"datasetRepo": "ahzs645/tcger-scanner-images", "datasetRevision": "3" * 40,
                                                 "releasePath": "geometry/releases/synthetic", "corpusHash": "5" * 64})
        with self.assertRaisesRegex(ValueError, "training-minimums-v4"):
            successor_config(candidate="yolo11n-pose", corpus={**corpus, "policyId": "training-minimums-v3"},
                             tooling_revision="a" * 40, epochs=50, **evaluations)
        configs = {candidate: successor_config(candidate=candidate, corpus=corpus, tooling_revision="a" * 40,
                                               epochs=50, **evaluations)
                   for candidate in ("yolo11n-pose", "yolo11s-pose", "yolox-pose", "fastvit-t8-four-corner")}
        for candidate, config in configs.items():
            self.assertEqual(config["bakeoffId"], "shared-card-geometry-successor-v1")
            self.assertEqual(config["corpus"]["policyId"], "training-minimums-v4")
            self.assertEqual(config["fairness"]["seedPolicy"]["baseSeed"], 20260905)
            self.assertEqual(config["fairness"]["realContextMarginPolicy"]["fraction"], 0.15)
            self.assertIn("frozenReal", config["evaluations"])
            rules = [item["rule"] for item in config["deviations"]]
            self.assertIn("evaluation-script", rules)
            self.assertNotIn("framework-internal-validation", rules)
            if candidate == "yolox-pose":
                self.assertEqual(config["fairness"]["yoloxCornerLoss"]["kind"], "normalized-l1-v1")
                self.assertEqual(config["fairness"]["trainingSelfEvaluation"]["selection"], "all-training-records")
                self.assertIn("training-objective", rules)
            else:
                self.assertNotIn("yoloxCornerLoss", config["fairness"])
        # The three unrepaired candidates share round two's fairness contract;
        # YOLOX differs only through its declared loss-repair fairness fields.
        from run_card_geometry_hf_job import fairness_hash
        shared = {fairness_hash(c) for name, c in configs.items() if name != "yolox-pose"}
        self.assertEqual(len(shared), 1)
        self.assertNotIn(fairness_hash(configs["yolox-pose"]), shared)
        stripped = dict(configs["yolox-pose"])
        stripped["fairness"] = {k: v for k, v in stripped["fairness"].items()
                                if k not in {"yoloxCornerLoss", "trainingSelfEvaluation"}}
        self.assertEqual(fairness_hash(stripped), next(iter(shared)))


if __name__ == "__main__":
    unittest.main()
