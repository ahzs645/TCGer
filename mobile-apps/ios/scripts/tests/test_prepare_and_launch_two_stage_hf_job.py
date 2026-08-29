from __future__ import annotations

import ast
from pathlib import Path
import unittest


SCRIPT = Path(__file__).parents[1] / "prepare_and_launch_two_stage_hf_job.py"


class PrepareAndLaunchTwoStageJobTests(unittest.TestCase):
    def test_gpu_child_receives_existing_local_trainer_attachment(self) -> None:
        tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
        source = ast.unparse(tree)

        self.assertIn("trainer_script = model_file(trainer_repo_path)", source)
        self.assertIn("'--trainer-script', str(trainer_script)", source)
        self.assertNotIn("'--trainer-hub-path-in-repo', trainer_repo_path", source)


if __name__ == "__main__":
    unittest.main()
