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
    def test_v3_requires_external_evaluations_and_forbids_embedded_test(self):
        policy = ROOT / "policies" / "training-minimums-v3.json"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(ValueError, "separately pinned"):
                combine(inputs=[RELEASES_DIR / "valid-fixture"], output=root / "missing",
                        release_id="v3", policy_path=policy)
            evaluations = {name: RELEASES_DIR / "valid-fixture"
                           for name in ("frozenReal", "syntheticMultigame")}
            with self.assertRaisesRegex(ValueError, "must not embed test"):
                combine(inputs=[RELEASES_DIR / "valid-fixture"], output=root / "test",
                        release_id="v3", policy_path=policy, evaluation_releases=evaluations)

    def test_v4_policy_is_pinned_and_requires_target_semantics(self):
        from corpus_release import sha256_file
        from combine_geometry_releases import CATEGORY_REPAIR_POLICY_SHA256, ROUND_TWO_POLICY_SHA256

        v3 = load_json(ROOT / "policies" / "training-minimums-v3.json")
        v4_path = ROOT / "policies" / "training-minimums-v4.json"
        v4 = load_json(v4_path)
        self.assertEqual(sha256_file(v4_path), CATEGORY_REPAIR_POLICY_SHA256)
        self.assertEqual(sha256_file(ROOT / "policies" / "training-minimums-v3.json"), ROUND_TWO_POLICY_SHA256)
        self.assertTrue(v4["requireTargetSemantics"])
        self.assertNotIn("requireTargetSemantics", v3)
        # Split totals are unchanged; v4 adds the semantic requirement and
        # re-partitions the real archive slices by measured layout.
        for key in ("minimumRecordsPerSplit", "minimumInstancesPerSplit",
                    "minimumMetricEligibleInstances",
                    "requiredLeakageKeys", "metricEligibleCornerSources", "allowedSourceTiers"):
            self.assertEqual(v4[key], v3[key], key)
        slices = {(item["sceneSlice"], item["split"]): item["minimumInstances"] for item in v4["requiredSceneSlices"]}
        self.assertEqual(slices[("single_card_archive", "train")], 4000)
        self.assertEqual(slices[("multi_card_grid_archive", "train")], 700)
        self.assertEqual(slices[("multi_card_scatter_archive", "train")], 1000)
        self.assertEqual(slices[("single_card_archive", "validation")], 1000)
        synthetic = {k: v for k, v in slices.items() if k[0] not in {
            "single_card_archive", "multi_card_grid_archive", "multi_card_scatter_archive"}}
        self.assertEqual(synthetic, {(item["sceneSlice"], item["split"]): item["minimumInstances"]
                                     for item in v3["requiredSceneSlices"] if item["sceneSlice"] != "single_card_archive"})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(ValueError, "separately pinned"):
                combine(inputs=[RELEASES_DIR / "valid-target-semantics"], output=root / "missing",
                        release_id="v4", policy_path=v4_path)

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

    def test_target_semantics_travel_with_the_combined_corpus(self):
        policy = ROOT / "policies" / "training-minimums-v2.json"
        declared = load_json(RELEASES_DIR / "valid-target-semantics" / "manifest.json")["targetSemantics"]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = combine(
                inputs=[RELEASES_DIR / "valid-target-semantics"],
                output=root / "combined", release_id="semantics", policy_path=policy,
            )
            self.assertEqual(manifest["targetSemantics"], declared)
            legacy = combine(
                inputs=[RELEASES_DIR / "valid-fixture"],
                output=root / "legacy", release_id="legacy", policy_path=policy,
            )
            self.assertNotIn("targetSemantics", legacy)
            other = root / "other"
            shutil.copytree(RELEASES_DIR / "valid-target-semantics", other)
            conflicting = load_json(other / "manifest.json")
            conflicting["releaseId"] = "other-semantics"
            conflicting["targetSemantics"]["contextCategories"] = []
            write_json(other / "manifest.json", conflicting)
            with self.assertRaisesRegex(ValueError, "conflicting targetSemantics"):
                combine(
                    inputs=[RELEASES_DIR / "valid-target-semantics", other],
                    output=root / "conflict", release_id="conflict", policy_path=policy,
                )


if __name__ == "__main__":
    unittest.main()
