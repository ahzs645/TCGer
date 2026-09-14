"""Orientation-aware supervision for the pinned YOLO11 pose training runtime.

Only the training criterion and dataset adapter change. Checkpoints contain a
standard PoseModel; Ultralytics strips its criterion before serialization.
"""
from copy import copy
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from ultralytics import __version__
from ultralytics.data.dataset import YOLODataset
from ultralytics.models.yolo.pose.train import PoseTrainer
from ultralytics.models.yolo.pose.val import PoseValidator
from ultralytics.models.yolo.detect.val import DetectionValidator
from ultralytics.utils import colorstr
from ultralytics.utils.loss import v8PoseLoss
from ultralytics.utils.metrics import kpt_iou
from ultralytics.utils.torch_utils import unwrap_model

POLICY = "cyclic-unknown-v1"
VERSION = "8.4.138"
DISABLED_AUGMENTATIONS = (
    "degrees", "translate", "scale", "shear", "perspective", "flipud", "fliplr",
    "mosaic", "mixup", "cutmix", "copy_paste", "hsv_h", "hsv_s", "hsv_v", "bgr",
)


def require_runtime():
    if __version__ != VERSION:
        raise RuntimeError(f"corner-order adapter requires Ultralytics {VERSION}, got {__version__}")


def align_corner_targets(prediction, target, area, sigmas, orientation_known):
    """Choose a cyclic phase per unknown target with the pinned OKS loss cost.

    Selection is discrete; coordinate and presence losses below use the same
    selected target, including its visibility. No reflection is an option.
    """
    with torch.no_grad():
        candidates = torch.stack([target.roll(shift, dims=1) for shift in range(4)], dim=1)
        mask = candidates[..., 2] != 0
        distance = (prediction[:, None, :, :2] - candidates[..., :2]).square().sum(-1)
        exponent = distance / ((2 * sigmas).square()[None, None, :] * (area[:, None, :] + 1e-9) * 2)
        factor = 4 / (mask.sum(-1) + 1e-9)
        costs = (factor[..., None] * (1 - torch.exp(-exponent)) * mask).mean(-1)
        costs[:, 1:] = costs[:, 1:].masked_fill(orientation_known[:, None], float("inf"))
        phases = costs.argmin(1)
        aligned = candidates[torch.arange(len(target), device=target.device), phases]
    return aligned, phases


class CornerOrderPoseLoss(v8PoseLoss):
    def __init__(self, model):
        require_runtime()
        super().__init__(model)
        if list(self.kpt_shape) != [4, 3] or model.end2end:
            raise ValueError("corner-order loss requires a standard four-corner YOLO11 pose model")
        self.phase_counts = torch.zeros(4, dtype=torch.long, device=self.device)
        self._orientation_known = None

    def loss(self, preds, batch):
        flags = batch.get("orientation_known")
        if flags is None or flags.dtype != torch.bool or flags.shape != (len(batch["keypoints"]),):
            raise ValueError("pose batch requires one boolean orientation flag per target")
        self._orientation_known = flags.to(self.device)
        try:
            return super().loss(preds, batch)
        finally:
            self._orientation_known = None

    def calculate_keypoints_loss(self, masks, target_gt_idx, keypoints, batch_idx,
                                 stride_tensor, target_bboxes, pred_kpts):
        if self._orientation_known is None:
            raise ValueError("orientation metadata was not supplied to the pose loss")
        selected = self._select_target_keypoints(keypoints, batch_idx, target_gt_idx, masks)
        # Use the exact same assignment helper and ground-truth indices as XYV.
        selected_flags = self._select_target_keypoints(
            self._orientation_known[:, None, None].float(), batch_idx, target_gt_idx, masks)
        if not masks.any():
            return pred_kpts.sum() * 0, pred_kpts.sum() * 0
        gt = selected[masks]
        strides = stride_tensor.view(1, -1).expand(masks.shape[0], -1)[masks]
        gt[..., :2] /= strides[:, None, None]
        boxes = (target_bboxes / stride_tensor)[masks]
        area = (boxes[:, 2:] - boxes[:, :2]).prod(1, keepdim=True)
        prediction = pred_kpts[masks]
        flags = selected_flags[masks][:, 0, 0].bool()
        gt, phases = align_corner_targets(prediction, gt, area, self.keypoint_loss.sigmas, flags)
        self.phase_counts += torch.bincount(phases, minlength=4)
        visible = gt[..., 2] != 0
        return (self.keypoint_loss(prediction, gt, visible, area),
                self.bce_pose(prediction[..., 2], visible.float()))


