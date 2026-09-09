import copy
import unittest

import torch
from ultralytics.utils.loss import KeypointLoss

from audit_corner_ordering import cyclic_loss_probe, loss_probe


class CornerOrderingTests(unittest.TestCase):
    def setUp(self):
        self.criterion = KeypointLoss(torch.full((4,), .25))
        self.target = torch.tensor([[[20., 15., 2.], [75., 25., 2.],
                                     [68., 110., 1.], [10., 90., 2.]]])
        self.mask = self.target[..., 2] != 0
        self.area = torch.tensor([[65. * 95.]])

    def test_current_export_discards_orientation_and_penalizes_identical_outline(self):
        instance = {"orientationKnown": False, "corners": [
            {"point": {"x": x/200, "y": y/120}, "coordinateKnown": True,
             "visibility": "visible" if v == 2 else "occluded"}
            for x,y,v in self.target[0].tolist()]}
        before = copy.deepcopy(instance)
        result = loss_probe(instance, 200, 120, dict.fromkeys(("left", "right", "top", "bottom"), 20))
        self.assertTrue(result["exportIgnoresOrientationFlag"])
        for row in result["variants"]:
            self.assertAlmostEqual(row["borderIou"], 1)
            self.assertEqual(row["experimentalUnknownOrientationLoss"], 0)
            if row["cyclicShift"]:
                self.assertGreater(row["currentFixedOrderLoss"], 0)
                self.assertGreater(row["currentGradientNorm"], 0)
                self.assertGreater(row["experimentalKnownOrientationLoss"], 0)
        self.assertEqual(instance, before)

    def test_unknown_cyclic_labels_have_same_loss_and_gradient(self):
        prediction = (self.target[..., :2] + torch.tensor([2., -3.])).requires_grad_(True)
        base = cyclic_loss_probe(self.criterion, prediction, self.target, self.mask, self.area, [False])
        base_gradient, = torch.autograd.grad(base, prediction)
        for phase in range(1, 4):
            loss = cyclic_loss_probe(self.criterion, prediction, self.target.roll(phase, 1),
                                     self.mask.roll(phase, 1), self.area, [False])
            gradient, = torch.autograd.grad(loss, prediction)
            torch.testing.assert_close(loss, base)
            torch.testing.assert_close(gradient, base_gradient)

    def test_known_orientation_is_exactly_the_existing_criterion(self):
        prediction = self.target[..., :2].roll(1, 1).clone().requires_grad_(True)
        fixed = self.criterion(prediction, self.target, self.mask, self.area)
        proposed = cyclic_loss_probe(self.criterion, prediction, self.target, self.mask, self.area, [True])
        torch.testing.assert_close(proposed, fixed)
        expected_gradient, = torch.autograd.grad(fixed, prediction)
        gradient, = torch.autograd.grad(proposed, prediction)
        torch.testing.assert_close(gradient, expected_gradient)

    def test_reversed_winding_remains_an_error(self):
        reversed_quad = self.target[..., :2][:, [0, 3, 2, 1]]
        loss = cyclic_loss_probe(self.criterion, reversed_quad, self.target, self.mask, self.area, [False])
        self.assertGreater(loss.item(), .1)

    def test_visibility_rotates_with_coordinates_without_mutation(self):
        mask = torch.tensor([[True, False, True, False]])
        target_before, mask_before = self.target.clone(), mask.clone()
        prediction = self.target[..., :2].roll(1, 1).clone()
        prediction[:, [0, 2]] += 100  # These are the shifted unknown coordinates.
        self.assertEqual(cyclic_loss_probe(self.criterion, prediction, self.target, mask, self.area, [False]).item(), 0)
        torch.testing.assert_close(self.target, target_before)
        torch.testing.assert_close(mask, mask_before)

    def test_mixed_batch_preserves_box_only_mask_and_known_orientation(self):
        target = self.target.repeat(3, 1, 1)
        mask = self.mask.repeat(3, 1)
        mask[0] = False
        prediction = target[..., :2].roll(1, 1).clone().requires_grad_(True)
        loss = cyclic_loss_probe(self.criterion, prediction, target, mask, self.area.repeat(3, 1), [False, False, True])
        loss.backward()
        self.assertEqual(prediction.grad[:2].abs().sum().item(), 0)
        self.assertGreater(prediction.grad[2].abs().sum().item(), 0)
        self.assertGreater(loss.item(), 0)


if __name__ == "__main__":
    unittest.main()
