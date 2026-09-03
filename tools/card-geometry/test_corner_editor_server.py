import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
SERVER_PATH = ROOT / "tools/card-geometry/corner_editor_server.py"
SPEC = importlib.util.spec_from_file_location("tcger_corner_editor_server", SERVER_PATH)
SERVER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(SERVER)


class _Sample(dict):
    id = "sample-id"

    def get_field(self, name):
        if name not in self:
            raise AttributeError(name)
        return self[name]

    def has_field(self, name):
        return name in self


class CornerEditorServerTest(unittest.TestCase):
    def test_missing_optional_metadata_field_uses_defaults(self):
        quad = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
        metadata = SERVER.load_editor_metadata(_Sample(key="frame-1"), [quad])
        self.assertEqual(metadata[0]["side"], "faceUp")

    def test_saved_metadata_is_reused_when_card_counts_match(self):
        quad = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
        sample = _Sample(
            key="frame-1",
            manual_instances_json=(
                '{"instances":[{"physicalCardId":"physical-1",'
                '"occlusionOrder":4,"orientationKnown":false,"side":"faceDown",'
                '"cornerVisibility":["visible","visible","occluded","visible"]}]}'
            ),
        )
        metadata = SERVER.load_editor_metadata(sample, [quad])
        self.assertEqual(metadata[0]["physicalCardId"], "physical-1")
        self.assertFalse(metadata[0]["orientationKnown"])
        self.assertEqual(metadata[0]["cornerVisibility"][2], "occluded")

    def test_finalized_requires_durable_corners_to_match_current_quads(self):
        quad = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
        sample = _Sample(
            key="frame-1",
            manual_instances_json=(
                '{"instances":[{"corners":'
                + __import__("json").dumps(quad)
                + "}]}"
            ),
        )
        self.assertTrue(SERVER.geometry_is_finalized(sample, [quad]))
        changed = [[0.11, 0.1], *quad[1:]]
        self.assertFalse(SERVER.geometry_is_finalized(sample, [changed]))

    def test_payload_accepts_amodal_ordered_corners(self):
        payload = {
            "quads": [[[0.1, 0.1], [0.9, 0.1], [0.9, 1.05], [0.1, 1.05]]],
            "metadata": [{
                "physicalCardId": "physical-1",
                "occlusionOrder": 0,
                "orientationKnown": True,
                "side": "faceUp",
                "cornerVisibility": ["visible", "visible", "outsideFrame", "outsideFrame"],
            }],
        }
        quads, metadata = SERVER.validate_payload(payload)
        self.assertEqual(quads, payload["quads"])
        self.assertEqual(metadata[0]["side"], "faceUp")

    def test_payload_rejects_crossed_corners(self):
        crossed = {
            "quads": [[[0.1, 0.1], [0.9, 0.9], [0.9, 0.1], [0.1, 0.9]]],
            "metadata": [{"occlusionOrder": 0, "cornerVisibility": ["visible"] * 4}],
        }
        with self.assertRaisesRegex(ValueError, "cross"):
            SERVER.validate_payload(crossed)


if __name__ == "__main__":
    unittest.main()
