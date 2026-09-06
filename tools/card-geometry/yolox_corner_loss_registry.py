"""Register the opt-in coordinate objective in the pinned MMYOLO runtime."""
from mmyolo.registry import MODELS
from yolox_corner_loss import NormalizedCornerLoss

MODELS.register_module(module=NormalizedCornerLoss)
