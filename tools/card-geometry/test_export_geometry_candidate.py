import hashlib
import tempfile
import unittest
from pathlib import Path

from export_geometry_candidate import artifact, find_one, tree_sha256


class ExportGeometryCandidateTests(unittest.TestCase):
    def test_tree_hash_is_path_and_content_stable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = root / "model.mlpackage"
            package.mkdir()
            (package / "b").write_bytes(b"two")
            (package / "a").write_bytes(b"one")
            first = tree_sha256(package)
            self.assertEqual(first, tree_sha256(package))
            self.assertNotEqual(first, hashlib.sha256(b"onetwo").hexdigest())
            row = artifact(package, root)
            self.assertEqual(row["bytes"], 6)

    def test_find_one_prefers_best_checkpoint(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "last.pt").touch()
            (root / "best.pt").touch()
            self.assertEqual(find_one(root, ("*.pt",)).name, "best.pt")


if __name__ == "__main__":
    unittest.main()
