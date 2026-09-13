#!/usr/bin/env python3
"""Run frozen evaluations only after validation has selected one checkpoint."""
import os
from pathlib import Path
from corpus_release import load_json,sha256_file
from evaluate_geometry_candidate import evaluate
from recognition_orientation import POLICY as FOUR_WAY_POLICY
from select_training_validation import select

def run():
    output=Path(os.environ['TCGER_GEOMETRY_OUTPUT_DIR'])
    # The job wrapper has already uploaded the completed training artifacts.
    # A selection or later evaluation failure cannot discard the checkpoints.
    if not (output/'validation-selection/selection.json').exists():
        select(Path(os.environ['TCGER_GEOMETRY_RELEASE_ROOT']),output,
               int(os.environ['TCGER_GEOMETRY_INPUT_RESOLUTION']))
    result=load_json(output/'validation-selection/selection.json')
    selected=result['selected']
    path=output/selected['checkpoint']
    if result['testDataUsed'] or sha256_file(path)!=selected['checkpointSha256']:
        raise ValueError('Invalid validation-selected checkpoint binding')
    evaluate('yolo11s-pose',checkpoint_path=path,checkpoint_sha256=selected['checkpointSha256'],
             orientation_policy=FOUR_WAY_POLICY)

if __name__=='__main__':run()
