import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/card-geometry"))

from launch_geometry_bakeoff import base_config, bootstrap_command  # noqa: E402
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


if __name__ == "__main__":
    unittest.main()
