#!/usr/bin/env python3
"""Run frozen evaluations only after validation has selected one checkpoint."""
import argparse
import os
from pathlib import Path
from corpus_release import load_json,sha256_file
from evaluate_geometry_candidate import evaluate
from recognition_orientation import POLICY as FOUR_WAY_POLICY
from select_training_validation import select, POLICY, REAL_FIRST_POLICY

def run(selection_policy=None):
    output=Path(os.environ['TCGER_GEOMETRY_OUTPUT_DIR'])
    # The job wrapper has already uploaded the completed training artifacts.
    # A selection or later evaluation failure cannot discard the checkpoints.
    if not (output/'validation-selection/selection.json').exists():
        select(Path(os.environ['TCGER_GEOMETRY_RELEASE_ROOT']),output,
               int(os.environ['TCGER_GEOMETRY_INPUT_RESOLUTION']),
               **({'selection_policy':selection_policy} if selection_policy else {}))
    result=load_json(output/'validation-selection/selection.json')
    if selection_policy and result['policy'] != selection_policy:
        raise ValueError('Existing checkpoint selection uses a different policy')
    selected=result['selected']
    path=output/selected['checkpoint']
    if result['testDataUsed'] or sha256_file(path)!=selected['checkpointSha256']:
        raise ValueError('Invalid validation-selected checkpoint binding')
    evaluate('yolo11s-pose',checkpoint_path=path,checkpoint_sha256=selected['checkpointSha256'],
             orientation_policy=FOUR_WAY_POLICY)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--policy',choices=(POLICY,REAL_FIRST_POLICY))
    run(parser.parse_args().policy)
