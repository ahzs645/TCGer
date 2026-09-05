"""Execute the patched upstream prediction method against captured parent outputs.

The fixture is unmodified Apache-2.0 MMYOLO source at
8c4d9dc503dc8e327bec8147e8dc97124052f693; its digest is checked by repair_source.
Only the parent detection outputs are stubbed, leaving the failing tensor indexing
and keypoint decode/selection path intact.
"""
import ast
from pathlib import Path
import tempfile
import types
import unittest

import torch

from yolox_validation_fix import RELATIVE_PATH, REPLACEMENTS, repair_source, repaired_source

SOURCE = (Path(__file__).parent / 'fixtures/yolox_pose_head.upstream.py.txt').read_text()


class Instances:
    def __init__(self, count):
        self.scores = torch.ones(count)

    def __len__(self):
        return len(self.scores)

    def numpy(self):
        return self


class Parent:
    def predict_by_feat(self, *args):
        return self.results

    def _bbox_post_process(self):
        pass


def prediction_head(source, selections, counts, nms):
    tree = ast.parse(source)
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'YOLOXPoseHead')
    cls.bases = [ast.Name(id='Parent', ctx=ast.Load())]
    cls.decorator_list = []
    cls.body = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == 'predict_by_feat']
    captures = iter(([(None, None, s, None) for s in selections], [(None, s) for s in nms]))

    class Capture:
        def __init__(self, *args):
            self.outputs = next(captures)

        def __enter__(self):
            return self.outputs

        def __exit__(self, *args):
            return False

    namespace = dict(Parent=Parent, torch=torch, OutputSaveFunctionWrapper=Capture,
                     filter_scores_and_topk=None, batched_nms=None)
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), cls], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), '<upstream-prediction>', 'exec'), namespace)
    head = namespace['YOLOXPoseHead']()
    head.test_cfg = types.SimpleNamespace(max_per_img=300)
    head.results = [Instances(n) for n in counts]
    head.num_keypoints = 4
    head.num_base_priors = 1
    head.featmap_strides = [1]
    head.mlvl_priors = [torch.zeros(500, 2)]
    head.decode_pose = lambda priors, offsets, strides: offsets.reshape(len(counts), 500, 4, 2)
    # Each prior's keypoints identify its index, independently for every image.
    values = torch.arange(500).float().reshape(1, 1, 1, 500).expand(len(counts), 8, 1, 500)
    def run():
        return head.predict_by_feat([], [], kpt_preds=[values], vis_preds=[values[:, :4]],
                                    batch_img_metas=[{'scale_factor': [2, 2]} for _ in counts])
    return run


class YoloxValidationRepairTests(unittest.TestCase):
    def test_original_reproduces_out_of_bounds_after_existing_cfg_fix(self):
        source = SOURCE.replace(*REPLACEMENTS[0])
        run = prediction_head(source, [torch.arange(500)], [2], [torch.tensor([499, 301])])
        with self.assertRaises(IndexError):
            run()

    def test_crowded_candidates_keep_box_keypoint_alignment(self):
        run = prediction_head(repaired_source(SOURCE), [torch.arange(499, -1, -1)], [2], [torch.tensor([499, 301, 4])])
        result = run()[0]
        self.assertEqual(result.keypoints[:, 0, 0].tolist(), [0, 99])
        self.assertEqual(len(result.keypoint_scores), len(result))

    def test_yolox_style_preserves_more_than_configured_maximum(self):
        run = prediction_head(repaired_source(SOURCE), [torch.arange(500)], [400], [torch.arange(400)])
        result = run()[0]
        self.assertEqual(len(result.keypoints), 400)
        self.assertEqual(result.keypoints[-1, 0, 0].item(), 199.5)

    def test_empty_image_does_not_consume_next_images_nms(self):
        run = prediction_head(repaired_source(SOURCE), [torch.tensor([], dtype=torch.long), torch.arange(500)],
                              [0, 1], [torch.tensor([450])])
        empty, nonempty = run()
        self.assertEqual(tuple(empty.keypoints.shape), (0, 4, 2))
        self.assertEqual(nonempty.keypoints[0, 0, 0].item(), 225)

    def test_patch_is_digest_guarded_and_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / RELATIVE_PATH
            path.parent.mkdir(parents=True)
            path.write_text(SOURCE)
            first = repair_source(Path(tmp))
            self.assertEqual(first, repair_source(Path(tmp)))
            path.write_text(path.read_text() + '# unexpected edit\n')
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                repair_source(Path(tmp))


if __name__ == '__main__':
    unittest.main()
