import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("review.py")
sys.path.insert(0, str(MODULE_PATH.parent))
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

    def test_name_verdict_is_separate_from_printing_identity(self):
        label = {"category": "singleCard", "cardId": "set-1", "name": "Zoroark"}
        same_name_other_printing = {
            "result": {
                "matched": True,
                "cardID": "set-2",
                "name": "Zoroark",
            }
        }
        self.assertEqual(review.prediction_verdict(label, same_name_other_printing), "wrong")
        self.assertEqual(
            review.name_prediction_verdict(label, same_name_other_printing), "correct"
        )

    def test_source_polygon_becomes_filled_polyline_and_ordered_corners(self):
        import geometry

        annotation = {
            "bbox": [10, 20, 100, 140],
            "segmentation": [[12, 22, 108, 20, 112, 162, 8, 158, 12, 22]],
        }
        points = geometry.polygon_points(annotation)
        self.assertEqual(len(points), 5)
        quad, source = geometry.quad_from_annotation(annotation)
        self.assertEqual(source, "source_polygon")
        self.assertEqual(quad.shape, (4, 2))
        self.assertLess(float(quad[0].sum()), float(quad[2].sum()))

    def test_bbox_fallback_is_explicit(self):
        import geometry

        quad, source = geometry.quad_from_annotation({"bbox": [10, 20, 100, 140]})
        self.assertEqual(source, "bbox_fallback")
        self.assertEqual(quad.shape, (4, 2))

    def test_polygon_iou(self):
        import geometry

        square = [[0, 0], [10, 0], [10, 10], [0, 10]]
        self.assertAlmostEqual(geometry.polygon_iou(square, square), 1.0)
        shifted = [[5, 0], [15, 0], [15, 10], [5, 10]]
        self.assertAlmostEqual(geometry.polygon_iou(square, shifted), 1 / 3, places=4)

    def test_boundary_iou_rewards_matching_edges(self):
        import geometry

        square = [[0, 0], [10, 0], [10, 10], [0, 10]]
        inset = [[1, 1], [9, 1], [9, 9], [1, 9]]
        self.assertAlmostEqual(geometry.boundary_iou(square, square), 1.0)
        self.assertLess(geometry.boundary_iou(square, inset), 1.0)

    def test_run_metrics_include_abstentions_and_negatives(self):
        import performance

        labels = {
            "positive": {"category": "singleCard", "cardId": "set-1", "name": "Zoroark"},
            "negative": {"category": "cardBack"},
        }
        predictions = {
            "positive.jpg": {
                "result": {"matched": True, "cardID": "set-1", "name": "Zoroark"}
            },
            "negative.jpg": {"result": {"matched": False, "failure": "noMatch"}},
        }
        metrics = performance.run_metrics(labels, predictions, lambda value: Path(value).stem)
        self.assertEqual(metrics["correct"], 1)
        self.assertEqual(metrics["declined"], 1)
        self.assertEqual(metrics["end_to_end_accuracy"], 1.0)
        self.assertEqual(metrics["name_recall"], 1.0)

    def test_wilson_interval_contains_observed_rate(self):
        import performance

        low, high = performance.wilson_interval(16, 23)
        self.assertLess(low, 16 / 23)
        self.assertGreater(high, 16 / 23)
        self.assertEqual(performance.wilson_interval(0, 0), (0.0, 0.0))

    def test_performance_charts_are_exported(self):
        import performance

        rows = [
            {
                "name": "example_run",
                "cohort": "reviewed_ios_replay",
                "samples": 50,
                "metrics": {
                    "positives": 23,
                    "negatives": 20,
                    "unscored": 7,
                    "scored": 43,
                    "correct": 16,
                    "name_correct": 17,
                    "name_scored": 23,
                    "declined": 20,
                    "wrong": 1,
                    "false_positive": 0,
                    "missed": 6,
                    "precision": 16 / 17,
                    "recall": 16 / 23,
                    "f1": 0.8,
                    "name_recall": 17 / 23,
                    "end_to_end_accuracy": 36 / 43,
                    "mean_elapsed_ms": 2100,
                },
            }
        ]
        with tempfile.TemporaryDirectory() as temporary:
            paths = performance.render_performance_charts(rows, Path(temporary))
            self.assertEqual(
                set(paths),
                {
                    "metrics",
                    "name_printing",
                    "speed_quality",
                    "failures",
                    "stages",
                    "dashboard",
                },
            )
            for path in paths.values():
                self.assertTrue(path.is_file())
                self.assertGreater(path.stat().st_size, 1000)


if __name__ == "__main__":
    unittest.main()
