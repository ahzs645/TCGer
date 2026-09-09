import copy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

import numpy as np
from PIL import Image
import torch
from ultralytics.cfg import get_cfg
from ultralytics.utils.loss import KeypointLoss

from audit_corner_ordering import cyclic_loss_probe
from train_yolo_pose import materialize_yolo
from yolo_corner_order import (CornerOrderDataset, CornerOrderPoseLoss,
                               DISABLED_AUGMENTATIONS, align_corner_targets, orientation_aware_oks)

CONTEXT = {"kind":"fraction-of-long-side", "fraction":0., "rounding":"ceil", "application":"each-side"}


def card(name, known, left=.1, top=.1, width=.5, height=.8):
    return {"instanceId":name, "orientationKnown":known, "corners":[
        {"coordinateKnown":True, "visibility":"visible", "point":{"x":x,"y":y}}
        for x,y in [(left,top),(left+width,top),(left+width,top+height),(left,top+height)]]}


def fixture(root):
    release = root / "release"
    release.mkdir()
    Image.new("RGB", (100,100), "#223344").save(release / "frame.png")
    variants = {"mixed":[card("unknown",False), card("known",True,.65,.2,.3,.7),
                         card("tiny",True,.7,.05,.002,.002)],
                "box":[{"instanceId":"box","orientationKnown":False,"corners":[],
                        "box":{"left":.1,"top":.1,"right":.5,"bottom":.7}}],
                "empty":[]}
    entries = []
    for split in ("train","validation"):
        for name, instances in variants.items():
            path = f"{split}-{name}.json"
            (release/path).write_text(json.dumps({"source":{"kind":"real","path":"frame.png","width":100,"height":100},"instances":instances}))
            entries.append({"recordId":f"{split}-{name}","split":split,"path":path})
    (release/"manifest.json").write_text(json.dumps({"corpusHash":"a"*64,"records":entries}))
    output = root / "dataset"
    materialize_yolo(release, output, CONTEXT, "cyclic-unknown-v1")
    return output


def dataset(path, augment=True, overrides=None):
    hyp = get_cfg(overrides={"task":"pose", "imgsz":128,
                            **dict.fromkeys(DISABLED_AUGMENTATIONS, 0.), **(overrides or {})})
    return CornerOrderDataset(img_path=str(path/"images/train"), imgsz=128, batch_size=2,
        augment=augment, hyp=hyp, rect=False, cache=False, stride=32, pad=0., task="pose",
        data={"path":str(path), "names":{0:"card"}, "nc":1, "kpt_shape":[4,3],
              "flip_idx":[1,0,3,2], "corner_order_policy":"cyclic-unknown-v1",
              "corner_order_metadata":"corner-order.json"})


