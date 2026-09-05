import copy
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from training_geometry import context_margins, instance_box, MissingInstanceBox
from train_yolo_pose import yolo_line, materialize_yolo
from train_yolox_pose import coco_annotation, materialize_coco, scaled_learning_rate
from train_fastvit_four_corner import build_targets, make_dataset, focal_loss
from run_card_geometry_hf_job import resolve_config, fairness_hash

POLICY = {"kind": "fraction-of-long-side", "fraction": 0.125,
          "rounding": "ceil", "application": "each-side"}
MARGINS = dict.fromkeys(("left", "top", "right", "bottom"), 0)
BOX = {"instanceId": "unknown", "corners": [],
       "box": {"left": .2, "top": .2, "right": .8, "bottom": .8}}
KNOWN = {"instanceId": "known", "corners": [
    {"coordinateKnown": True, "visibility": "visible", "point": {"x": x, "y": y}}
    for x, y in ((.3,.3),(.7,.3),(.7,.7),(.3,.7))]}


class TrainingGeometryTests(unittest.TestCase):
    def test_declared_margin_ceil_long_side_and_synthetic_preservation(self):
        real = {"source": {"kind": "real", "width": 81, "height": 40}}
        with self.assertRaisesRegex(ValueError, 'fairness'):
            context_margins(real, None)
        self.assertEqual(set(context_margins(real, POLICY).values()), {11})
        for value in (-1, float('nan'), float('inf'), True):
            with self.assertRaises(ValueError):
                context_margins(real, {**POLICY, "fraction": value})
        synthetic = {"source": {"kind": "synthetic"}, "synthetic": {"contextMarginPixels": MARGINS}}
        self.assertEqual(context_margins(synthetic, POLICY), MARGINS)

    def test_margin_changes_fairness_hash(self):
        config = json.loads((Path(__file__).parent / 'fixtures/experiment-config.evaluation-only.v1.json').read_text())
        config['fairness']['realContextMarginPolicy'] = POLICY
        first = fairness_hash(resolve_config(config))
        config = copy.deepcopy(config)
        config['fairness']['realContextMarginPolicy']['fraction'] = .25
        self.assertNotEqual(first, fairness_hash(resolve_config(config)))

    def test_unknown_card_keeps_box_and_zero_visibility_in_both_pose_formats(self):
        row = list(map(float, yolo_line(BOX, 100, 100, MARGINS).split()))
        np.testing.assert_allclose(row[1:5], [.5,.5,.6,.6])
        self.assertEqual(row[5:], [0.] * 12)
        coco = coco_annotation(BOX, annotation_id=1, image_id=1, width=100, height=100, margins=MARGINS)
        self.assertEqual(coco['bbox'], [20.,20.,60.,60.])
        self.assertEqual(coco['num_keypoints'], 0)
        self.assertEqual(coco['keypoints'], [0] * 12)

    def test_rejected_polygon_fits_keep_box_supervision(self):
        from build_real_smoke_release import conservative_mask_quad
        for points, outcome in [([(20,20),(80,20),(80,80),(20,80)], 'aspect'),
                                ([(20,20),(80,20),(80,60),(50,80),(20,60)], 'residual')]:
            self.assertEqual(conservative_mask_quad(points)[1], outcome)
            instance = {"instanceId": outcome, "corners": [], "visibleMask": {
                "kind": "polygon", "points": [{"x":x/100,"y":y/100} for x,y in points]}}
            self.assertEqual(instance_box(instance), (.2,.2,.8,.8))
            self.assertEqual(list(map(float,yolo_line(instance,100,100,MARGINS).split()))[5:], [0.] * 12)

    def test_negative_ignore_preserves_positive_gradient_and_corner_target(self):
        try:
            import torch
        except ImportError:
            self.skipTest('torch needed for actual focal loss gradient')
        targets = build_targets([BOX, KNOWN], width=100, height=100, margins=MARGINS, resolution=100)
        self.assertEqual(targets['mask'].sum(), 1)
        logits = torch.zeros((1,25,25), requires_grad=True)
        loss = focal_loss(logits, torch.from_numpy(targets['heatmap']), torch.from_numpy(targets['negativeMask']))
        loss.backward()
        self.assertEqual(logits.grad[0,6,6].item(), 0.)
        self.assertGreater(logits.grad[0,0,0].item(), 0.)
        self.assertLess(logits.grad[0,12,12].item(), 0.)
        self.assertEqual(targets['negativeMask'][0,12,12], 0.)
        reverse = build_targets([KNOWN, BOX], width=100, height=100, margins=MARGINS, resolution=100)
        for name in targets:
            np.testing.assert_array_equal(targets[name], reverse[name])

    def test_ignore_box_transformed_through_context_and_letterbox(self):
        targets = build_targets([BOX], width=100, height=200,
                                margins=dict.fromkeys(MARGINS, 20), resolution=120)
        # Scale=.5, horizontal letterbox=25: bbox x=[45,75], y=[30,90].
        self.assertEqual(targets['negativeMask'][0,8,12], 0.)
        self.assertEqual(targets['negativeMask'][0,1,1], 1.)
        self.assertEqual(targets['mask'].sum(), 0)

    def test_all_materializers_keep_unknown_and_drop_entire_missing_box_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            release = Path(tmp)/'release'
            release.mkdir()
            Image.new('RGB',(80,40)).save(release/'frame.png')
            entries=[]
            variants = {'known': [KNOWN], 'box': [BOX], 'mixed': [KNOWN, BOX],
                        'missing': [KNOWN, {'instanceId':'missing','corners':[]}], 'empty': []}
            for split in ('train','validation'):
                for name, instances in variants.items():
                    record_id=f'{split}-{name}'
                    record={'source': {'kind':'real','path':'frame.png','width':80,'height':40}, 'instances':instances}
                    (release/f'{record_id}.json').write_text(json.dumps(record))
                    entries.append({'recordId':record_id,'split':split,'path':f'{record_id}.json'})
            (release/'manifest.json').write_text(json.dumps({'corpusHash':'a'*64,'records':entries}))
            for name, materializer in [('yolo', materialize_yolo), ('coco',materialize_coco)]:
                out=Path(tmp)/name
                summary=materializer(release,out,POLICY)
                self.assertEqual(summary['counts']['records:train'],4)
                self.assertEqual(summary['counts']['instances:train'],4)
                self.assertEqual(summary['counts']['recordsSkippedMissingBox:train'],1)
                self.assertFalse((out/'images/train/train-missing.jpg').exists())
                with Image.open(out/'images/train/train-box.jpg') as image:
                    self.assertEqual(image.size,(100,60))
            try:
                import torch  # noqa: F401
            except ImportError:
                return
            dataset=make_dataset(release,'train',64,1,POLICY)
            self.assertEqual(len(dataset),4)
            self.assertEqual(dataset.skipped_missing_box,['train-missing'])
            pixels, targets=dataset[1]
            self.assertEqual(tuple(pixels.shape),(3,64,64))
            self.assertEqual(targets['mask'].sum().item(),0)
            self.assertGreater((targets['negativeMask']==0).sum().item(),0)

    def test_bad_unknown_box_fails(self):
        for box in ({'left':.8,'top':.2,'right':.2,'bottom':.8},
                    {'left':float('nan'),'top':.2,'right':.8,'bottom':.8}):
            with self.assertRaises(MissingInstanceBox):
                instance_box({**BOX,'box':box})

    def test_yolox_batch_scaling(self):
        self.assertEqual(scaled_learning_rate(16),.00025)
        self.assertEqual(scaled_learning_rate(256),.004)

    def test_pinned_ultralytics_coordinate_loss_ignores_zero_visibility(self):
        try:
            import torch
            from ultralytics.utils.loss import KeypointLoss
        except ImportError:
            self.skipTest('pinned ultralytics needed for actual keypoint loss')
        prediction=torch.ones((2,4,2),requires_grad=True)
        target=torch.zeros_like(prediction)
        visible=torch.tensor([[0,0,0,0],[1,1,1,1]],dtype=torch.bool)
        loss=KeypointLoss(torch.ones(4))(prediction,target,visible,torch.ones(2,1))
        loss.backward()
        self.assertEqual(prediction.grad[0].abs().sum().item(),0)
        self.assertGreater(prediction.grad[1].abs().sum().item(),0)


if __name__ == '__main__':
    unittest.main()
