from __future__ import annotations

import importlib.util
import io
import json
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock
from pathlib import Path

from PIL import Image


SCRIPT = Path(__file__).with_name("sync_training_image_library.py")
SPEC = importlib.util.spec_from_file_location("scanner_image_library", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def image_bytes(color: tuple[int, int, int], image_format: str = "PNG") -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (80, 112), color).save(output, format=image_format)
    return output.getvalue()


class ImageLibraryTests(unittest.TestCase):
    def run_cli(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), *arguments],
            capture_output=True,
            text=True,
            check=False,
        )

    def write_catalog(self, root: Path, rows: list[dict], name: str = "catalog.json") -> Path:
        path = root / name
        path.write_text(json.dumps(rows), encoding="utf-8")
        return path

    def test_sync_is_deterministic_and_auditable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = root / "card.png"
            image.write_bytes(image_bytes((10, 20, 30)))
            catalog = self.write_catalog(root, [{
                "annIndex": 999,
                "game": "pokemon",
                "cardId": "base-1",
                "name": "Test card",
                "imagePath": image.name,
                "provenance": {"provider": "test", "license": "test-only"},
            }])
            cache = root / "cache"
            first, second = root / "release-a", root / "release-b"
            for output in (first, second):
                result = self.run_cli(
                    "sync", "--catalog", str(catalog), "--output", str(output),
                    "--blob-cache", str(cache), "--source-revision", "pokemon=test-revision",
                )
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((first / "manifest.jsonl").read_bytes(), (second / "manifest.jsonl").read_bytes())
            manifest_row = json.loads((first / "manifest.jsonl").read_text())
            self.assertRegex(manifest_row["blobSha256"], r"^[0-9a-f]{64}$")
            self.assertEqual(manifest_row["provenance"]["sourceCatalogRevision"], "test-revision")
            first_tar = next((first / "shards").glob("*.tar"))
            second_tar = second / "shards" / first_tar.name
            self.assertEqual(first_tar.read_bytes(), second_tar.read_bytes())
            audit = self.run_cli("audit", "--root", str(first))
            self.assertEqual(audit.returncode, 0, audit.stderr)
            self.assertEqual(json.loads(audit.stdout)["status"], "valid")

    def test_incremental_diff_and_previous_shard_reuse_are_network_free(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = root / "card.webp"
            image.write_bytes(image_bytes((100, 0, 0), "WEBP"))
            rows = [{"game": "yugioh", "cardId": "123", "name": "One", "imagePath": image.name}]
            catalog = self.write_catalog(root, rows)
            first = root / "release-a"
            cache = root / "cache-a"
            result = self.run_cli("sync", "--catalog", str(catalog), "--output", str(first), "--blob-cache", str(cache))
            self.assertEqual(result.returncode, 0, result.stderr)
            image.unlink()
            second = root / "release-b"
            result = self.run_cli(
                "sync", "--catalog", str(catalog), "--output", str(second),
                "--blob-cache", str(root / "empty-cache"),
                "--previous-manifest", str(first / "manifest.jsonl"),
                "--previous-root", str(first),
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            diff = json.loads((second / "diff.json").read_text())
            self.assertEqual(diff["counts"]["unchanged"], 1)
            self.assertEqual(diff["counts"]["added"], 0)
            distribution = json.loads((second / "distribution-plan.json").read_text())
            self.assertFalse(distribution["games"]["yugioh"]["scannerIndexUpdateRequired"])
            self.assertEqual(distribution["games"]["yugioh"]["actions"], [])

    def test_distribution_plan_routes_trained_and_future_games(self) -> None:
        previous = {
            "old": {"sampleId": "old", "game": "pokemon"},
            "future-old": {"sampleId": "future-old", "game": "futuregame"},
        }
        current = [
            {"sampleId": "new", "game": "pokemon"},
            {"sampleId": "future-new", "game": "futuregame"},
        ]
        diff = {
            "added": ["new", "future-new"],
            "removed": ["old", "future-old"],
            "contentChanged": [],
            "metadataChanged": [],
        }
        plan = MODULE.distribution_update_plan(current, previous, diff, {"pokemon"})
        pokemon = plan["games"]["pokemon"]
        self.assertEqual(pokemon["targets"], ["ios", "android", "web"])
        self.assertIn("rebuild-card-catalog", pokemon["actions"])
        self.assertIn("publish-web-scan-index", pokemon["actions"])
        future = plan["games"]["futuregame"]
        self.assertTrue(future["modelRetrainingRequired"])
        self.assertEqual(future["actions"][-1], "train-and-evaluate-scanner-model")
        self.assertEqual(future["targets"], [])

    def test_source_plan_and_ledger_are_pinned_inside_release(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = root / "card.png"
            image.write_bytes(image_bytes((20, 40, 60)))
            catalog = self.write_catalog(root, [{"game": "pokemon", "cardId": "1", "imagePath": image.name}])
            ledger = root / "input-ledger.json"
            plan = root / "input-plan.json"
            ledger.write_text(json.dumps({"schemaVersion": 1, "games": {
                "pokemon": {"revision": "one"}, "magic": {"revision": "not-materialized"},
            }}), encoding="utf-8")
            plan.write_text(json.dumps({"schemaVersion": 1, "games": {"pokemon": {"actions": []}}}), encoding="utf-8")
            release = root / "release"
            result = self.run_cli(
                "sync", "--catalog", str(catalog), "--output", str(release),
                "--blob-cache", str(root / "cache"),
                "--source-ledger", str(ledger), "--source-plan", str(plan),
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            contract = json.loads((release / "library.json").read_text())
            self.assertEqual(set(contract["sourcePlanning"]), {"ledger", "plan"})
            self.assertEqual(contract["sourceRevisions"]["pokemon"], "one")
            self.assertNotIn("magic", contract["sourceRevisions"])
            self.assertTrue((release / "source-ledger.json").is_file())
            audit = self.run_cli("audit", "--root", str(release))
            self.assertEqual(audit.returncode, 0, audit.stderr)
            (release / "source-plan.json").write_text("{}\n", encoding="utf-8")
            audit = self.run_cli("audit", "--root", str(release))
            self.assertEqual(audit.returncode, 2)
            self.assertIn("source planning SHA256 mismatch: plan", json.loads(audit.stdout)["errors"])

    def test_corrupt_image_fails_closed_but_writes_coverage(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bad = root / "bad.jpg"
            bad.write_bytes(b"not an image")
            catalog = self.write_catalog(root, [{"game": "magic", "cardId": "x", "imagePath": bad.name}])
            output = root / "release"
            result = self.run_cli("sync", "--catalog", str(catalog), "--output", str(output), "--blob-cache", str(root / "cache"))
            self.assertEqual(result.returncode, 2)
            stdout = json.loads(result.stdout)
            self.assertEqual(stdout["status"], "blocked")
            self.assertEqual(stdout["counts"]["invalid"], 1)
            self.assertNotIn("invalidSamples", stdout)
            self.assertLess(len(result.stdout), 2_000)
            coverage = json.loads((output / "coverage.json").read_text())
            self.assertEqual(coverage["status"], "blocked")
            self.assertEqual(coverage["counts"]["invalid"], 1)

    def test_all_samples_of_identity_share_partition_and_captures_quarantine(self) -> None:
        visual_id = "vi_test"
        self.assertEqual(MODULE.split_for(visual_id), MODULE.split_for(visual_id))
        row = {"visualIdentityId": visual_id}
        train, evaluate, reason, partition = MODULE.eligibility("capture", row, True)
        self.assertFalse(train)
        self.assertFalse(evaluate)
        self.assertEqual(partition, "quarantine")
        row["captureReview"] = {"consent": True, "labelVerified": True, "reviewer": "human"}
        train, evaluate, reason, partition = MODULE.eligibility("capture", row, True)
        self.assertFalse(train)
        self.assertTrue(evaluate)
        self.assertEqual(partition, "camera-evaluation")

    def test_reprints_keep_distinct_visual_rows_but_share_family_partition(self) -> None:
        first = {
            "game": "magic",
            "cardId": "printing-a",
            "visualIdentityId": "magic:printing:printing-a:front",
            "recognitionFamilyId": "magic:illustration:shared-art",
        }
        second = {
            "game": "magic",
            "cardId": "printing-b",
            "visualIdentityId": "magic:printing:printing-b:front",
            "recognitionFamilyId": "magic:illustration:shared-art",
        }
        first_key, first_visual = MODULE.identity_for(first, "https://example.invalid/a.jpg")
        second_key, second_visual = MODULE.identity_for(second, "https://example.invalid/b.jpg")
        self.assertNotEqual(first_key, second_key)
        self.assertNotEqual(first_visual, second_visual)
        first_family = MODULE.recognition_family_for(first, first_visual)
        second_family = MODULE.recognition_family_for(second, second_visual)
        self.assertEqual(first_family, second_family)
        self.assertEqual(MODULE.split_for(first_family), MODULE.split_for(second_family))

    def test_family_cap_selects_before_fetch_and_keeps_catalog_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            newest = root / "newest.png"
            newest.write_bytes(image_bytes((5, 10, 15)))
            catalog = self.write_catalog(root, [
                {
                    "game": "magic",
                    "cardId": "old-print",
                    "recognitionFamilyId": "magic:illustration:one",
                    "releaseDate": "1999-01-01",
                    "imagePath": "does-not-exist.png",
                },
                {
                    "game": "magic",
                    "cardId": "new-print",
                    "recognitionFamilyId": "magic:illustration:one",
                    "releaseDate": "2026-01-01",
                    "imagePath": newest.name,
                },
            ])
            release = root / "release"
            result = self.run_cli(
                "sync", "--catalog", str(catalog), "--output", str(release),
                "--blob-cache", str(root / "cache"),
                "--training-samples-per-family", "1",
                "--evaluation-samples-per-family", "1",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            rows = [json.loads(line) for line in (release / "manifest.jsonl").read_text().splitlines()]
            self.assertEqual(len(rows), 2)
            selected = [row for row in rows if row["selectedForPack"]]
            skipped = [row for row in rows if not row["selectedForPack"]]
            self.assertEqual([row["cardId"] for row in selected], ["new-print"])
            self.assertEqual(skipped[0]["status"], "not-selected")
            coverage = json.loads((release / "coverage.json").read_text())
            self.assertEqual(coverage["counts"]["catalogRows"], 2)
            self.assertEqual(coverage["counts"]["selected"], 1)
            self.assertEqual(coverage["counts"]["skipped"], 1)
            contract = json.loads((release / "library.json").read_text())
            self.assertEqual(contract["selectionPolicy"]["mode"], "recognition-family-cap-v1")

    def test_repack_streams_selected_blobs_from_validated_release(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            old_image = root / "old.png"
            new_image = root / "new.png"
            old_image.write_bytes(image_bytes((10, 20, 30)))
            new_image.write_bytes(image_bytes((40, 50, 60)))
            rows = [
                {
                    "game": "magic",
                    "cardId": "old-print",
                    "visualIdentityId": "magic:printing:old-print:front",
                    "recognitionFamilyId": "magic:illustration:shared",
                    "releaseDate": "2000-01-01",
                    "imagePath": old_image.name,
                },
                {
                    "game": "magic",
                    "cardId": "new-print",
                    "visualIdentityId": "magic:printing:new-print:front",
                    "recognitionFamilyId": "magic:illustration:shared",
                    "releaseDate": "2026-01-01",
                    "imagePath": new_image.name,
                },
            ]
            catalog = self.write_catalog(root, rows)
            source = root / "source-release"
            result = self.run_cli(
                "sync", "--catalog", str(catalog), "--output", str(source),
                "--blob-cache", str(root / "cache"),
                "--training-samples-per-family", "2",
                "--evaluation-samples-per-family", "2",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            old_image.unlink()
            new_image.unlink()

            output = root / "bounded-release"
            result = self.run_cli(
                "repack", "--catalog", str(catalog), "--output", str(output),
                "--source-manifest", str(source / "manifest.jsonl"),
                "--source-root", str(source),
                "--training-samples-per-family", "1",
                "--evaluation-samples-per-family", "1",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            summary = json.loads(result.stdout.splitlines()[-1])
            self.assertEqual(summary["networkImageFetches"], 0)
            self.assertEqual(summary["selectedRows"], 1)
            manifest = [
                json.loads(line)
                for line in (output / "manifest.jsonl").read_text().splitlines()
            ]
            selected = [row for row in manifest if row["selectedForPack"]]
            self.assertEqual([row["cardId"] for row in selected], ["new-print"])
            self.assertEqual(selected[0]["releaseDate"], "2026-01-01")
            self.assertEqual(
                json.loads((output / "library.json").read_text())
                ["reusedValidatedRelease"]["networkImageFetches"],
                0,
            )
            audit = self.run_cli("audit", "--root", str(output))
            self.assertEqual(audit.returncode, 0, audit.stderr)

    def test_pokemon_pocket_rows_are_rejected_before_download(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            catalog = self.write_catalog(root, [{
                "game": "pokemon",
                "cardId": "A1-001",
                "imageURL": "https://assets.tcgdex.net/en/tcgp/A1/001/high.webp",
            }])
            result = self.run_cli(
                "sync", "--catalog", str(catalog),
                "--output", str(root / "release"),
                "--blob-cache", str(root / "cache"),
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("TCG Pocket", result.stderr)

    def test_audit_detects_tampered_blob(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = root / "card.png"
            image.write_bytes(image_bytes((1, 2, 3)))
            catalog = self.write_catalog(root, [{"game": "pokemon", "cardId": "1", "imagePath": image.name}])
            release = root / "release"
            result = self.run_cli("sync", "--catalog", str(catalog), "--output", str(release), "--blob-cache", str(root / "cache"))
            self.assertEqual(result.returncode, 0, result.stderr)
            shard = next((release / "shards").glob("*.tar"))
            with tarfile.open(shard, "w") as archive:
                info = tarfile.TarInfo("wrong")
                info.size = 3
                archive.addfile(info, io.BytesIO(b"bad"))
            audit = self.run_cli("audit", "--root", str(release))
            self.assertEqual(audit.returncode, 2)
            self.assertEqual(json.loads(audit.stdout)["status"], "invalid")

    def test_upload_uses_release_path_and_returns_pinned_revision(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "coverage.json").write_text('{"status":"ready"}', encoding="utf-8")
            completed_upload = subprocess.CompletedProcess([], 0, "", "")
            completed_info = subprocess.CompletedProcess([], 0, '{"sha":"abc123"}', "")
            with (
                mock.patch.object(MODULE, "audit_library", return_value={"status": "valid"}),
                mock.patch.object(MODULE.subprocess, "run", side_effect=[completed_upload, completed_info]) as run,
            ):
                response = MODULE.upload_library(root, "owner/private-images", "main", "release")
            self.assertEqual(run.call_args_list[0].args[0][4], "release")
            self.assertEqual(response["pathInRepo"], "release")
            self.assertEqual(response["pinnedRevision"], "abc123")


if __name__ == "__main__":
    unittest.main()
