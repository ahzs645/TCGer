import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("classify_canonical_scenes.py")
SPEC = importlib.util.spec_from_file_location("classify_canonical_scenes", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CanonicalSceneClassificationTests(unittest.TestCase):
    def test_conservative_rules_separate_grid_overlap_and_other(self):
        binder = {
            "cardCount": 9,
            "gridAlignment": 1.0,
            "sizeCoefficientOfVariation": 0.05,
            "rotationSpreadDegrees": 2.0,
            "overlapPairFraction": 0.0,
        }
        duel = {**binder, "gridAlignment": 0.4, "overlapPairFraction": 0.2}
        other = {**binder, "cardCount": 2, "gridAlignment": 0.0}
        self.assertEqual(MODULE.classify(binder)[0], "binder_page")
        self.assertEqual(MODULE.classify(duel)[0], "duel_field")
        self.assertEqual(MODULE.classify(other)[0], "other")


if __name__ == "__main__":
    unittest.main()
