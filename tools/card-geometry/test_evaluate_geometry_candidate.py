import copy
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from PIL import Image

from evaluate_geometry_candidate import (
    AttributeDict,
    candidate_result,
    classify_replay_outcome,
    configure_yolox_test,
    padded_image,
    source_point,
)


class EvaluateGeometryCandidateTests(unittest.TestCase):
    def test_padding_inverse_maps_original_corners(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "frame.jpg"
            Image.new("RGB", (100, 200), (1, 2, 3)).save(source)
            padded, width, height = padded_image(source)
            self.assertEqual(padded.size, (484, 584))
            self.assertEqual(source_point(192, 192, width, height), {"x": 0.0, "y": 0.0})
            self.assertEqual(source_point(292, 392, width, height), {"x": 1.0, "y": 1.0})

    def test_candidate_result_keeps_order(self):
        row = candidate_result(
            [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)],
            0.8,
            [0.7, 0.6, 0.5, 0.4],
        )
        self.assertEqual(row["corners"][0]["point"], {"x": 0.1, "y": 0.1})
        self.assertEqual(row["corners"][3]["confidence"], 0.4)

    def test_yolox_test_config_is_bound_to_detector_and_head(self):
        observed = []

        def predict_by_feat(*args, **kwargs):
            observed.append((args, kwargs))
            return kwargs["cfg"]

        head = SimpleNamespace(predict_by_feat=predict_by_feat)
        model = SimpleNamespace(bbox_head=head)
        config = configure_yolox_test(model)
        self.assertIs(model.test_cfg, config)
        self.assertIs(model.bbox_head.test_cfg, config)
        self.assertEqual(config.max_per_img, 300)
        self.assertEqual(config.nms.iou_threshold, 0.65)
        cloned = copy.deepcopy(config)
        self.assertEqual(cloned.max_per_img, 300)
        self.assertEqual(cloned.nms.iou_threshold, 0.65)
        self.assertIs(head.predict_by_feat("scores"), config)
        explicit = AttributeDict(max_per_img=7)
        self.assertIs(head.predict_by_feat("scores", cfg=explicit), explicit)
        self.assertEqual(observed[0][0], ("scores",))

    def test_replay_does_not_invent_truth_for_a_different_accept(self):
        self.assertEqual(
            classify_replay_outcome(
                "forbidden-accept",
                accepted=True,
                family="different",
                expected_families=set(),
                forbidden_families={"archived-wrong"},
            ),
            "unknown",
        )
        self.assertEqual(
            classify_replay_outcome(
                "identify",
                accepted=True,
                family="expected",
                expected_families={"expected"},
                forbidden_families=set(),
            ),
            "correct",
        )


if __name__ == "__main__":
    unittest.main()