class CornerOrderDataset(YOLODataset):
    policy = POLICY

    def get_labels(self):
        require_runtime()
        labels = super().get_labels()
        metadata = json.loads((Path(self.data["path"]) / self.data["corner_order_metadata"]).read_text())
        if metadata["policy"] != self.policy or self.data["corner_order_policy"] != self.policy:
            raise ValueError("corner-order dataset policy mismatch")
        root = Path(self.data["path"]).resolve()
        for label in labels:
            relative = Path(label["im_file"]).resolve().relative_to(root)
            binding = metadata["images"][relative.as_posix()]
            label_path = root / "labels" / relative.parent.name / (relative.stem + ".txt")
            if hashlib.sha256(label_path.read_bytes()).hexdigest() != binding["labelSha256"]:
                raise ValueError(f"corner-order label binding mismatch: {relative}")
            lookup = {}
            for row in binding["targets"]:
                key = np.asarray(row["yolo"], dtype=np.float32).tobytes()
                if type(row["orientationKnown"]) is not bool:
                    raise ValueError("orientationKnown must be boolean")
                if key in lookup and lookup[key] != row["orientationKnown"]:
                    raise ValueError(f"duplicate geometry has conflicting orientation metadata: {relative}")
                lookup[key] = row["orientationKnown"]
            # Join on the verified row, since the upstream cache can deduplicate
            # or reorder labels. Never assume that sidecar array order survives.
            count = len(label["cls"])
            rows = np.concatenate((label["cls"], label["bboxes"], label["keypoints"].reshape(count, 12)), axis=1)
            label["orientation_lookup"] = np.asarray([lookup[row.tobytes()] for row in rows], dtype=bool)
            if "rotationEligible" in binding:
                label["rotation_eligible"] = binding["rotationEligible"]
        return labels

    def build_transforms(self, hyp=None):
        if self.augment:
            active = [name for name in DISABLED_AUGMENTATIONS if getattr(hyp, name, 0) != 0]
            if active or getattr(hyp, "augmentations", None):
                raise ValueError(f"corner-order v1 requires the frozen no-runtime-augmentation recipe: {active}")
        return super().build_transforms(hyp)

    def get_image_and_label(self, index):
        label = super().get_image_and_label(index)
        if np.any(label["cls"] != 0):
            raise ValueError("corner-order adapter supports only the card class")
        # Use temporary instance IDs in the transform's class carrier: all its
        # filtering operations already keep this carrier aligned with instances.
        # IDs are removed before collation; the model only sees class zero.
        label["cls"] = np.arange(len(label["cls"]), dtype=np.float32)[:, None]
        return label

    def __getitem__(self, index):
        sample = super().__getitem__(index)
        ids = sample["cls"].flatten()
        lookup = sample.pop("orientation_lookup")
        if not torch.equal(ids, ids.round()) or (len(ids) and (ids.min() < 0 or ids.max() >= len(lookup))):
            raise ValueError("transforms corrupted corner-order target identities")
        sample["orientation_known"] = torch.from_numpy(lookup[ids.long().numpy()].copy())
        sample["cls"].zero_()
        return sample

    @staticmethod
    def collate_fn(batch):
        flags = torch.cat([sample["orientation_known"] for sample in batch])
        result = YOLODataset.collate_fn([{k:v for k,v in sample.items() if k != "orientation_known"} for sample in batch])
        result["orientation_known"] = flags
        return result


