import importlib.util
from pathlib import Path
import unittest
import json
from types import SimpleNamespace
from unittest.mock import patch


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
    def test_layers_round_trip_with_rotation_and_reject_cycles_before_saving(self):
        quads = [
            [[.1,.1],[.6,.1],[.6,.7],[.1,.7]],
            [[.3,.2],[.8,.2],[.8,.8],[.3,.8]],
            [[.4,.3],[.9,.3],[.9,.9],[.4,.9]],
        ]
        quads[0] = quads[0][1:] + quads[0][:1]
        sample = _Sample(key="frame-1", game="pokemon", frame_type="single")
        sample.save = lambda: None

        class Dataset(dict):
            def has_sample_field(self, name):
                return True

        store = object.__new__(SERVER.EditorStore)
        store.sample_ids = [sample.id]
        store.dataset = Dataset({sample.id: sample})
        store.fo = SimpleNamespace(Polylines=lambda **kw: SimpleNamespace(**kw),
                                   Polyline=lambda **kw: SimpleNamespace(**kw))
        relations = [{"above": 0, "below": 1}, {"above": 1, "below": 2}]
        metadata = SERVER.default_geometry_metadata("frame-1", quads)
        metadata[0]["cornerVisibility"] = ["occluded", "visible", "visible", "visible"]
        payload = {"quads": quads, "metadata": metadata, "finalize": True,
                   "sceneSlice": "single_handheld", "occlusionRelations": relations}
        with patch.object(SERVER, "append_journal") as journal:
            self.assertTrue(store.save(sample.id, payload)["finalized"])
            journal.assert_called_once_with(sample)
            self.assertEqual(SERVER.load_editor_layers(sample, quads), relations)
            saved = SERVER.durable_geometry(sample)
            self.assertEqual(saved["instances"][0]["corners"], quads[0])
            self.assertEqual(SERVER.load_editor_metadata(sample, quads)[0]["cornerVisibility"], metadata[0]["cornerVisibility"])
            self.assertEqual([item["occlusionOrder"] for item in saved["instances"]], [2, 1, 0])
            before = dict(sample)
            with self.assertRaisesRegex(ValueError, "cycle"):
                store.save(sample.id, {**payload, "occlusionRelations": relations + [{"above": 2, "below": 0}]})
            self.assertEqual(dict(sample), before)
            self.assertEqual(journal.call_count, 1)
        self.assertEqual(SERVER.load_editor_layers(sample, quads[:2]), [])

    def test_legacy_card_numbers_do_not_invent_layer_relations(self):
        sample = _Sample(manual_instances_json=json.dumps({"instances": [{"occlusionOrder": 0}, {"occlusionOrder": 1}]}))
        self.assertEqual(SERVER.load_editor_layers(sample, [[], []]), [])

    def test_drafts_include_distinct_cards_without_duplicate_attempts(self):
        from types import SimpleNamespace
        import sys
        sys.path.insert(0, str(SERVER_PATH.parent))
        a = [[.1,.1],[.4,.1],[.4,.8],[.1,.8]]
        b = [[.6,.1],[.9,.1],[.9,.8],[.6,.8]]
        lines = [SimpleNamespace(label=label, points=[quad]) for label,quad in
                 [("decisive",a),("attempt",a[2:]+a[:2]),("attempt",b)]]
        sample = _Sample(detection_quads=SimpleNamespace(polylines=lines))
        self.assertEqual(SERVER.detector_draft_quads(sample), [a,b])

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
