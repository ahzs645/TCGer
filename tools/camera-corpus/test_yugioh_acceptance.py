import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from yugioh_acceptance import validate_manifest


class YugiohAcceptanceManifestTests(unittest.TestCase):
    def write_manifest(self, root: Path, frames: list[dict]) -> Path:
        path = root / "manifest.json"
        path.write_text(json.dumps({"kind": "tcger-yugioh-acceptance-v1", "frames": frames}))
        return path

    def test_validates_all_slices_and_emits_reject_without_fake_label(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("single.jpg", "steep.jpg", "field.jpg"):
                (root / name).write_bytes(b"fixture")
            manifest = self.write_manifest(
                root,
                [
                    {"key": "single", "path": "single.jpg", "slice": "single_handheld", "face": "face_up", "expected": "identify", "label": "89631139"},
                    {"key": "steep", "path": "steep.jpg", "slice": "steep_playmat", "face": "partial", "expected": "identify", "label": "46986414", "deckExternalIds": ["46986414", "89631139"]},
                    {"key": "back", "path": "field.jpg", "slice": "duel_field", "face": "face_down", "expected": "reject", "targetQuad": [[10, 10], [50, 10], [50, 70], [10, 70]]},
                ],
            )

            frames, summary = validate_manifest(manifest)

            self.assertEqual(summary["frames"], 3)
            self.assertEqual(summary["expectations"], {"identify": 2, "reject": 1})
            self.assertIsNone(frames[2]["label"])
            self.assertEqual(frames[1]["deckExternalIds"], ["46986414", "89631139"])
            self.assertTrue(Path(frames[0]["path"]).is_absolute())

    def test_rejects_face_down_identity_claim(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "field.jpg").write_bytes(b"fixture")
            manifest = self.write_manifest(
                root,
                [{"key": "bad", "path": "field.jpg", "slice": "duel_field", "face": "face_down", "expected": "identify", "label": "89631139", "targetQuad": [[0, 0], [2, 0], [2, 3], [0, 3]]}],
            )

            with self.assertRaisesRegex(ValueError, "face-down"):
                validate_manifest(manifest, minimum_per_slice=0)

    def test_requires_every_acceptance_slice(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "single.jpg").write_bytes(b"fixture")
            manifest = self.write_manifest(
                root,
                [{"key": "single", "path": "single.jpg", "slice": "single_handheld", "face": "face_up", "expected": "identify", "label": "89631139"}],
            )

            with self.assertRaisesRegex(ValueError, "missing: duel_field, steep_playmat"):
                validate_manifest(manifest)

    def test_requires_target_quad_for_each_duel_field_instance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "field.jpg").write_bytes(b"fixture")
            manifest = self.write_manifest(
                root,
                [{"key": "field-card", "path": "field.jpg", "slice": "duel_field", "face": "face_up", "expected": "identify", "label": "89631139"}],
            )

            with self.assertRaisesRegex(ValueError, "targetQuad"):
                validate_manifest(manifest, minimum_per_slice=0)


if __name__ == "__main__":
    unittest.main()
