import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import torch
from ultralytics.cfg import get_cfg
from ultralytics.utils.instance import Instances
from ultralytics.data.dataset import YOLODataset
from train_yolo_pose import materialize_yolo
from test_yolo_corner_order import fixture, CONTEXT
from yolo_corner_order import DISABLED_AUGMENTATIONS
from yolo_card_rotation import rotate_label, FixedRotationDataset


class RotationTests(unittest.TestCase):
    def label(self):
        points=np.array([[[.1,.1,2],[.7,.1,1],[.7,.9,1],[.1,.9,2]]]*2+[[[0,0,0]]*4],dtype=np.float32)
        return dict(img=np.arange(60).reshape(4,5,3),
            instances=Instances(np.array([[.1,.1,.7,.9]]*3,dtype=np.float32),keypoints=points,
                                segments=np.zeros((0,1000,2)),bbox_format='xyxy',normalized=True),
            cls=np.arange(3,dtype=np.float32)[:,None],orientation_lookup=np.array([True,False,False]),
            ori_shape=(4,5),resized_shape=(4,5),ratio_pad=(1.,1.))

    def test_rotation_preserves_pixels_winding_visibility_and_printed_indices(self):
        label=self.label();before=copy.deepcopy(label)
        rotated=rotate_label(label,1)
        np.testing.assert_array_equal(rotated['img'],np.rot90(before['img'],-1))
        np.testing.assert_allclose(rotated['instances'].keypoints[0,:,:2],[[.9,.1],[.9,.7],[.1,.7],[.1,.1]],atol=1e-6)
        np.testing.assert_array_equal(rotated['instances'].keypoints[0,:,2],[2,1,1,2])
        np.testing.assert_allclose(rotated['instances'].keypoints[1,:,:2],[[.1,.1],[.9,.1],[.9,.7],[.1,.7]],atol=1e-6)
        np.testing.assert_array_equal(rotated['instances'].keypoints[1,:,2],[2,2,1,1])
        np.testing.assert_array_equal(rotated['instances'].keypoints[2],0)
        np.testing.assert_allclose(rotated['instances'].bboxes[0],[.1,.1,.9,.7],atol=1e-6)
        for q in rotated['instances'].keypoints[:2,:,:2]:
            self.assertGreater(np.sum(q[:,0]*np.roll(q[:,1],-1)-q[:,1]*np.roll(q[:,0],-1)),0)
        for _ in range(3):rotate_label(rotated,1)
        np.testing.assert_array_equal(rotated['img'],before['img'])
        np.testing.assert_allclose(rotated['instances'].keypoints,before['instances'].keypoints,atol=1e-6)

    def test_dataset_collation_and_zero_turn_stock_parity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);fixture(root)
            path=root/'rotated';materialize_yolo(root/'release',path,CONTEXT,'fixed-v1','quarter-turn-v1')
            data=dict(path=str(path),names={0:'card'},nc=1,kpt_shape=[4,3],flip_idx=[1,0,3,2],
                      corner_order_policy='fixed-quarter-turn-v1',corner_order_metadata='corner-order.json')
            kwargs=dict(img_path=str(path/'images/train'),imgsz=128,batch_size=2,augment=True,
                hyp=get_cfg(overrides={'task':'pose','imgsz':128,**dict.fromkeys(DISABLED_AUGMENTATIONS,0.)}),
                rect=False,cache=False,stride=32,pad=0.,task='pose',data=data)
            ds=FixedRotationDataset(**kwargs);stock=YOLODataset(**kwargs)
            with patch('yolo_card_rotation.random.randrange',return_value=0):
                for i in range(len(ds)):
                    actual=ds[i];expected=stock[i]
                    for field in ('img','keypoints','bboxes','cls'):
                        torch.testing.assert_close(actual[field],expected[field])
            with patch('yolo_card_rotation.random.randrange',return_value=1):
                samples=[ds[i] for i in range(len(ds))]
            batch=ds.collate_fn(samples)
            self.assertEqual(batch['cls'].sum().item(),0)
            self.assertEqual(len(batch['orientation_known']),len(batch['keypoints']))
            self.assertTrue(torch.isfinite(batch['keypoints']).all())
            kwargs['hyp'].fliplr=.5
            with self.assertRaisesRegex(ValueError,'no-runtime-augmentation'):FixedRotationDataset(**kwargs)


if __name__=='__main__':unittest.main()
