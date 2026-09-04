import hashlib
import tempfile
import unittest
from pathlib import Path

from export_geometry_candidate import (
    artifact,
    find_one,
    flatten_tensor_outputs,
    input_contract,
    tree_sha256,
    yolo_export_options,
)


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

    def test_find_one_uses_numeric_epoch_order_without_best(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ("epoch_1.pth", "epoch_9.pth", "epoch_50.pth"):
                (root / name).touch()
            self.assertEqual(find_one(root, ("*.pth",)).name, "epoch_50.pth")

    def test_yolo_coreml_omits_onnx_only_options(self):
        coreml = yolo_export_options("coreml", 640)
        onnx = yolo_export_options("onnx", 640)
        self.assertNotIn("simplify", coreml)
        self.assertNotIn("opset", coreml)
        self.assertEqual(onnx["opset"], 17)

    def test_flattens_mmyolo_grouped_outputs_in_order(self):
        self.assertEqual(
            flatten_tensor_outputs((("cls8", "cls16"), ("box8", "box16"))),
            ("cls8", "cls16", "box8", "box16"),
        )

    def test_input_contracts_distinguish_candidate_preprocessing(self):
        self.assertIn("ImageNet", input_contract("fastvit-t8-four-corner", "onnx")["value"])
        self.assertIn("BGR", input_contract("yolox-pose", "onnx")["value"])


if __name__ == "__main__":
    unittest.main()
