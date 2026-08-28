import copy
import hashlib
import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image, UnidentifiedImageError


SCRIPT_PATH = Path(__file__).parents[1] / "train_arcface_encoder.py"
SPEC = importlib.util.spec_from_file_location("train_arcface_encoder", SCRIPT_PATH)
trainer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(trainer)


def image_bytes(color):
    output = io.BytesIO()
    Image.new("RGB", (7, 11), color).save(output, format="PNG")
    return output.getvalue()


def entry(card_id, url, ann_index=0):
    return {
        "annIndex": ann_index,
        "cardId": card_id,
        "name": card_id,
        "game": "yugioh",
        "imageURL": url,
    }


class ArcFaceImageLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.cache = self.root / "cache"
        self.report = self.root / "coverage.json"
        self.statuses = []

    def tearDown(self):
        self.temporary.cleanup()

    def status_writer(self, **payload):
        self.statuses.append(payload)

    def test_recognition_families_share_training_label_and_partitions_are_held_out(self):
        rows = [
            dict(entry("print-a", "https://images.invalid/a.png", 0), recognitionFamilyId="art-shared"),
            dict(entry("print-b", "https://images.invalid/b.png", 1), recognitionFamilyId="art-shared"),
            dict(entry("held-out", "https://images.invalid/c.png", 2), recognitionFamilyId="art-held"),
        ]

        class Library:
            def record_for(self, row):
                return {
                    "trainingEligible": True,
                    "evaluationEligible": True,
                    "partition": "test" if row["cardId"] == "held-out" else "train",
                }

        training, held_out = trainer.partition_indices(rows, Library())
        self.assertEqual(training, [0, 1])
        self.assertEqual(held_out, [2])
        self.assertEqual(trainer.recognition_family(rows[0]), trainer.recognition_family(rows[1]))

    def test_training_rejects_pokemon_pocket_catalog(self):
        path = self.root / "pokemon.json"
        path.write_text(json.dumps([{
            "annIndex": 0,
            "cardId": "A1-001",
            "name": "Pocket card",
            "game": "pokemon",
            "imageURL": "https://assets.tcgdex.net/en/tcgp/A1/001/high.webp",
        }]))
        with self.assertRaisesRegex(ValueError, "TCG Pocket"):
            trainer.load_entries([path])

    def test_cache_mapping_survives_catalog_reordering(self):
        rows = [
            entry("red-card", "https://images.invalid/red.png", 0),
            entry("blue-card", "https://images.invalid/blue.png", 1),
        ]
        payloads = {
            rows[0]["imageURL"]: image_bytes("red"),
            rows[1]["imageURL"]: image_bytes("blue"),
        }

        def response(request, timeout):
            self.assertEqual(timeout, 30)
            return io.BytesIO(payloads[request.full_url])

        with mock.patch.object(trainer.urllib.request, "urlopen", side_effect=response):
            valid, first = trainer.materialize_images(
                rows,
                workers=2,
                cache_dir=self.cache,
                coverage_path=self.report,
                status_writer=self.status_writer,
            )
        self.assertEqual(valid, [0, 1])
        hashes_by_card = {
            record["cardId"]: record["sha256"] for record in first["entries"]
        }

        reordered = [dict(rows[1], annIndex=0), dict(rows[0], annIndex=1)]
        with mock.patch.object(
            trainer.urllib.request,
            "urlopen",
            side_effect=AssertionError("validated cache should avoid a download"),
        ):
            valid, second = trainer.materialize_images(
                reordered,
                workers=2,
                cache_dir=self.cache,
                coverage_path=self.report,
                status_writer=self.status_writer,
            )
        self.assertEqual(valid, [0, 1])
        self.assertEqual(
            hashes_by_card,
            {record["cardId"]: record["sha256"] for record in second["entries"]},
        )
        self.assertNotEqual(
            trainer.cached_path(rows[0], self.cache),
            trainer.cached_path(rows[1], self.cache),
        )

    def test_validation_fully_decodes_and_hashes_image(self):
        path = self.root / "valid.png"
        content = image_bytes("green")
        path.write_bytes(content)
        facts = trainer.validate_image(path)
        self.assertEqual(facts["sha256"], hashlib.sha256(content).hexdigest())
        self.assertEqual(facts["bytes"], len(content))
        self.assertEqual((facts["width"], facts["height"]), (7, 11))
        self.assertEqual(facts["format"], "png")

        corrupt = self.root / "corrupt.img"
        corrupt.write_bytes(b"not an image")
        with self.assertRaises((UnidentifiedImageError, OSError)):
            trainer.validate_image(corrupt)

    def test_default_coverage_fails_closed_and_writes_report(self):
        rows = [entry("missing-card", None)]
        with self.assertRaises(trainer.ImageCoverageError):
            trainer.materialize_images(
                rows,
                workers=1,
                cache_dir=self.cache,
                coverage_path=self.report,
                status_writer=self.status_writer,
            )
        payload = json.loads(self.report.read_text())
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["valid"], 0)
        self.assertEqual(payload["missing"], 1)
        self.assertEqual(payload["entries"][0]["status"], "missing")
        self.assertEqual(payload["entries"][0]["exportAnnIndex"], None)

    def test_quarantine_compacts_metadata_and_manifest_is_deterministic(self):
        rows = [
            entry("available", "https://images.invalid/available.png", 0),
            entry("missing", None, 1),
        ]
        with mock.patch.object(
            trainer.urllib.request,
            "urlopen",
            return_value=io.BytesIO(image_bytes("purple")),
        ):
            valid, report = trainer.materialize_images(
                rows,
                workers=1,
                cache_dir=self.cache,
                coverage_path=self.report,
                allow_quarantine=True,
                status_writer=self.status_writer,
            )
        compacted = trainer.compact_entries(rows, valid)
        self.assertEqual(valid, [0])
        self.assertEqual([row["cardId"] for row in compacted], ["available"])
        self.assertEqual([row["annIndex"] for row in compacted], [0])
        self.assertEqual(report["quarantined"], 1)
        self.assertEqual(
            [item["exportAnnIndex"] for item in report["entries"]],
            [0, None],
        )

        rebuilt = trainer.build_coverage_report(
            rows,
            copy.deepcopy(report["entries"]),
            allow_quarantine=True,
        )
        self.assertEqual(trainer.canonical_json(report), trainer.canonical_json(rebuilt))

    def test_sidecar_tampering_forces_a_validated_redownload(self):
        row = entry("tamper", "https://images.invalid/tamper.png")
        original = image_bytes("orange")
        replacement = image_bytes("yellow")
        with mock.patch.object(
            trainer.urllib.request,
            "urlopen",
            return_value=io.BytesIO(original),
        ):
            trainer.materialize_images(
                [row],
                workers=1,
                cache_dir=self.cache,
                coverage_path=self.report,
                status_writer=self.status_writer,
            )
        image_path = trainer.cached_path(row, self.cache)
        sidecar_path = trainer.cache_sidecar_path(image_path)
        sidecar = json.loads(sidecar_path.read_text())
        sidecar["cardId"] = "wrong-identity"
        sidecar_path.write_text(json.dumps(sidecar))

        with mock.patch.object(
            trainer.urllib.request,
            "urlopen",
            return_value=io.BytesIO(replacement),
        ) as download:
            _, report = trainer.materialize_images(
                [row],
                workers=1,
                cache_dir=self.cache,
                coverage_path=self.report,
                status_writer=self.status_writer,
            )
        download.assert_called_once()
        self.assertEqual(
            report["entries"][0]["sha256"],
            hashlib.sha256(replacement).hexdigest(),
        )
        self.assertFalse(any(image_path.parent.glob("*.part")))

    def test_pinned_durable_library_supplies_verified_bytes_without_network(self):
        row = entry("library-card", "https://images.invalid/library.png")
        content = image_bytes("navy")
        blob_sha = hashlib.sha256(content).hexdigest()
        shard_relative = f"shards/blobs-{blob_sha[:2]}.tar"
        member = f"blobs/{blob_sha}.png"
        shard = self.root / shard_relative
        shard.parent.mkdir(parents=True)
        blob_file = self.root / "blob.png"
        blob_file.write_bytes(content)
        with tarfile.open(shard, "w") as archive:
            archive.add(blob_file, arcname=member)
        manifest_row = {
            "schemaVersion": "tcger-scanner-image-library-v1",
            "sampleId": "sample-1",
            "visualIdentityId": "vi_library",
            "visualIdentityKey": "yugioh:library-card",
            "game": "yugioh",
            "cardId": "library-card",
            "sourceURL": row["imageURL"],
            "status": "valid",
            "blobSha256": blob_sha,
            "bytes": len(content),
            "width": 7,
            "height": 11,
            "shard": shard_relative,
            "member": member,
            "trainingEligible": True,
            "partition": "train",
        }
        manifest_bytes = (
            json.dumps(manifest_row, separators=(",", ":"), sort_keys=True) + "\n"
        ).encode()
        (self.root / "manifest.jsonl").write_bytes(manifest_bytes)
        (self.root / "library.json").write_text(json.dumps({
            "schemaVersion": "tcger-scanner-image-library-v1",
            "manifest": "manifest.jsonl",
            "manifestSHA256": hashlib.sha256(manifest_bytes).hexdigest(),
        }))
        library = trainer.DurableImageLibrary(
            self.root,
            pinned_revision="0123456789abcdef",
        )
        # A valid legacy cache is still rejected if its bytes do not belong to
        # the pinned library revision.
        cached = trainer.cached_path(row, self.cache)
        cached.parent.mkdir(parents=True)
        cached.write_bytes(image_bytes("black"))
        trainer.atomic_write_json(
            trainer.cache_sidecar_path(cached),
            trainer.image_sidecar(row, trainer.validate_image(cached)),
        )
        with mock.patch.object(
            trainer.urllib.request,
            "urlopen",
            side_effect=AssertionError("durable library must not use the network"),
        ):
            valid, report = trainer.materialize_images(
                [row],
                workers=1,
                cache_dir=self.cache,
                coverage_path=self.report,
                image_library=library,
                status_writer=self.status_writer,
            )
        self.assertEqual(valid, [0])
        self.assertEqual(report["entries"][0]["sha256"], blob_sha)
        self.assertEqual(
            report["sourceLibrary"],
            {
                "schemaVersion": "tcger-scanner-image-library-v1",
                "manifestSHA256": hashlib.sha256(manifest_bytes).hexdigest(),
                "pinnedRevision": "0123456789abcdef",
            },
        )


if __name__ == "__main__":
    unittest.main()
