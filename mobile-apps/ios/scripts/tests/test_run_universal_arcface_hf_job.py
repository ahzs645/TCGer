from __future__ import annotations

import importlib.util
import tempfile
from pathlib import Path
import unittest


SCRIPT_PATH = Path(__file__).parents[1] / "run_universal_arcface_hf_job.py"
SPEC = importlib.util.spec_from_file_location("run_universal_arcface_hf_job", SCRIPT_PATH)
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class UniversalArcFaceJobCleanupTests(unittest.TestCase):
    def test_hub_upload_replaces_only_the_scoped_export_prefix(self):
        source = SCRIPT_PATH.read_text(encoding="utf-8")
        final_upload = source[source.rindex("api.upload_folder("):]
        self.assertIn('path_in_repo=export_prefix', final_upload)
        self.assertIn('delete_patterns="*"', final_upload)

    def test_cleanup_rejects_repository_root(self):
        with self.assertRaisesRegex(ValueError, "unsafe workdir"):
            runner.clean_generated_workdir(SCRIPT_PATH.parents[3])

    def test_cleanup_resets_generated_children_and_keeps_image_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary) / "tcger-universal-job"
            for name in ("source", "normalized", "outputs", "hub"):
                (work / name).mkdir(parents=True)
            cache = work / "card-images"
            cache.mkdir()
            (cache / "validated.img").write_text("keep")

            removed = runner.clean_generated_workdir(work)

            self.assertEqual(
                {path.name for path in removed},
                {"source", "normalized", "outputs", "hub"},
            )
            self.assertEqual((cache / "validated.img").read_text(), "keep")

    def test_cleanup_refuses_to_remove_a_protected_mounted_input(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary) / "tcger-universal-job"
            protected = work / "source" / "prepared-pack"
            protected.mkdir(parents=True)

            with self.assertRaisesRegex(ValueError, "protected input"):
                runner.clean_generated_workdir(work, [protected])

            self.assertTrue(protected.is_dir())

    def test_cleanup_unlinks_symlink_without_removing_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            work = root / "tcger-universal-job"
            work.mkdir()
            external = root / "external"
            external.mkdir()
            (external / "keep.txt").write_text("keep")
            (work / "outputs").symlink_to(external, target_is_directory=True)

            runner.clean_generated_workdir(work)

            self.assertEqual((external / "keep.txt").read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
