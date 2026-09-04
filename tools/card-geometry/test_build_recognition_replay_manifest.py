import json
import tempfile
import unittest
from pathlib import Path

from build_recognition_replay_manifest import build_manifest, record_id


class BuildRecognitionReplayManifestTests(unittest.TestCase):
    def test_maps_positive_and_wrong_archived_accepts_without_inventing_truth(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            release = root / "release"
            release.mkdir()
            keys = ["scan-session-a/frame-0.jpg", "scan-session-a/frame-1.jpg"]
            (release / "manifest.json").write_text(
                json.dumps(
                    {
                        "releaseId": "real-v1",
                        "corpusHash": "a" * 64,
                        "records": [{"recordId": record_id(key)} for key in keys],
                    }
                )
            )
            labels = root / "labels.json"
            labels.write_text(
                json.dumps(
                    [
                        {"key": keys[0], "fixed_quad_source": "manual", "verdict": "true"},
                        {"key": keys[1], "fixed_quad_source": "manual", "verdict": "false_margin"},
                    ]
                )
            )
            session = root / "sessions/scan-session-a"
            session.mkdir(parents=True)
            (session / "results.json").write_text(
                json.dumps(
                    {
                        "frames": [
                            {"imageFile": "frame-0.jpg", "mode": "pokemon", "identified": True, "bestMatchCardId": "a-1"},
                            {"imageFile": "frame-1.jpg", "mode": "pokemon", "identified": True, "bestMatchCardId": "wrong-2"},
                        ]
                    }
                )
            )
            document = build_manifest(
                label_backup=labels, sessions_root=root / "sessions", release_root=release
            )
            self.assertEqual(document["records"][0]["expectation"], "identify")
            self.assertEqual(document["records"][0]["expectedCardId"], "a-1")
            self.assertEqual(document["records"][1]["expectation"], "forbidden-accept")
            self.assertEqual(document["records"][1]["forbiddenCardId"], "wrong-2")


if __name__ == "__main__":
    unittest.main()
