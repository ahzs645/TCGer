import importlib.util
import json
import runpy
import tempfile
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "tools/card-geometry/train_yolox_pose.py"
SPEC = importlib.util.spec_from_file_location("train_yolox_pose", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class TrainYoloxPoseTests(unittest.TestCase):
    def test_checkpoint_helpers_select_latest_epoch_in_experiment(self):
        prefix = "geometry/yolox-pose/corpus/experiment"
        paths = [
            f"{prefix}/training-output/training/repeat-0/epoch_2.pth",
            f"{prefix}/training-output/training/repeat-0/epoch_12.pth",
            f"{prefix}/training-output/training/repeat-0/latest.pth",
            "geometry/yolox-pose/other/run/training-output/training/repeat-0/epoch_50.pth",
        ]
        self.assertEqual(MODULE.checkpoint_epoch(paths[1]), 12)
        self.assertIsNone(MODULE.checkpoint_epoch(paths[2]))
        self.assertEqual(MODULE.latest_checkpoint_path(paths, prefix), paths[1])

    def test_stable_checkpoints_waits_for_unchanged_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            work_dir = Path(temporary)
            checkpoint = work_dir / "epoch_1.pth"
            checkpoint.write_bytes(b"first")
            ready, previous = MODULE.stable_checkpoints(work_dir, {}, set())
            self.assertEqual(ready, [])
            ready, previous = MODULE.stable_checkpoints(work_dir, previous, set())
            self.assertEqual(ready, [checkpoint])
            checkpoint.write_bytes(b"changed")
            ready, previous = MODULE.stable_checkpoints(work_dir, previous, set())
            self.assertEqual(ready, [])
            ready, _ = MODULE.stable_checkpoints(work_dir, previous, set())
            self.assertEqual(ready, [checkpoint])

    def test_training_command_uses_base_or_resume_checkpoint(self):
        common = {
            "mmyolo_root": Path("/mmyolo"),
            "config": Path("/run/config.py"),
            "work_dir": Path("/run/work"),
            "base_checkpoint": Path("/run/base.pth"),
        }
        base = MODULE.training_command(**common, resume_checkpoint=None)
        self.assertIn("--cfg-options", base)
        self.assertIn("load_from=/run/base.pth", base)
        self.assertNotIn("--resume", base)
        resumed = MODULE.training_command(
            **common, resume_checkpoint=Path("/cache/epoch_8.pth")
        )
        self.assertEqual(resumed[-2:], ["--resume", "/cache/epoch_8.pth"])
        self.assertNotIn("--cfg-options", resumed)

    def test_stage_resume_checkpoint_makes_epoch_available_to_evaluator(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "downloaded.pth"
            source.write_bytes(b"checkpoint")
            staged = MODULE.stage_resume_checkpoint(source, 50, root / "work")
            self.assertEqual(staged.name, "epoch_50.pth")
            self.assertEqual(staged.read_bytes(), b"checkpoint")

    def test_pinned_metainfo_defines_four_ordered_corners(self):
        metadata = runpy.run_path(ROOT / MODULE.METAINFO_FILE)["dataset_info"]
        self.assertEqual(metadata["dataset_name"], "tcger-card-corners")
        self.assertEqual(
            [metadata["keypoint_info"][index]["name"] for index in range(4)],
            ["top_left", "top_right", "bottom_right", "bottom_left"],
        )
        self.assertEqual(len(metadata["sigmas"]), 4)

    def test_coco_annotation_keeps_card_order_and_visibility(self):
        instance = {
            "instanceId": "card-0",
            "corners": [
                {"point": {"x": 0.1, "y": 0.1}, "coordinateKnown": True, "visibility": "visible"},
                {"point": {"x": 0.9, "y": 0.1}, "coordinateKnown": True, "visibility": "occluded"},
                {"point": {"x": 0.9, "y": 1.1}, "coordinateKnown": True, "visibility": "outsideFrame"},
                {"point": {"x": 0.1, "y": 1.1}, "coordinateKnown": True, "visibility": "visible"},
            ],
        }
        row = MODULE.coco_annotation(
            instance,
            annotation_id=1,
            image_id=2,
            width=100,
            height=100,
            margins={"left": 20, "top": 20, "right": 20, "bottom": 20},
        )
        self.assertIsNotNone(row)
        self.assertEqual(row["num_keypoints"], 4)
        self.assertEqual(row["keypoints"][2::3], [2, 1, 1, 2])

    def test_materialize_coco_writes_padded_splits(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            release = root / "release"
            (release / "records").mkdir(parents=True)
            (release / "images").mkdir()
            Image.new("RGB", (10, 20), (20, 30, 40)).save(release / "images/frame.jpg")
            corners = [
                {
                    "point": {"x": x, "y": y},
                    "coordinateKnown": True,
                    "cornerSource": "synthetic",
                    "visibility": "visible",
                }
                for x, y in ((0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9))
            ]
            record = {
                "source": {"kind": "synthetic", "path": "images/frame.jpg", "width": 10, "height": 20},
                "synthetic": {"contextMarginPixels": {"left": 2, "top": 4, "right": 2, "bottom": 4}},
                "instances": [{"instanceId": "card-0", "corners": corners}],
            }
            for split in ("train", "validation"):
                (release / f"records/{split}.json").write_text(json.dumps(record))
            (release / "manifest.json").write_text(
                json.dumps(
                    {
                        "corpusHash": "a" * 64,
                        "records": [
                            {"recordId": split, "split": split, "path": f"records/{split}.json"}
                            for split in ("train", "validation")
                        ],
                    }
                )
            )
            output = root / "coco"
            summary = MODULE.materialize_coco(release, output)
            self.assertEqual(summary["counts"]["instances:validation"], 1)
            document = json.loads((output / "annotations/train.json").read_text())
            self.assertEqual(document["images"][0]["width"], 14)
            self.assertEqual(document["images"][0]["height"], 28)
            self.assertEqual(document["categories"][0]["keypoints"][0], "top_left")

    def test_config_replaces_framework_random_augmentation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            checkout = root / "mmyolo"
            base = checkout / "configs/yolox/pose/yolox-pose_s_8xb32-300e-rtmdet-hyp_coco.py"
            base.parent.mkdir(parents=True)
            base.write_text("# pinned base\n")
            dataset = root / "dataset"
            dataset.mkdir()
            output = root / "output"
            output.mkdir()
            config = MODULE.write_config(
                mmyolo_root=checkout,
                dataset=dataset,
                output=output,
                epochs=50,
                batch=16,
                workers=8,
                seed=20260903,
            ).read_text()
            self.assertIn("pipeline=shared_pipeline", config)
            self.assertIn("inference_pipeline = [", config)
            self.assertIn("pipeline=inference_pipeline", config)
            self.assertIn("test_dataloader = dict", config)
            self.assertIn("loss_pose=dict(_delete_=True", config)
            self.assertIn("metainfo=metainfo_file", config)
            self.assertIn("metainfo = dict(from_file=metainfo_file)", config)
            self.assertIn("load_from = None", config)
            self.assertIn("test_cfg=dict(yolox_style=True", config)
            self.assertIn("max_per_img=300", config)
            self.assertIn("val_begin=1", config)
            self.assertIn("val_interval=1", config)
            self.assertNotIn("val_dataloader = None", config)
            self.assertNotIn("val_evaluator = None", config)
            self.assertNotIn("val_cfg = None", config)
            self.assertIn("save_best=None", config)
            self.assertIn("batch_augments=None", config)
            self.assertIn("lr=0.00025", config)
            self.assertIn("auto_scale_lr = dict(enable=False", config)
            self.assertIn("by_keypoints=False", config)
            self.assertIn("dataset=dict(_delete_=True, type='PoseCocoDataset'", config)
            self.assertNotIn("Mosaic", config)
            self.assertNotIn("RandomFlip", config)


if __name__ == "__main__":
    unittest.main()
