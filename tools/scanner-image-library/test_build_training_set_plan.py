from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("build_training_set_plan.py")


class TrainingSetPlanTests(unittest.TestCase):
    def run_cli(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True)

    def test_selects_before_materialization_and_keeps_families_disjoint(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            catalog = root / "catalog.json"
            catalog.write_text(json.dumps([
                {
                    "game": "magic", "cardId": "old", "exactPrintingId": "old",
                    "visualIdentityId": "magic:printing:old:front",
                    "recognitionFamilyId": "magic:illustration:same",
                    "releaseDate": "2000-01-01", "imageURL": "https://example.invalid/old.jpg?one",
                },
                {
                    "game": "magic", "cardId": "new", "exactPrintingId": "new",
                    "visualIdentityId": "magic:printing:new:front",
                    "recognitionFamilyId": "magic:illustration:same",
                    "releaseDate": "2026-01-01", "imageURL": "https://example.invalid/new.jpg?two",
                },
                {
                    "game": "future-game", "cardId": "f1",
                    "recognitionFamilyId": "future:art:one",
                    "imageURL": "https://example.invalid/future.jpg",
                },
            ]), encoding="utf-8")
            output = root / "plan"
            result = self.run_cli("--catalog", str(catalog), "--output", str(output))
            self.assertEqual(result.returncode, 0, result.stdout)
            samples = [json.loads(line) for line in (output / "samples.jsonl").read_text().splitlines()]
            magic = [row for row in samples if row["game"] == "magic"]
            self.assertEqual([row["cardId"] for row in magic], ["new"])
            self.assertEqual(magic[0]["materialization"]["status"], "needed")
            families = [json.loads(line) for line in (output / "families.jsonl").read_text().splitlines()]
            self.assertEqual(len([row for row in families if row["game"] == "magic"]), 1)
            contract = json.loads((output / "training-set-plan.json").read_text())
            self.assertIn("future-game", contract["games"])
            self.assertEqual(contract["games"]["magic"]["catalogRows"], 2)

    def test_attaches_validated_blob_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            row = {
                "game": "pokemon", "cardId": "p1", "visualIdentityId": "pokemon:p1",
                "recognitionFamilyId": "pokemon:family:p1",
                "imageURL": "https://example.invalid/p1.jpg",
            }
            catalog = root / "catalog.json"
            catalog.write_text(json.dumps([row]), encoding="utf-8")
            locator = "https://example.invalid/p1.jpg"
            import hashlib
            identity_key = "pokemon:p1:pokemon:p1"
            visual_id = "vi_" + hashlib.sha256(identity_key.encode()).hexdigest()[:32]
            sample_id = "sample_" + hashlib.sha256(
                "\0".join((visual_id, "catalog", locator)).encode()
            ).hexdigest()[:32]
            manifest = root / "manifest.jsonl"
            manifest.write_text(json.dumps({
                "sampleId": sample_id, "status": "valid", "blobSha256": "a" * 64,
                "bytes": 123, "shard": "shards/a.tar", "member": "blobs/a.jpg",
            }) + "\n", encoding="utf-8")
            output = root / "plan"
            result = self.run_cli(
                "--catalog", str(catalog), "--output", str(output),
                "--validated-manifest", f"pokemon={manifest}",
                "--validated-repo", "pokemon=owner/images",
                "--validated-revision", "pokemon=abc123",
                "--validated-path", "pokemon=releases/pokemon/v1",
            )
            self.assertEqual(result.returncode, 0, result.stdout)
            sample = json.loads((output / "samples.jsonl").read_text())
            self.assertEqual(sample["materialization"]["status"], "validated")
            self.assertEqual(sample["materialization"]["blobSha256"], "a" * 64)
            contract = json.loads((output / "training-set-plan.json").read_text())
            self.assertTrue(contract["games"]["pokemon"]["trainingReady"])

    def test_rejects_pokemon_pocket(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            catalog = root / "catalog.json"
            catalog.write_text(json.dumps([{
                "game": "pokemon", "cardId": "pocket", "format": "pocket",
                "imageURL": "https://example.invalid/tcgp/pocket.jpg",
            }]), encoding="utf-8")
            result = self.run_cli("--catalog", str(catalog), "--output", str(root / "plan"))
            self.assertEqual(result.returncode, 2)
            self.assertIn("Pocket", result.stdout)


if __name__ == "__main__":
    unittest.main()
