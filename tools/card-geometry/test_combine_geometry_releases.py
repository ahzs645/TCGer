import sys
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from combine_geometry_releases import combine, link_or_copy  # noqa: E402
from corpus_release import RELEASES_DIR, load_json, sha256_file, write_json  # noqa: E402


class CombineGeometryReleasesTests(unittest.TestCase):
    def test_link_or_copy_preserves_exact_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.bin"
            destination = root / "destination.bin"
            source.write_bytes(b"immutable release bytes")
            method = link_or_copy(source, destination)
            self.assertIn(method, {"hardlink", "copy"})
            self.assertEqual(destination.read_bytes(), source.read_bytes())

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
            self.assertEqual(
                manifest["sourceArchiveAliases"],
                load_json(RELEASES_DIR / "valid-fixture" / "manifest.json")["sourceArchiveAliases"],
            )
            for entry in manifest["records"]:
                self.assertEqual(entry["sourceTier"], "shippable")
                self.assertTrue((output / entry["path"]).is_file())
            self.assertEqual(load_json(output / "policy.json")["policyId"], "training-minimums-v2")

    def test_conflicting_aliases_cannot_be_combined(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            other = root / "other"
            shutil.copytree(RELEASES_DIR / "valid-fixture", other)
            manifest = load_json(other / "manifest.json")
            manifest["sourceArchiveAliases"]["fixture-devmode-validation"] = "fixture-devmode-test"
            write_json(other / "manifest.json", manifest)
            with self.assertRaisesRegex(ValueError, "conflicting archive alias"):
                combine(
                    inputs=[RELEASES_DIR / "valid-fixture", other],
                    output=root / "combined", release_id="conflict",
                    policy_path=ROOT / "policies" / "training-minimums-v2.json",
                )


if __name__ == "__main__":
    unittest.main()
