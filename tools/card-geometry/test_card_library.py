import unittest
from card_library import combine_frames, instance


class CoverageSourceTests(unittest.TestCase):
    def test_exact_duplicate_keeps_review_and_original_split_membership(self):
        base = dict(imageSha256='same', recordId='original', collection='benchmark', split='test', priority=40, instances=['old'])
        review = dict(base, recordId='reviewed-alias', collection='reference-review', split='library', priority=90, instances=['saved'])
        for frames in [[base, review], [review, base]]:
            combined = combine_frames(frames)
            self.assertEqual(len(combined), 1)
            self.assertEqual(combined[0]['instances'], ['saved'])
            self.assertEqual(combined[0]['split'], 'test')
            self.assertEqual(combined[0]['aliases'], ['original', 'reviewed-alias'])

    def test_variants_do_not_disappear_and_conflicting_splits_are_explicit(self):
        base = dict(imageSha256='color', recordId='a', collection='training', split='train', priority=40)
        rows = combine_frames([base, dict(base, imageSha256='gray'), dict(base, split='test')])
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['split'], 'mixed')
        self.assertEqual(rows[1]['split'], 'train')

    def test_coordinates_do_not_imply_printed_top(self):
        q = [[0,0], [1,0], [1,1], [0,1]]
        self.assertFalse(instance(dict(corners=q), 0)['orientationKnown'])
        self.assertTrue(instance(dict(corners=q, orientationKnown=True), 0)['orientationKnown'])
        corners = [dict(point=dict(x=x,y=y), coordinateKnown=i!=3, cornerSource='human') for i,(x,y) in enumerate(q)]
        result = instance(dict(corners=corners), 0)
        self.assertIsNone(result['quad'])
        self.assertEqual(result['quality'], 'unmeasured')


if __name__ == '__main__':
    unittest.main()