class CornerOrderIntegrationTests(unittest.TestCase):
    def test_validation_accepts_only_unknown_cyclic_order_and_rejects_mirrors(self):
        target = torch.tensor([[[1.,1.,2.],[6.,1.,2.],[6.,8.,2.],[1.,8.,2.]]]).repeat(2,1,1)
        prediction = target[:1].roll(2,1)
        scores = orientation_aware_oks(target,prediction,torch.tensor([35.,35.]),
                                       np.full(4,.25),torch.tensor([True,False]))
        self.assertLess(scores[0,0].item(),.1)
        self.assertEqual(scores[1,0].item(),1)
        mirror = orientation_aware_oks(target,prediction[:,[0,3,2,1]],torch.tensor([35.,35.]),
                                       np.full(4,.25),torch.tensor([False,False]))
        self.assertTrue((mirror < .9).all())

    def test_vectorized_loss_matches_probe_and_preserves_gradients(self):
        torch.manual_seed(17)
        target = torch.rand(8,4,3)*100
        target[...,2] = torch.randint(0,3,(8,4))
        prediction = (target[...,:2].roll(2,1)+3).requires_grad_(True)
        known = torch.tensor([True,False]*4)
        area = torch.full((8,1),6000.)
        sigmas = torch.full((4,),.25)
        aligned, phases = align_corner_targets(prediction,target,area,sigmas,known)
        criterion = KeypointLoss(sigmas)
        actual = criterion(prediction,aligned,aligned[...,2]!=0,area)
        expected = cyclic_loss_probe(criterion,prediction,target,target[...,2]!=0,area,known)
        torch.testing.assert_close(actual,expected)
        ag, = torch.autograd.grad(actual,prediction)
        eg, = torch.autograd.grad(expected,prediction)
        torch.testing.assert_close(ag,eg)
        self.assertEqual(phases[known].sum().item(),0)

    def test_dataset_filtering_empty_frames_and_shuffled_collation(self):
        with tempfile.TemporaryDirectory() as tmp:
            ds = dataset(fixture(Path(tmp)))
            samples = {Path(ds.im_files[i]).stem.split("-",1)[1]:ds[i] for i in range(len(ds))}
            # The normal training transform filters the sub-pixel third target.
            self.assertEqual(samples["mixed"]["orientation_known"].tolist(),[False,True])
            self.assertEqual(samples["empty"]["orientation_known"].tolist(),[])
            self.assertEqual(samples["box"]["keypoints"][...,2].sum().item(),0)
            merged = ds.collate_fn([samples["empty"],samples["mixed"],samples["box"]])
            self.assertEqual(merged["orientation_known"].tolist(),[False,True,False])
            self.assertEqual(merged["batch_idx"].tolist(),[1.,1.,2.])
            self.assertEqual(merged["cls"].sum().item(),0)
            self.assertEqual(tuple(merged["keypoints"].shape),(3,4,3))

    def test_changed_labels_and_unsupported_augmentation_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = fixture(Path(tmp))
            with self.assertRaisesRegex(ValueError,"no-runtime-augmentation"):
                dataset(path,overrides={"mosaic":1.})
            label = path/"labels/train/train-mixed.txt"
            label.write_text(label.read_text()+"\n")
            with self.assertRaisesRegex(ValueError,"binding mismatch"):
                dataset(path)

    def test_anchor_assignment_keeps_orientation_and_visibility_together(self):
        # Use the real criterion/assignment helper, with a minimal detection head.
        head = SimpleNamespace(stride=torch.tensor([8.,16.,32.]),nc=1,reg_max=16,kpt_shape=[4,3])
        model = SimpleNamespace(model=[head],args=get_cfg(),end2end=False,
                                parameters=lambda:iter([torch.nn.Parameter(torch.zeros(1))]))
        loss = CornerOrderPoseLoss(model)
        target = torch.tensor([[[1.,1.,2.],[6.,1.,2.],[6.,8.,2.],[1.,8.,2.]]]).repeat(3,1,1)
        target[0,...,2] = 0  # first image is box-only
        flags = torch.tensor([False,True,False])
        batch_idx = torch.tensor([[0.],[1.],[1.]])
        masks = torch.tensor([[True,False],[True,True]])
        assigned = torch.tensor([[0,0],[1,0]])  # image 1's targets reverse anchor order
        prediction = torch.zeros(2,2,4,3)
        prediction[0,0,:,:2] = target[0,:,:2]
        prediction[1,0,:,:2] = target[2,:,:2].roll(2,0)
        prediction[1,1,:,:2] = target[1,:,:2].roll(2,0)
        prediction.requires_grad_()
        boxes = torch.tensor([0.,0.,10.,10.]).repeat(2,2,1)
        loss._orientation_known = flags
        pose, presence = loss.calculate_keypoints_loss(masks,assigned,target,batch_idx,torch.ones(2,1),boxes,prediction)
        pose.backward(retain_graph=True)
        self.assertEqual(prediction.grad[0].abs().sum().item(),0)
        self.assertEqual(prediction.grad[1,0].abs().sum().item(),0)
        self.assertGreater(prediction.grad[1,1].abs().sum().item(),0)
        self.assertTrue(torch.isfinite(presence))
        self.assertEqual(loss.phase_counts.sum().item(),3)


if __name__ == "__main__":
    unittest.main()
