import copy
import unittest

from apply_archive_corner_proposals import prepare


class CornerProposalTests(unittest.TestCase):
    def setUp(self):
        self.frame = {"recordId": "frame", "imageSha256": "abc", "width": 200, "height": 100,
                      "instances": [{"sourceAnnotationIndex": 7, "seedBox": {"left": .1, "top": .2, "right": .4, "bottom": .8}}]}
        self.proposal = {"recordId": "frame", "imageSha256": "abc", "reviewRevision": 0,
                         "targets": [{"sourceAnnotationIndex": 7, "cornersPixels": [[20, 20], [80, 20], [80, 80], [20, 80]], "orientationKnown": True}]}

    def test_original_index_pixel_scaling_and_machine_provenance(self):
        payload, added = prepare(self.frame, self.proposal, [7])
        self.assertEqual(added, [7])
        self.assertEqual(payload["targets"]["7"]["corners"], [[.1, .2], [.4, .2], [.4, .8], [.1, .8]])
        self.assertEqual(payload["targets"]["7"]["cornerSource"], "detector")
        self.assertEqual(payload["direction"], 0)

    def test_newer_human_save_and_image_changes_are_not_overwritten(self):
        self.frame["label"] = {"revision": 1, "reviewer": "Ahmad"}
        with self.assertRaisesRegex(RuntimeError, "newer review"):
            prepare(self.frame, self.proposal, [7])
        self.frame["imageSha256"] = "changed"
        with self.assertRaisesRegex(ValueError, "binding mismatch"):
            prepare(self.frame, self.proposal, [7])

    def test_wrong_annotation_and_mirrored_winding_fail(self):
        bad = copy.deepcopy(self.proposal)
        bad["targets"][0]["sourceAnnotationIndex"] = 1
        with self.assertRaisesRegex(ValueError, "Unknown target"):
            prepare(self.frame, bad, [1])
        bad = copy.deepcopy(self.proposal)
        bad["targets"][0]["cornersPixels"].reverse()
        with self.assertRaisesRegex(ValueError, "ordered TL"):
            prepare(self.frame, bad, [7])

    def test_existing_target_is_retained_even_with_matching_revision(self):
        self.frame["label"] = {"revision": 0, "targets": {"7": {"skip": "unsure"}}}
        self.assertEqual(prepare(self.frame, self.proposal, [7]), (None, []))

    def test_explicit_reviewed_skip_without_corners(self):
        self.proposal["targets"] = [{"sourceAnnotationIndex": 7, "skip": "cut-off"}]
        self.proposal["reviewNote"] = "Card crosses the physical photo boundary."
        payload, added = prepare(self.frame, self.proposal, [7])
        self.assertEqual(added, [7])
        self.assertEqual(payload["targets"], {"7": {"skip": "cut-off"}})
        self.assertEqual(payload["direction"], 0)
        self.assertEqual(payload["notes"], self.proposal["reviewNote"])
        self.assertEqual(prepare(self.frame, self.proposal, []), (None, []))

    def test_invalid_or_ambiguous_skip_is_rejected(self):
        self.proposal["targets"][0]["skip"] = "cut-off"
        with self.assertRaisesRegex(ValueError, "both labeled and skipped"):
            prepare(self.frame, self.proposal, [7])
        self.proposal["targets"] = [{"sourceAnnotationIndex": 7, "skip": "candidate-failed"}]
        with self.assertRaisesRegex(ValueError, "unknown skip reason"):
            prepare(self.frame, self.proposal, [7])


if __name__ == "__main__":
    unittest.main()
