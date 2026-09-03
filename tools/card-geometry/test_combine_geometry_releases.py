import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from combine_geometry_releases import combine  # noqa: E402
from corpus_release import RELEASES_DIR, load_json, sha256_file  # noqa: E402


class CombineGeometryReleasesTests(unittest.TestCase):
    def test_combines_shippable_parts_under_exact_training_policy(self):
        policy = ROOT / "policies" / "training-minimums-v2.json"
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "combined"
            manifest = combine(
                inputs=[RELEASES_DIR / "valid-fixture"],
                output=output,
                release_id="combined-training-v1",
                policy_path=policy,
            )
            self.assertEqual(manifest["releasePurpose"], "training")
            self.assertEqual(
                manifest["readiness"]["readinessPolicySha256"], sha256_file(policy)
            )
            self.assertEqual(len(manifest["records"]), 3)
            for entry in manifest["records"]:
                self.assertEqual(entry["sourceTier"], "shippable")
                self.assertTrue((output / entry["path"]).is_file())
            self.assertEqual(load_json(output / "policy.json")["policyId"], "training-minimums-v2")


if __name__ == "__main__":
    unittest.main()
