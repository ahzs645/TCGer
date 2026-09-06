import copy
import tempfile
import unittest
import sys
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from PIL import Image

from evaluate_geometry_candidate import (
    AttributeDict,
    as_numpy,
    candidate_result,
    classify_replay_outcome,
    configure_yolox_test,
    padded_image,
    source_point,
    yolox_array_pipeline,
    Predictor,
)


class EvaluateGeometryCandidateTests(unittest.TestCase):
    def test_yolox_converts_pil_rgb_to_file_loader_bgr(self):
        observed = []
        def infer(model, pixels, **kwargs):
            observed.append(pixels.copy())
            return SimpleNamespace(pred_instances=SimpleNamespace())
        predictor = Predictor.__new__(Predictor)
        predictor.model = object()
        predictor.yolox_pipeline = object()
        with patch.dict(sys.modules, {'mmdet.apis':SimpleNamespace(inference_detector=infer)}):
            self.assertEqual(predictor.predict_yolox(Image.new('RGB',(2,2),(10,20,200)),2,2),[])
        np.testing.assert_array_equal(observed[0][0,0],[200,20,10])

    def test_array_pipeline_retains_transforms_without_mutating_labeled_metadata(self):
        pipeline = [dict(type='LoadImageFromFile', to_float32=True),
                    dict(type='Resize', scale=(640, 640), keep_ratio=True),
                    dict(type='PackDetInputs', meta_keys=('id', 'img_id', 'scale_factor'))]
        original = copy.deepcopy(pipeline)
        raw = yolox_array_pipeline(pipeline)
        self.assertEqual(pipeline, original)
        self.assertEqual(raw[0], dict(type='mmdet.LoadImageFromNDArray', to_float32=True))
        self.assertEqual(raw[1], pipeline[1])
        self.assertEqual(raw[-1]['meta_keys'], ('img_id', 'scale_factor'))

    def test_as_numpy_accepts_arrays_and_tensor_protocol(self):
        array = np.asarray([[1.0, 2.0]], dtype=np.float32)
        self.assertIs(as_numpy(array), array)

        class TensorLike:
            def __init__(self, value):
                self.value = value

            def detach(self):
                return self

            def cpu(self):
                return self

            def numpy(self):
                return self.value

        np.testing.assert_array_equal(as_numpy(TensorLike(array)), array)

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
