import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("diff_fiftyone_release.py")
SPEC = importlib.util.spec_from_file_location("diff_fiftyone_release", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


class FiftyOneReleaseDiffTests(unittest.TestCase):
    def test_classifies_changes_and_pixel_deltas(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            before = root / "labels-20260101-010101.json"
            after = root / "labels-20260102-020202.json"
            keys = [f"session-a/frame-{index}.jpg" for index in range(5)]
            base_quad = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
            changed_quad = [[0.2, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
            write_json(
                before,
                [
                    {"key": keys[0], "fixed_quad_source": "manual", "fixed_quad_json": json.dumps(base_quad)},
                    {"key": keys[1], "fixed_quad_source": "manual", "fixed_quad_json": json.dumps(base_quad)},
                    {"key": keys[2], "fixed_quad_source": "manual", "fixed_quad_json": json.dumps(base_quad)},
                ],
            )
            write_json(
                after,
                [
                    {"key": keys[0], "fixed_quad_source": "manual", "fixed_quad_json": json.dumps(base_quad)},
                    {"key": keys[1], "fixed_quad_source": "manual", "fixed_quad_json": json.dumps(changed_quad)},
                    {"key": keys[3], "fixed_quad_source": "manual", "fixed_quad_json": json.dumps(base_quad)},
                    {"key": keys[4], "fixed_quad_source": "detector-x", "fixed_quad_json": json.dumps(base_quad)},
                ],
            )
            release_root = root / "release"
            records = []
            for key in keys[:3]:
                record_id = MODULE.release_record_id(key)
                record_path = f"records/{record_id}.json"
                write_json(
                    release_root / record_path,
                    {
                        "recordId": record_id,
                        "source": {"width": 100, "height": 200},
                        "grouping": {"sessionId": "session-a"},
                        "instances": [{"corners": [{"point": {"x": x, "y": y}} for x, y in base_quad]}],
                    },
                )
                records.append(
                    {
                        "recordId": record_id,
                        "path": record_path,
                        "split": "test",
                        "sceneSlice": "single_handheld",
                    }
                )
            write_json(
                release_root / "manifest.json",
                {"releaseId": "v3", "corpusHash": "abc", "records": records},
            )
            policy = root / "policy.json"
            write_json(
                policy,
                {
                    "policyId": "training-minimums-draft-v1",
                    "metricEligibleCornerSources": ["human", "synthetic"],
                    "minimumRealEvaluationSessions": 1,
                    "requiredSplits": ["train", "validation", "test"],
                    "minimumRecordsPerSplit": {"train": 1, "validation": 1, "test": 1},
                    "minimumInstancesPerSplit": {"train": 1, "validation": 1, "test": 1},
                    "requiredSceneSlices": [
                        {"split": "test", "sceneSlice": "single_handheld", "minimumInstances": 4}
                    ],
                },
            )
            inventory = [
                {
                    "key": key,
                    "sessionId": "session-a",
                    "width": 100,
                    "height": 200,
                    "sceneSlice": "single_handheld",
                }
                for key in keys
            ]
            report = MODULE.build_report(
                current_backup=after,
                prior_backup=before,
                release_root=release_root,
                inventory=inventory,
                policy_path=policy,
                dataset_repo="owner/data",
                dataset_revision="123",
            )

            self.assertEqual(report["summary"]["gainingManualQuad"], 1)
            self.assertEqual(report["summary"]["changedManualQuad"], 1)
            self.assertEqual(report["summary"]["losingManualQuad"], 1)
            self.assertEqual(report["summary"]["unchangedManualQuad"], 1)
            self.assertEqual(report["summary"]["stillUnlabeled"], 2)
            self.assertEqual(report["summary"]["detectorQuadFrames"], 1)
            self.assertTrue(report["releaseChangeRequired"])
            changed = report["sessions"][0]["changedManualQuad"][0]
            self.assertEqual(changed["cornerDeltasPixels"][0]["distance"], 10.0)
            self.assertEqual(report["coverage"]["metricEligibleCorners"], 12)
            self.assertEqual(
                report["coverage"]["requiredSceneSlices"][0]["actualInstances"], 3
            )

    def test_provenance_mapping_excludes_non_manual_sources(self):
        records = {
            "a": {"fixed_quad_source": "manual", "fixed_quad_json": "[[0,0],[1,0],[1,1],[0,1]]"},
            "b": {"fixed_quad_source": "webobb", "fixed_quad_json": "[[0,0],[1,0],[1,1],[0,1]]"},
            "c": {"fixed_quad_json": "[[0,0],[1,0],[1,1],[0,1]]"},
        }
        self.assertEqual(
            MODULE.provenance_counts(records),
            {"human": 1, "detector": 1, "skippedMissingSource": 1},
        )
        self.assertEqual(list(MODULE.manual_quads(records)), ["a"])


if __name__ == "__main__":
    unittest.main()
