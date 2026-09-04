import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/card-geometry"))

from launch_geometry_bakeoff import base_config, bootstrap_command  # noqa: E402
from run_card_geometry_hf_job import descriptor  # noqa: E402


CORPUS = {
    "datasetRepo": "ahzs645/tcger-scanner-images",
    "datasetRevision": "a" * 40,
    "releasePath": "geometry/releases/training-v1",
    "corpusHash": "b" * 64,
    "policyId": "training-minimums-v2",
    "policySha256": "b86ce9823667212afdb0158113539a81c79e3a7cfe1509acea88f5afb186816d",
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
            hashes.add(descriptor(config)["fairnessHash"])
            self.assertEqual(config["fairness"]["budget"], {"kind": "epochs", "value": 50})
        self.assertEqual(len(hashes), 1)

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
        )
        self.assertIn("os.environ['HF_TOKEN']", command[-1])
        self.assertIn("--pipeline-smoke", command[-1])


if __name__ == "__main__":
    unittest.main()
