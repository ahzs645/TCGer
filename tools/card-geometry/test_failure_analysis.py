import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_canonical_target_categories import audit  # noqa: E402
from summarize_geometry_failures import summarize_row  # noqa: E402

QUAD = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
CORNERS = [
    {"coordinateKnown": True, "point": {"x": x, "y": y}, "confidence": 1}
    for x, y in QUAD
]
SAMPLE = dict(
    recordId="test",
    sceneSlice="binder_page",
    sourceKind="real",
    width=100,
    height=100,
    instances=[{"corners": CORNERS}],
)
PREDICTION = dict(corners=CORNERS, confidence=0.9)


class MissStageTests(unittest.TestCase):
    def row(self, **kwargs):
        return (
            dict(
                scope="evaluation",
                variant="frozen",
                native=[],
                raw=[],
                accepted=[],
                rejections=[],
            )
            | kwargs
        )

    def test_missing_box_is_not_attributed_to_decoder(self):
        result = summarize_row(SAMPLE, self.row())
        self.assertEqual(
            result["missDetails"][0]["stage"], "no-matching-post-framework-box"
        )

    def test_low_confidence_matching_quad_records_actual_filter_reason(self):
        result = summarize_row(
            SAMPLE, self.row(raw=[PREDICTION], rejections=[["confidence"]])
        )
        self.assertEqual(result["missDetails"][0]["bestRawRejections"], ["confidence"])
        self.assertEqual(result["missDetails"][0]["stage"], "shared-decoder-filter")

    def test_duplicate_predictions_cannot_inflate_recall(self):
        result = summarize_row(
            SAMPLE,
            self.row(
                raw=[PREDICTION] * 2, rejections=[[], []], accepted=[PREDICTION] * 2
            ),
        )
        self.assertEqual(result["matches"], 1)
        self.assertEqual(result["duplicates"], 1)
        self.assertEqual(result["missDetails"], [])

    def test_localized_box_with_wrong_quad_is_corner_failure(self):
        result = summarize_row(SAMPLE, self.row(native=[{"box": [0.1, 0.1, 0.9, 0.9]}]))
        self.assertEqual(
            result["missDetails"][0]["stage"], "native-box-found-but-quad-missed"
        )


class CategoryAuditTests(unittest.TestCase):
    def test_source_category_audit_finds_slab_and_does_not_modify_record(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record = {
                "recordId": "coco-test",
                "source": {"sha256": "image"},
                "grouping": {"sourceArchiveId": "archive"},
                "instances": [
                    {"instanceId": "a", "corners": CORNERS},
                    {"instanceId": "b", "corners": CORNERS},
                ],
            }
            path = root / "record.json"
            path.write_text(json.dumps(record))
            before = path.read_bytes()
            (root / "manifest.json").write_text(
                json.dumps(
                    {
                        "corpusHash": "corpus",
                        "records": [
                            {
                                "recordId": "coco-test",
                                "path": "record.json",
                                "sha256": hashlib.sha256(before).hexdigest(),
                                "split": "train",
                            }
                        ],
                    }
                )
            )
            canonical = root / "canonical.jsonl"
            canonical.write_text(
                json.dumps(
                    {
                        "sha256": "image",
                        "annotations": [
                            {"category": "card", "provenance": ["card"]},
                            {"category": "slab", "provenance": ["slab"]},
                        ],
                    }
                )
                + "\n"
            )
            report = audit(canonical, root)
            self.assertEqual(report["bySplit"]["train"]["instances:slab"], 1)
            self.assertEqual(report["bySplit"]["train"]["knownCorners:slab"], 1)
            self.assertEqual(
                report["affectedRecords"][0]["misclassifiedInstances"][0]["instanceId"],
                "b",
            )
            self.assertEqual(path.read_bytes(), before)
            path.write_text("{}")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                audit(canonical, root)


if __name__ == "__main__":
    unittest.main()
