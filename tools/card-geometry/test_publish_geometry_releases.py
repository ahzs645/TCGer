import json
import tempfile
import unittest
from pathlib import Path

from publish_geometry_releases import stage_release


class PublishGeometryReleasesTests(unittest.TestCase):
    def test_stages_release_under_exact_remote_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            release = root / "release"
            (release / "records").mkdir(parents=True)
            (release / "manifest.json").write_text(json.dumps({"corpusHash": "a" * 64}))
            (release / "records/one.json").write_text("{}")
            staging = root / "staging"
            count = stage_release(release, staging, "geometry/releases/example")
            self.assertEqual(count, 2)
            self.assertTrue((staging / "geometry/releases/example/manifest.json").is_file())
            self.assertEqual((staging / "geometry/releases/example/records/one.json").read_text(), "{}")

    def test_rejects_parent_traversal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            release = root / "release"
            release.mkdir()
            (release / "manifest.json").write_text("{}")
            with self.assertRaises(ValueError):
                stage_release(release, root / "staging", "../outside")


if __name__ == "__main__":
    unittest.main()
