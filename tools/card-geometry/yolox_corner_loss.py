"""Non-saturating coordinate objective for explicitly configured YOLOX runs.

This module does not alter the frozen OksLoss experiment. Targets are normalized
by the box diagonal so the coordinate objective is independent of image scale.
"""
import torch
from torch import nn


class NormalizedCornerLoss(nn.Module):
    def __init__(self, loss_weight: float = 30.0):
        super().__init__()
        self.loss_weight = loss_weight

    def forward(self, output, target, target_weights, bboxes):
        scale = torch.linalg.vector_norm(bboxes[..., 2:] - bboxes[..., :2], dim=-1).clamp(min=1e-8)
        distance = (output - target).abs().mean(dim=-1) / scale.unsqueeze(-1)
        visible = (target_weights > 0).to(distance)
        return self.loss_weight * (distance * visible).sum(dim=-1) / visible.sum(dim=-1).clamp(min=1)
