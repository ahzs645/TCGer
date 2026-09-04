import hashlib
import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "tools/card-geometry/compositor/build_card_asset_manifest.py"
SPEC = importlib.util.spec_from_file_location("build_card_asset_manifest", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def png_bytes(color):
    output = io.BytesIO()
    Image.new("RGB", (20, 30), color).save(output, format="PNG")
    return output.getvalue()


class BuildCardAssetManifestTests(unittest.TestCase):
    def test_duplicate_library_bytes_produce_one_asset(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            library = root / "library"
            (library / "shards").mkdir(parents=True)
            train = png_bytes((10, 20, 30))
            validation = png_bytes((40, 50, 60))
            rows = [
                ("train", "sample-train-a", "blobs/train-a.png", train),
                ("train", "sample-train-b", "blobs/train-b.png", train),
                ("validation", "sample-validation", "blobs/validation.png", validation),
            ]
            shard = library / "shards/blobs-00.tar"
            with tarfile.open(shard, "w") as archive:
                for _, _, member, data in rows:
                    info = tarfile.TarInfo(member)
                    info.size = len(data)
                    archive.addfile(info, io.BytesIO(data))
            manifest_rows = []
            for split, sample, member, data in rows:
                manifest_rows.append(
                    {
                        "game": "magic",
                        "status": "valid",
                        "partition": split,
                        "shard": "shards/blobs-00.tar",
                        "member": member,
                        "sampleId": sample,
                        "blobSha256": hashlib.sha256(data).hexdigest(),
                        "extension": "png",
                        "provenance": {},
                    }
                )
            (library / "manifest.jsonl").write_text(
                "".join(json.dumps(row) + "\n" for row in manifest_rows),
                encoding="utf-8",
            )
            (library / "library.json").write_text("{}\n", encoding="utf-8")
            document = MODULE.build_manifest(
                library_root=library,
                library_repo="owner/repo",
                library_revision="a" * 40,
                game="magic",
                train_count=1,
                validation_count=1,
                output=root / "output",
            )
            self.assertEqual(len(document["assets"]), 2)
            self.assertEqual(len({row["assetId"] for row in document["assets"]}), 2)


if __name__ == "__main__":
    unittest.main()
