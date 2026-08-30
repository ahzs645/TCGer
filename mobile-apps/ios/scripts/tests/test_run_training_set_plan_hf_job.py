from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "run_training_set_plan_hf_job.py"
SPEC = importlib.util.spec_from_file_location("plan_job", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


class TrainingSetPlanJobTests(unittest.TestCase):
    def test_cleanup_removes_only_ephemeral_snapshots(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary) / "tcger-plan-job"
            (work / "plan").mkdir(parents=True)
            (work / "source-library").mkdir()
            (work / "keep").mkdir()

            removed = MODULE.clean_download_workdir(work)

            self.assertEqual({path.name for path in removed}, {"plan", "source-library"})
            self.assertTrue((work / "keep").is_dir())

    def test_cleanup_rejects_filesystem_root(self) -> None:
        with self.assertRaisesRegex(MODULE.PlanRunError, "unsafe workdir"):
            MODULE.clean_download_workdir(Path("/"))

    def test_cleanup_rejects_repository_root(self) -> None:
        repository_root = SCRIPT.parents[3]
        with self.assertRaisesRegex(MODULE.PlanRunError, "unsafe workdir"):
            MODULE.clean_download_workdir(repository_root)

    def test_decodes_hub_only_paths_for_job_arguments(self) -> None:
        self.assertEqual(
            MODULE.decode_hub_path("hub:jobs/training/run.py"),
            "jobs/training/run.py",
        )
        self.assertEqual(MODULE.decode_hub_path("jobs/training/run.py"), "jobs/training/run.py")
        self.assertEqual(
            MODULE.decode_hub_path("hub64:am9icy90cmFpbmluZy9ydW4ucHk"),
            "jobs/training/run.py",
        )
        with self.assertRaisesRegex(MODULE.PlanRunError, "invalid encoded Hub path"):
            MODULE.decode_hub_path("hub:../run.py")

    def test_builds_virtual_pack_from_validated_plan_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plan_root = root / "plan"
            source_root = root / "source"
            plan_root.mkdir()
            (source_root / "shards").mkdir(parents=True)
            sample_id = "sample_one"
            source_row = {
                "sampleId": sample_id,
                "status": "valid",
                "game": "magic",
                "cardId": "printing",
                "sourceURL": "https://example.invalid/card.jpg",
                "visualIdentityId": "vi_one",
                "recognitionFamilyId": "magic:illustration:one",
                "blobSha256": "a" * 64,
                "bytes": 100,
                "width": 488,
                "height": 680,
                "shard": "shards/blobs-aa.tar",
                "member": "blobs/aa.jpg",
            }
            source_manifest = (canonical(source_row) + "\n").encode()
            (source_root / "manifest.jsonl").write_bytes(source_manifest)
            (source_root / "library.json").write_text(canonical({
                "manifestSHA256": hashlib.sha256(source_manifest).hexdigest(),
                "shardPrefixLength": 2,
                "sourceRevisions": {"magic": "source"},
            }), encoding="utf-8")
            planned = {
                "game": "magic",
                "sampleId": sample_id,
                "partition": "train",
                "usage": "training",
                "selectionReason": "newest-family-representative",
                "materialization": {
                    "status": "validated",
                    "blobSha256": "a" * 64,
                    "bytes": 100,
                    "shard": "shards/blobs-aa.tar",
                    "member": "blobs/aa.jpg",
                },
            }
            samples = (canonical(planned) + "\n").encode()
            (plan_root / "samples.jsonl").write_bytes(samples)
            (plan_root / "training-set-plan.json").write_text(canonical({
                "schema": "tcger-training-set-plan-v1",
                "files": {"samples": {
                    "path": "samples.jsonl",
                    "sha256": hashlib.sha256(samples).hexdigest(),
                }},
                "selectionPolicy": {"evaluationSamplesPerFamily": 2},
                "games": {"magic": {
                    "trainingReady": True,
                    "selectedSamples": 1,
                    "catalogRows": 2,
                }},
            }), encoding="utf-8")
            output = source_root
            result = MODULE.build_virtual_pack(
                plan_root=plan_root,
                source_root=source_root,
                output=output,
                game="magic",
                plan_repo="owner/images",
                plan_revision="b" * 40,
                plan_path="plans/v1",
            )
            self.assertEqual(result["trainingRows"], 1)
            self.assertEqual(result["evaluationRows"], 0)
            self.assertTrue((output / "shards").is_dir())
            self.assertFalse((output / "shards").is_symlink())
            row = json.loads((output / "manifest.jsonl").read_text())
            self.assertTrue(row["trainingEligible"])
            self.assertFalse(row["evaluationEligible"])
            contract = json.loads((output / "library.json").read_text())
            self.assertEqual(contract["selectionPolicy"]["selectedRows"], 1)

    def test_rejects_unready_game(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plan = root / "plan"
            source = root / "source"
            plan.mkdir()
            source.mkdir()
            samples = b""
            (plan / "samples.jsonl").write_bytes(samples)
            (plan / "training-set-plan.json").write_text(canonical({
                "schema": "tcger-training-set-plan-v1",
                "files": {"samples": {"path": "samples.jsonl", "sha256": hashlib.sha256(samples).hexdigest()}},
                "games": {"yugioh": {"trainingReady": False}},
            }), encoding="utf-8")
            with self.assertRaisesRegex(MODULE.PlanRunError, "not training-ready"):
                MODULE.build_virtual_pack(
                    plan_root=plan, source_root=source, output=root / "out",
                    game="yugioh", plan_repo="owner/images",
                    plan_revision="c" * 40, plan_path="plans/v1",
                )


if __name__ == "__main__":
    unittest.main()
