import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("audit_canonical_geometry.py")
SPEC = importlib.util.spec_from_file_location("audit_canonical_geometry", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CanonicalGeometryAuditTests(unittest.TestCase):
    def test_normalizes_coco_closing_point_before_quad_gate(self):
        row = {
            "split": "train",
            "provenance": [{"source": "fixture"}],
            "annotations": [
                {
                    "category": "card",
                    "geometryQuality": "source-polygon",
                    "segmentation": [[0, 0, 60, 0, 60, 90, 0, 90, 0, 0]],
                }
            ],
        }
        with tempfile.TemporaryDirectory() as temporary:
            corpus = Path(temporary) / "corpus.jsonl"
            corpus.write_text(json.dumps(row) + "\n", encoding="utf-8")
            report = MODULE.audit(corpus)
        self.assertEqual(report["summary"]["closingPointNormalized"], 1)
        self.assertEqual(report["summary"]["quadFit:accepted"], 1)
        self.assertEqual(report["sceneCandidates"]["single_card_archive"], 1)


if __name__ == "__main__":
    unittest.main()
