"""Exact quarter-turn augmentation with bound printed-corner semantics.

Rotate the whole padded photo before the ordinary no-augmentation pipeline.
No cropping, interpolation, reflection, or new visibility labels are introduced.
"""
from copy import copy
import random

import numpy as np
from ultralytics.models.yolo.pose.train import PoseTrainer
from ultralytics.utils import colorstr
from ultralytics.utils.torch_utils import unwrap_model
from yolo_corner_order import CornerOrderDataset, require_runtime

POLICY = 'fixed-quarter-turn-v1'


def rotate_xy(points, turns):
    result = points.copy()
    for _ in range(turns % 4):
        result = np.stack((1-result[..., 1], result[..., 0]), axis=-1)
    return result


def rotate_label(label, turns):
    turns %= 4
    if not turns:
        return label
    instances = label['instances']
    if not instances.normalized or len(instances.segments):
        raise ValueError('Rotation requires normalized pose instances without masks')
    flags = label['orientation_lookup']
    ids = label['cls'].flatten().astype(int)
    keypoints = instances.keypoints.copy()
    supervised = (keypoints[..., 2] != 0).all(axis=1)
    if np.any((keypoints[..., 2] != 0).any(axis=1) != supervised):
        raise ValueError('Rotation requires complete known coordinates or box-only targets')
    keypoints[supervised, :, :2] = rotate_xy(keypoints[supervised, :, :2], turns)
    image = np.ascontiguousarray(np.rot90(label['img'], -turns))
    height, width = image.shape[:2]
    for index in np.flatnonzero(supervised & ~flags[ids]):
        xy = keypoints[index, :, :2]
        start = int(np.argmin(xy[:, 0]*width + xy[:, 1]*height))
        keypoints[index] = np.roll(keypoints[index], -start, axis=0)
    instances.convert_bbox('xyxy')
    boxes = instances.bboxes
    corners = np.stack((boxes[:, [0,1]], boxes[:, [2,1]], boxes[:, [2,3]], boxes[:, [0,3]]), axis=1)
    corners = rotate_xy(corners, turns)
    boxes = np.concatenate((corners.min(axis=1), corners.max(axis=1)), axis=1)
    instances.update(bboxes=boxes, keypoints=keypoints)
    label['img'] = image
    if turns % 2:
        for name in ('ori_shape', 'resized_shape', 'ratio_pad'):
            label[name] = label[name][::-1]
    return label


class FixedRotationDataset(CornerOrderDataset):
    policy = POLICY

    def get_image_and_label(self, index):
        label = super().get_image_and_label(index)
        eligible = label.pop('rotation_eligible')
        if type(eligible) is not bool:
            raise ValueError('Rotation eligibility must be explicit')
        return rotate_label(label, random.randrange(4)) if self.augment and eligible else label


class FixedRotationPoseTrainer(PoseTrainer):
    """Stock fixed-order pose loss and validator; only training pixels rotate."""
    def build_dataset(self, img_path, mode='train', batch=None):
        require_runtime()
        if self.data.get('corner_order_policy') != POLICY:
            raise ValueError('Rotation requires a hash-bound orientation sidecar')
        if self.args.fraction != 1.0 or self.args.classes is not None or self.args.rect:
            raise ValueError('Rotation requires full, unfiltered, non-rectangular training')
        stride = max(int(unwrap_model(self.model).stride.max()), 32)
        return FixedRotationDataset(img_path=img_path, imgsz=self.args.imgsz, batch_size=batch,
            augment=mode == 'train', hyp=copy(self.args), rect=mode == 'val', cache=self.args.cache or None,
            single_cls=self.args.single_cls or False, stride=stride, pad=0.0 if mode == 'train' else 0.5,
            prefix=colorstr(f'{mode}: '), task=self.args.task, classes=None, data=self.data, fraction=1.0)