def write_runtime_report(trainer):
    criterion = unwrap_model(trainer.model).criterion
    report = {"policy": POLICY, "ultralyticsVersion": __version__,
              "positiveAnchorPhaseCounts": criterion.phase_counts.cpu().tolist(),
              "checkpointClass": "ultralytics.nn.tasks.PoseModel",
              "checkpointSelection": "upstream fitness with cyclic OKS for orientation-unknown validation targets"}
    (trainer.save_dir / "corner-order-loss.json").write_text(json.dumps(report, indent=2) + "\n")


class CornerOrderPoseTrainer(PoseTrainer):
    def __init__(self, *args, **kwargs):
        require_runtime()
        super().__init__(*args, **kwargs)
        self.add_callback("on_train_end", write_runtime_report)

    def set_model_attributes(self):
        super().set_model_attributes()
        self.model.criterion = CornerOrderPoseLoss(self.model)

    def get_validator(self):
        return CornerOrderPoseValidator(self.test_loader, save_dir=self.save_dir,
                                        args=copy(self.args), _callbacks=self.callbacks)

    def build_dataset(self, img_path, mode="train", batch=None):
        if self.data.get("corner_order_policy") != POLICY:
            raise ValueError("corner-order trainer requires a bound orientation sidecar")
        if self.args.fraction != 1.0 or self.args.classes is not None:
            raise ValueError("corner-order v1 requires the complete unfiltered dataset")
        stride = max(int(unwrap_model(self.model).stride.max()), 32)
        return CornerOrderDataset(
            img_path=img_path, imgsz=self.args.imgsz, batch_size=batch,
            augment=mode == "train", hyp=copy(self.args), rect=self.args.rect or mode == "val",
            cache=self.args.cache or None, single_cls=self.args.single_cls or False,
            stride=stride, pad=0.0 if mode == "train" else 0.5, prefix=colorstr(f"{mode}: "),
            task=self.args.task, classes=None, data=self.data, fraction=1.0)


def orientation_aware_oks(target, prediction, area, sigma, orientation_known):
    fixed = kpt_iou(target, prediction, sigma=sigma, area=area)
    best = fixed
    for phase in (1, 2, 3):
        best = torch.maximum(best, kpt_iou(target.roll(phase, dims=1), prediction, sigma=sigma, area=area))
    return torch.where(orientation_known[:, None], fixed, best)


class CornerOrderPoseValidator(PoseValidator):
    def _prepare_batch(self, si, batch):
        prepared = super()._prepare_batch(si, batch)
        prepared["orientation_known"] = batch["orientation_known"][batch["batch_idx"] == si]
        return prepared

    def _process_batch(self, preds, batch):
        # Keep detection matching and the fitness formula; repair only unknown
        # corner identity in pose similarity, including checkpoint selection.
        result = DetectionValidator._process_batch(self, preds, batch)
        if not len(batch["cls"]) or not len(preds["cls"]):
            pose = np.zeros((len(preds["cls"]), self.niou), dtype=bool)
        else:
            boxes = batch["bboxes"]
            area = (boxes[:, 2:] - boxes[:, :2]).prod(1) * .53
            iou = orientation_aware_oks(batch["keypoints"], preds["keypoints"], area,
                                        self.sigma, batch["orientation_known"])
            pose = self.match_predictions(preds["cls"], batch["cls"], iou).cpu().numpy()
        result["tp_p"] = pose
        return result

    def build_dataset(self, img_path, mode="val", batch=None):
        # The standalone best-checkpoint validation also rebuilds its dataset.
        return CornerOrderDataset(
            img_path=img_path, imgsz=self.args.imgsz, batch_size=batch, augment=False,
            hyp=copy(self.args), rect=self.args.rect, cache=self.args.cache or None,
            single_cls=self.args.single_cls or False, stride=self.stride, pad=.5,
            prefix=colorstr("val: "), task="pose", classes=None, data=self.data, fraction=1.0)
