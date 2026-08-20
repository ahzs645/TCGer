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
    def test_quad_remap_uses_registered_guide_crop(self):
        quad = [[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]]
        remapped = review.remap_quad_to_media(
            quad,
            (942, 2048),
            (1536, 2048),
            (297.0, 0.0, 942.0, 2048.0),
        )
        self.assertAlmostEqual(remapped[0][0], 297 / 1536)
        self.assertAlmostEqual(remapped[1][0], 1239 / 1536)
        self.assertEqual(remapped[0][1], 1.0)
        self.assertEqual(remapped[2][1], 0.0)

    def test_quad_remap_keeps_resized_full_frame_coordinates(self):
        quad = [[0.1, 0.9], [0.9, 0.9], [0.9, 0.1], [0.1, 0.1]]
        self.assertEqual(
            review.remap_quad_to_media(
                quad,
                (415, 544),
                (1536, 2048),
                (0.0, 0.0, 1536.0, 2048.0),
            ),
            quad,
        )

    def test_binder_summary_keeps_one_best_record_per_pocket(self):
        attempts = [
            {
                "pocketIndex": 0,
                "outcome": "candidateOnly",
                "binderStatus": "uncertain",
                "topCandidates": [{"cardID": "a", "name": "A", "similarity": 0.95}],
                "quad": [[0, 1], [0.5, 1], [0.5, 0.5], [0, 0.5]],
            },
            {
                "pocketIndex": 0,
                "outcome": "accepted",
                "binderStatus": "matched",
                "binderIncludedByDefault": True,
                "topCandidates": [{"cardID": "b", "name": "B", "similarity": 0.84}],
                "imageIndex": 2,
            },
            {
                "pocketIndex": 1,
                "outcome": "candidateOnly",
                "binderStatus": "uncertain",
                "topCandidates": [{"cardID": "c", "name": "C", "similarity": 0.73}],
            },
        ]
        cards = review.summarize_binder_cards(attempts)
        self.assertEqual(len(cards), 2)
        self.assertEqual(cards[0]["card_id"], "b")
        self.assertEqual(cards[0]["status"], "matched")
        self.assertEqual(cards[0]["image_index"], 2)
        self.assertEqual(cards[1]["status"], "uncertain")

    def test_fiftyone_state_uses_shared_plugin_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            old_values = {
                key: review.os.environ.get(key)
                for key in (
                    "FIFTYONE_DATABASE_DIR",
                    "FIFTYONE_DEFAULT_DATASET_DIR",
                    "FIFTYONE_DEFAULT_APP_ADDRESS",
                    "FIFTYONE_PLUGINS_DIR",
                )
            }
            try:
                for key in old_values:
                    review.os.environ.pop(key, None)
                review.configure_fiftyone_state(Path(temporary))
                self.assertEqual(
                    review.os.environ["FIFTYONE_PLUGINS_DIR"],
                    str(Path.home() / "fiftyone" / "__plugins__"),
                )
            finally:
                for key, value in old_values.items():
                    if value is None:
                        review.os.environ.pop(key, None)
                    else:
                        review.os.environ[key] = value

    def test_capture_quality_issue_matches_ios_priority(self):
        base = {
            "sharpness": 0.01,
            "meanLuma": 0.5,
            "clippedHighlightFraction": 0,
            "glareFraction": 0,
            "fillRatio": 0.6,
            "angleDeviationDegrees": 3,
            "detectorConfidence": 0.9,
        }
        self.assertEqual(review.capture_quality_issue(base), "pass")
        self.assertEqual(
            review.capture_quality_issue({**base, "glareFraction": 0.15}),
            "glare",
        )
        self.assertEqual(
            review.capture_quality_issue({**base, "fillRatio": None}),
            "noCard",
        )
        self.assertEqual(
            review.capture_quality_issue(
                {**base, "fillRatio": None, "angleDeviationDegrees": None},
                includes_framing=False,
            ),
            "pass",
        )
        self.assertEqual(review.capture_quality_issue(None), "missing")

    def test_shutter_verdict_keeps_unlabelled_captures_out_of_accuracy(self):
        self.assertEqual(review.shutter_verdict("set-1", False, "set-1"), "correct")
        self.assertEqual(review.shutter_verdict("set-1", False, "set-2"), "wrong")
        self.assertEqual(review.shutter_verdict("set-1", False, None), "missed")
        self.assertEqual(review.shutter_verdict(None, True, None), "correct_decline")
        self.assertEqual(review.shutter_verdict(None, True, "set-2"), "false_positive")
        self.assertEqual(review.shutter_verdict(None, None, "set-2"), "unscored")

    def test_latency_summary_uses_recorded_end_to_end_time(self):
        values = [100, 200, 300, 400, 500]
        self.assertEqual(review.percentile(values, 0.5), 300)
        self.assertEqual(review.percentile(values, 0.9), 500)
        self.assertIsNone(review.percentile([], 0.5))
        self.assertEqual(review.latency_bucket(249), "under_250ms")
        self.assertEqual(review.latency_bucket(250), "250_499ms")
        self.assertEqual(review.latency_bucket(1_500), "1_2s")
        self.assertEqual(review.latency_bucket(None), "unavailable")

    def test_assisted_shutter_suggestion_separates_hints_from_truth(self):
        accepted = review.assisted_shutter_suggestion(
            {
                "identified_card_id": "sv4-1",
                "identified_card_name": "Pikachu",
                "identified_confidence": 0.91,
                "candidates_json": "[]",
                "title_ocr_names_json": '["Pikachu"]',
                "ocr_verified_numbers_json": "[]",
            }
        )
        self.assertEqual(accepted["category"], "pokemon_card")
        self.assertEqual(accepted["strength"], "exact_printing")
        self.assertEqual(accepted["source"], "accepted_visual_plus_ocr")

        retrieval_only = review.assisted_shutter_suggestion(
            {
                "candidates_json": '[{"cardID":"sv4-1","name":"Pikachu","similarity":0.8}]',
                "title_ocr_names_json": "[]",
                "ocr_verified_numbers_json": "[]",
                "capture_quality_issue": "pass",
            }
        )
        self.assertEqual(retrieval_only["category"], "needs_content_confirmation")
        self.assertEqual(retrieval_only["strength"], "candidate_hint_only")

        no_card = review.assisted_shutter_suggestion(
            {
                "candidates_json": "[]",
                "title_ocr_names_json": "[]",
                "ocr_verified_numbers_json": "[]",
                "capture_quality_issue": "noCard",
            }
        )
        self.assertEqual(no_card["category"], "no_card")

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
