import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
HELPERS_PATH = (
    ROOT
    / "mobile-apps/ios/scripts/session-labeling/plugin/tcger-card-labeler/geometry_editor.py"
)
SPEC = importlib.util.spec_from_file_location("tcger_geometry_editor", HELPERS_PATH)
HELPERS = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(HELPERS)


class _Polyline:
    def __init__(self, points):
        self.points = [points]


class _Polylines:
    def __init__(self, lines):
        self.polylines = lines


class _Sample(dict):
    pass


class GeometryEditorHelpersTest(unittest.TestCase):
    def test_nearest_corner_selects_only_a_nearby_handle(self):
        quads = [
            [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]],
            [[0.6, 0.6], [0.9, 0.6], [0.9, 0.9], [0.6, 0.9]],
        ]
        self.assertEqual(HELPERS.nearest_corner(quads, 0.39, 0.41), (0, 2))
        self.assertIsNone(HELPERS.nearest_corner(quads, 0.5, 0.5))

    def test_accepts_ordered_quad_with_outside_frame_corner(self):
        quad = [[0.1, 0.1], [0.9, 0.1], [0.9, 1.08], [0.1, 1.08]]
        self.assertIsNone(HELPERS.quad_validation_error(quad))

    def test_rejects_crossed_and_out_of_margin_quads(self):
        crossed = [[0.1, 0.1], [0.9, 0.9], [0.9, 0.1], [0.1, 0.9]]
        self.assertIn("cross", HELPERS.quad_validation_error(crossed))
        outside_margin = [[0.1, 0.1], [1.3, 0.1], [0.9, 0.9], [0.1, 0.9]]
        self.assertIn("20%", HELPERS.quad_validation_error(outside_margin))

    def test_manual_quads_strips_only_duplicate_closing_point(self):
        closed = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
        sample = _Sample(
            manual_quad=_Polylines(
                [_Polyline(closed + [closed[0]]), _Polyline(closed[:3])]
            )
        )
        self.assertEqual(HELPERS.manual_quads(sample), [closed])

    def test_manual_quads_repairs_fiftyone_reverse_winding(self):
        canonical = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
        sample = _Sample(
            manual_quad=_Polylines([_Polyline(list(reversed(canonical)))])
        )
        self.assertEqual(HELPERS.manual_quads(sample), [canonical])

    def test_metadata_marks_amodal_corners_outside_frame(self):
        quad = [[0.1, 0.1], [0.9, 0.1], [0.9, 1.08], [0.1, 1.08]]
        metadata = HELPERS.default_geometry_metadata("frame-1", [quad])
        self.assertEqual(
            metadata[0]["cornerVisibility"],
            ["visible", "visible", "outsideFrame", "outsideFrame"],
        )

    def test_geometry_record_preserves_order_and_metadata(self):
        quad = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
        metadata = HELPERS.default_geometry_metadata("frame-1", [quad])
        metadata[0]["side"] = "faceDown"
        record = HELPERS.geometry_record(
            "frame-1", "pokémon", "binder_page", [quad], metadata
        )
        self.assertEqual(record["game"], "pokemon")
        self.assertEqual(record["instances"][0]["corners"], quad)
        self.assertEqual(record["instances"][0]["side"], "faceDown")


if __name__ == "__main__":
    unittest.main()
