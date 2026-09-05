import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "tools/card-geometry/compositor/build_session_background_manifest.py"
SPEC = importlib.util.spec_from_file_location("build_session_background_manifest", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class BuildSessionBackgroundManifestTests(unittest.TestCase):
    def test_choose_crop_avoids_expanded_card_box(self):
        crop = MODULE.choose_crop(1000, 1000, [(0.3, 0.3, 0.7, 0.7)], "frame")
        self.assertIsNotNone(crop)
        normalized = tuple(value / 1000 for value in crop)
        self.assertEqual(MODULE.overlap_fraction(normalized, (0.3, 0.3, 0.7, 0.7)), 0)

    def test_builds_session_disjoint_background_pack(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            sessions = root / "sessions"
            sessions.mkdir()
            devmode = root / "devmode"
            devmode.mkdir()
            selected = {}
            index = 0
            while len(selected) < 2:
                session_id = f"scan-session-test-{index:03d}"
                selected.setdefault(MODULE.session_split(session_id), session_id)
                index += 1
            for split, session_id in selected.items():
                session = sessions / session_id
                session.mkdir()
                Image.new("RGB", (1000, 1000), (40, 50, 60)).save(session / "frame.jpg")
                evidence = [
                    {
                        "imageFile": "frame.jpg",
                        "imageMetadata": {"pixelWidth": 1000, "pixelHeight": 1000},
                        "attempts": [
                            {
                                "quad": [
                                    [0.35, 0.35],
                                    [0.65, 0.35],
                                    [0.65, 0.65],
                                    [0.35, 0.65],
                                ]
                            }
                        ],
                    }
                ]
                (session / "evidence.json").write_text(json.dumps(evidence), encoding="utf-8")
            release = root / "release.json"
            release.write_text(
                json.dumps({"evaluationSessionDenylist": ["scan-session-frozen"]}),
                encoding="utf-8",
            )
            document = MODULE.build_manifest(
                sessions_root=sessions,
                release_manifest=release,
                devmode_sessions_root=devmode,
                train_count=1,
                validation_count=1,
                max_per_session=1,
                output=root / "output",
            )
            self.assertEqual(len(document["assets"]), 2)
            self.assertEqual({row["split"] for row in document["assets"]}, {"train", "validation"})
            self.assertTrue(
                all(
                    row["provenance"]["sourceSessionId"] not in {"scan-session-frozen"}
                    for row in document["assets"]
                )
            )


if __name__ == "__main__":
    unittest.main()
