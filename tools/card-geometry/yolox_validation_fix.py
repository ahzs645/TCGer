"""Minimal, digest-guarded repairs to the pinned MMYOLO pose head."""

import hashlib
from pathlib import Path

SOURCE_SHA256 = '701ccb1c2e7bebc4e56848ce181ded2710d5b007c783bc78bbea52142a992af3'
RELATIVE_PATH = 'mmyolo/models/dense_heads/yolox_pose_head.py'
REPLACEMENTS = (
    ('\n        with OutputSaveFunctionWrapper(\n',
     '\n        cfg = self.test_cfg if cfg is None else cfg\n        with OutputSaveFunctionWrapper(\n'),
    ('                vis_targets) / vis_targets.sum()',
     '                vis_targets) / vis_targets.sum().clamp(min=1)'),
)


def repaired_source(source: str) -> str:
    for before, after in REPLACEMENTS:
        if source.count(before) != 1:
            raise ValueError('pinned YOLOX source repair location changed')
        source = source.replace(before, after, 1)
    return source


def repair_source(root: Path) -> dict:
    path = root / RELATIVE_PATH
    source = path.read_text()
    # Accept only the exact original or the exact result of these two edits.
    original = source
    for before, after in reversed(REPLACEMENTS):
        original = original.replace(after, before, 1)
    before_hash = hashlib.sha256(original.encode()).hexdigest()
    if before_hash != SOURCE_SHA256:
        raise ValueError('unexpected MMYOLO pose head SHA-256; refusing to patch')
    repaired = repaired_source(original)
    if source not in (original, repaired):
        raise ValueError('partially patched MMYOLO pose head')
    path.write_text(repaired)
    return {'path': RELATIVE_PATH, 'originalSha256': before_hash,
            'repairedSha256': hashlib.sha256(repaired.encode()).hexdigest(),
            'changes': ['bind missing local cfg to self.test_cfg',
                        'clamp visibility-loss denominator for box-only batches']}
