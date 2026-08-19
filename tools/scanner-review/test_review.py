import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("review.py")
SPEC = importlib.util.spec_from_file_location("tcger_scanner_review", MODULE_PATH)
review = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = review
SPEC.loader.exec_module(review)


class ScannerReviewTests(unittest.TestCase):
    def test_label_key_strips_roboflow_hash(self):
        self.assertEqual(
            review.label_key_for_path("datasets/test/Card_jpg.rf.abc123.jpg"),
            "Card_jpg",
        )
        self.assertEqual(review.label_key_for_path("frame-0001.jpg"), "frame-0001")

    def test_report_suffixes_are_readable(self):
        self.assertEqual(
            review.report_suffix(Path("tcger-roboflow-ios-report.json")), "baseline"
        )
        self.assertEqual(
            review.report_suffix(Path("tcger-roboflow-ios-report-final-refactor.json")),
            "final_refactor",
        )
        self.assertEqual(
            review.report_suffix(Path("tcger-recognition-gate-tuned-1.json")),
            "gate_tuned_1",
        )

    def test_bbox_is_normalized_and_clamped(self):
        self.assertEqual(
            review.normalized_bbox({"bbox": [-2, 10, 52, 50]}, 100, 100),
            [0.0, 0.1, 0.52, 0.5],
        )
        self.assertIsNone(review.normalized_bbox({"bbox": [1, 1, 0, 4]}, 100, 100))

    def test_discovers_only_reports_with_recognition_samples(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "scanner-labels.json").write_text("{}")
            (root / "aggregate.json").write_text('{"datasets": []}')
            (root / "tcger-roboflow-ios-report-yolo.json").write_text(
                '{"generatedAt":"now","recognitionSamples":['
                '{"imagePath":"datasets/x/a.jpg","result":{"matched":false}}]}'
            )
            runs = review.discover_model_runs(root)
            self.assertEqual(len(runs), 1)
            self.assertEqual(runs[0].field_suffix, "yolo")
            self.assertIn("datasets/x/a.jpg", runs[0].predictions)

    def test_prediction_verdict(self):
        positive = {"category": "singleCard", "cardId": "set-1"}
        negative = {"category": "cardBack"}
        correct = {"result": {"matched": True, "cardID": "set-1"}}
        wrong = {"result": {"matched": True, "cardID": "set-2"}}
        declined = {"result": {"matched": False, "failure": "noMatch"}}
        self.assertEqual(review.prediction_verdict(positive, correct), "correct")
        self.assertEqual(review.prediction_verdict(positive, wrong), "wrong")
        self.assertEqual(review.prediction_verdict(positive, declined), "missed")
        self.assertEqual(review.prediction_verdict(negative, wrong), "false_positive")
        self.assertEqual(review.prediction_verdict(negative, declined), "declined")


if __name__ == "__main__":
    unittest.main()
