import unittest
import torch
from yolox_corner_loss import NormalizedCornerLoss


class CornerLossTests(unittest.TestCase):
    def test_distant_corner_has_gradient_toward_target(self):
        target = torch.tensor([[[0., 0.], [200., 0.], [200., 300.], [0., 300.]]])
        prediction = target.clone()
        prediction[0, 2] = torch.tensor([2., 2.])
        prediction.requires_grad_()
        value = NormalizedCornerLoss()(prediction, target, torch.ones(1, 4),
                                       torch.tensor([[0., 0., 200., 300.]]))
        value.sum().backward()
        self.assertTrue((prediction.grad[0, 2] < 0).all())
        self.assertEqual(torch.count_nonzero(prediction.grad).item(), 2)

    def test_unknown_corners_have_zero_loss_and_gradient(self):
        prediction = torch.ones(2, 4, 2, requires_grad=True)
        value = NormalizedCornerLoss()(prediction, torch.zeros_like(prediction),
                                       torch.zeros(2, 4), torch.tensor([[0., 0., 2., 3.]]).repeat(2, 1))
        value.sum().backward()
        self.assertEqual(value.tolist(), [0., 0.])
        self.assertEqual(torch.count_nonzero(prediction.grad).item(), 0)

    def test_scale_invariance_and_mixed_visibility(self):
        prediction = torch.ones(1, 4, 2, requires_grad=True)
        target = torch.zeros_like(prediction)
        weights = torch.tensor([[1., 0., 1., 0.]])
        boxes = torch.tensor([[0., 0., 20., 30.]])
        loss = NormalizedCornerLoss()
        torch.testing.assert_close(loss(prediction, target, weights, boxes),
                                   loss(prediction * 10, target, weights, boxes * 10))
        loss(prediction, target, weights, boxes).sum().backward()
        self.assertTrue((prediction.grad[0, [0, 2]] > 0).all())
        self.assertEqual(torch.count_nonzero(prediction.grad[0, [1, 3]]).item(), 0)


if __name__ == '__main__':
    unittest.main()
