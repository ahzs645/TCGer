#!/usr/bin/env python3
"""One-epoch fixture smoke for the exact fixed-order rotation trainer."""
import argparse
import importlib.util
import json
from pathlib import Path
import torch
from ultralytics import YOLO, __version__
from ultralytics.utils.loss import v8PoseLoss
from test_yolo_corner_order import fixture, CONTEXT
from train_yolo_pose import materialize_yolo
from yolo_corner_order import DISABLED_AUGMENTATIONS
from yolo_card_rotation import FixedRotationPoseTrainer


def validate(output):
    if __version__ != '8.4.138' or importlib.util.find_spec('albumentations') is not None:
        raise ValueError('Unexpected runtime or implicit augmentation dependency')
    output.mkdir(parents=True,exist_ok=False);torch.set_num_threads(2)
    fixture(output)
    data=output/'rotation-dataset'
    materialize_yolo(output/'release',data,CONTEXT,'fixed-v1','quarter-turn-v1')
    model=YOLO('yolo11s-pose.yaml')
    criteria=[]
    model.add_callback('on_train_batch_end',lambda trainer: criteria.append(type(trainer.model.criterion)))
    model.train(trainer=FixedRotationPoseTrainer,data=str(data/'dataset.yaml'),epochs=1,imgsz=128,batch=2,
        device='cpu',workers=0,seed=20260905,deterministic=True,project=str(output),name='train',
        save=True,plots=False,verbose=False,val=True,close_mosaic=0,**dict.fromkeys(DISABLED_AUGMENTATIONS,0.))
    if not criteria or any(criterion is not v8PoseLoss for criterion in criteria):
        raise ValueError('Rotation changed the fixed-order criterion')
    loaded=YOLO(str(output/'train/weights/last.pt'))
    predictions=loaded.predict(str(data/'images/train/train-mixed.jpg'),verbose=False)
    if predictions[0].keypoints.data.shape[-2:] != (4,3):
        raise ValueError('Saved model did not preserve four keypoints')
    report=dict(passed=True,epochs=1,fixtureOnly=True,ultralytics=__version__,device='cpu',
                stockFixedOrderLoss=True,savedCheckpointReloaded=True,implicitAlbumentations=False)
    (output/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True)
    print(json.dumps(validate(parser.parse_args().output)))
