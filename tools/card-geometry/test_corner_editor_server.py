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

    def test_explicit_no_labelable_card_is_finalized_without_a_quad(self):
        sample = _Sample(
            key="frame-1",
            manual_instances_json=(
                '{"noLabelableCard":true,"instances":[],"sceneSlice":"steep_playmat"}'
            ),
        )
        self.assertTrue(SERVER.geometry_is_negative(sample))
        self.assertTrue(SERVER.geometry_is_finalized(sample, []))

    def test_payload_accepts_only_explicit_empty_negative_frame(self):
        quads, metadata = SERVER.validate_payload(
            {"quads": [], "metadata": [], "noLabelableCard": True}
        )
        self.assertEqual(quads, [])
        self.assertEqual(metadata, [])
        with self.assertRaisesRegex(ValueError, "at least one card quad"):
            SERVER.validate_payload({"quads": [], "metadata": []})

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

    def test_requested_scene_slice_is_used_for_unfinalized_frame(self):
        sample = _Sample(key="frame-1", frame_type="single")
        self.assertEqual(
            SERVER.scene_slice_for(sample, "steep_playmat"), "steep_playmat"
        )

    def test_sample_scene_suggestion_is_used_without_an_override(self):
        sample = _Sample(
            key="frame-1",
            frame_type="single",
            geometry_scene_slice="steep_playmat",
        )
        self.assertEqual(SERVER.scene_slice_for(sample), "steep_playmat")

    def test_finalized_scene_slice_is_not_silently_rewritten(self):
        sample = _Sample(
            key="frame-1",
            manual_instances_json='{"sceneSlice":"duel_field","instances":[]}',
        )
        self.assertEqual(
            SERVER.scene_slice_for(sample, "steep_playmat"), "duel_field"
        )

    def test_detection_quads_can_seed_an_unfinalized_draft(self):
        class _Polyline:
            def __init__(self, label, left):
                self.label = label
                self.points = [
                    [[left, 0.1], [0.9, 0.1], [0.9, 0.9], [left, 0.9]]
                ]

        class _Polylines:
            polylines = [_Polyline("attempt", 0.2), _Polyline("decisive", 0.1)]

        sample = _Sample(detection_quads=_Polylines())
        quads = SERVER.polyline_quads(
            sample, "detection_quads", preferred_label="decisive", limit=1
        )
        self.assertEqual(len(quads), 1)
        self.assertEqual(quads[0][0][0], 0.1)


if __name__ == "__main__":
    unittest.main()
