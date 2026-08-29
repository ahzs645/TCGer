from __future__ import annotations

import ast
from pathlib import Path
import unittest


SCRIPT = Path(__file__).parents[1] / "prepare_and_launch_two_stage_hf_job.py"


class PrepareAndLaunchTwoStageJobTests(unittest.TestCase):
    def test_gpu_child_receives_mounted_local_pack_and_trainer(self) -> None:
        tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
        source = ast.unparse(tree)

        self.assertIn("'--prepared-image-library-root', '/inputs/image-library'", source)
        self.assertIn("'--trainer-script', '/inputs/code/train_arcface_encoder.py'", source)
        self.assertIn("f'{release}:/inputs/image-library:ro'", source)
        self.assertNotIn("'--image-library-repo'", source)


if __name__ == "__main__":
    unittest.main()
