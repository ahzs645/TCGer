import copy
import hashlib
from pathlib import Path
import tempfile
import unittest

from PIL import Image

from evaluate_reviewed_session import session_records, score_records


class ReviewedSessionTest(unittest.TestCase):
    def test_snapshot_binding_preserves_corners_and_derived_visibility(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "photo.png"
            Image.new("RGB", (100, 140)).save(path)
            quad = [[.1, .1], [.9, .1], [.9, .9], [.1, .9]]
            backup = {"records": [{"key": "session/frame-0", "sampleId": "sample",
                                   "imagePath": str(path), "imageSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                                   "manual_quads": [quad]}]}
            derived = {"records": [{"key": "session/frame-0", "sceneSlice": "single_handheld", "instances": [
                {"instanceId": "card-0", "corners": quad, "orientationKnown": True,
                 "cornerVisibility": ["visible", "visible", "occluded", "outsideFrame"]}]}]}
            original = copy.deepcopy(derived)
            record = session_records(backup, derived)[0]
            self.assertEqual(record["recordId"], "session:frame-0")
            self.assertEqual(record["key"], "session/frame-0")
            self.assertEqual(derived, original)
            self.assertEqual(record["source"]["width"], 100)
            self.assertEqual(record["instances"][0]["corners"][2]["visibility"], "occluded")
            altered = copy.deepcopy(derived)
            altered["records"][0]["instances"][0]["corners"][0][0] = .11
            with self.assertRaisesRegex(ValueError, "changed reviewed corners"):
                session_records(backup, altered)
            Image.new("RGB", (110, 140)).save(path)
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                session_records(backup, derived)

    def test_scoring_counts_each_truth_once_and_separates_rotation_from_border(self):
        points = [{"x": x, "y": y} for x, y in [[.1,.1],[.9,.1],[.9,.9],[.1,.9]]]
        instance = {"corners": [{"point": p, "coordinateKnown": True, "cornerSource": "human", "visibility": "visible"} for p in points], "orientationKnown": True}
        record = {"recordId": "one", "sceneSlice": "single_handheld", "source": {"width":100,"height":140}, "instances": [instance]}
        shifted = points[1:]+points[:1]
        prediction = {"confidence": .9, "corners": [{"point":p} for p in shifted]}
        report = score_records([record], {"one": [prediction,prediction]})
        self.assertEqual(report["detection"]["overall"]["matches"],1)
        self.assertEqual(report["detection"]["overall"]["duplicate"],1)
        self.assertEqual(report["detection"]["overall"]["recall@0.9"],1)
        self.assertEqual(report["orientation"]["correctPairs"],0)
        self.assertGreater(report["cornerError"]["overall"]["normalized"]["p50"],0)


if __name__ == "__main__":
    unittest.main()
