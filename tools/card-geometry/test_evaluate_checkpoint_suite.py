import unittest

from benchmark_geometry import Truth
from evaluate_checkpoint_suite import summarize_overlaps


class SuiteOverlapTests(unittest.TestCase):
    def test_assignment_precedes_human_slice_so_predictions_cannot_be_reused(self):
        quad = ((0., 0.), (1., 0.), (1., 1.), (0., 1.))
        human = {'corners': [{'coordinateKnown': True, 'cornerSource': 'human'}] * 4}
        truths = [Truth('same-photo', i, 'grid', 'real', 100, 100, data, quad, 'quad')
                  for i, data in enumerate([human, {}])]
        prediction = {'corners': [{'point': {'x': x, 'y': y}} for x, y in quad]}
        report = summarize_overlaps(truths, {'same-photo': [prediction]})
        self.assertEqual(report['all']['count'], 2)
        self.assertEqual(report['all']['mean'], .5)
        self.assertEqual(sum(r['iou'] for r in report['rows']), 1)
        self.assertEqual(report['humanCorners']['count'], 1)
        self.assertEqual(report['otherReferences']['count'], 1)

    def test_empty_predictions_keep_all_targets_and_photo_weighting(self):
        quad = ((0., 0.), (1., 0.), (1., 1.), (0., 1.))
        truths = [Truth('photo', 0, 'single', 'real', 100, 100, {}, quad, 'quad')]
        report = summarize_overlaps(truths, {'photo': []})
        self.assertEqual(report['all']['mean'], 0)
        self.assertEqual(report['all']['photoBalancedMean'], 0)
        self.assertIsNone(report['humanCorners'])


if __name__ == '__main__':
    unittest.main()
