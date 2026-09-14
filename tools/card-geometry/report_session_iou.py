#!/usr/bin/env python3
"""Report continuous outline overlap from frozen predictions, without tuning them."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment

from reference_geometry import quad_iou


def assigned_overlap(matrix):
    """Maximum-total-IoU one-to-one assignment, retaining every reference target."""
    matrix = np.asarray(matrix, dtype=float)
    if matrix.ndim != 2 or not np.isfinite(matrix).all() or np.any((matrix < 0) | (matrix > 1)):
        raise ValueError("Expected a finite reference-by-prediction IoU matrix in [0,1]")
    values = np.zeros(matrix.shape[0])
    predictions = [None] * matrix.shape[0]
    if matrix.size:
        rows, columns = linear_sum_assignment(matrix, maximize=True)
        for row, column in zip(rows, columns):
            values[row] = matrix[row, column]
            if values[row] > 0:
                predictions[row] = int(column) + 1
    return values.tolist(), predictions


def distribution(values):
    a = np.asarray(values, dtype=float)
    if not len(a):
        raise ValueError("No reference targets")
    bins = np.linspace(0, 1, 21)
    counts, _ = np.histogram(a, bins=bins)
    return dict(count=len(a), mean=float(a.mean()), zeroOverlap=int((a == 0).sum()),
                quantiles={str(q): float(np.quantile(a, q / 100)) for q in [0, 10, 25, 50, 75, 90, 100]},
                histogram=dict(edges=bins.tolist(), counts=counts.tolist()),
                survival=[dict(iou=float(t), count=int((a >= t).sum())) for t in np.linspace(.05, 1, 20)])


def build(comparison):
    rows = []
    for frame in comparison['frames']:
        truths = frame['versions']['baseline']['referenceInstances']
        assert truths == frame['versions']['candidate']['referenceInstances']
        results = {}
        for model in ['baseline', 'candidate']:
            predictions = frame['predictions'][model]
            matrix = np.zeros((len(truths), len(predictions)))
            for i, truth in enumerate(truths):
                for j, prediction in enumerate(predictions):
                    quad = [(c['point']['x'], c['point']['y']) for c in prediction['corners']]
                    matrix[i, j] = quad_iou([tuple(p) for p in truth['corners']], quad)
            values, assigned = assigned_overlap(matrix)
            results[model] = dict(values=values, predictions=assigned,
                                 best=matrix.max(axis=1).tolist() if len(predictions) else [0.] * len(truths))
        for i, truth in enumerate(truths):
            row = dict(reference=frame['reference'], recordId=frame['id'], card=i+1,
                       multiCard=len(truths) > 1, scene=frame['scene'])
            for model, result in results.items():
                row[model] = dict(iou=result['values'][i], prediction=result['predictions'][i],
                                  bestUnrestrictedIoU=result['best'][i])
            row['delta'] = row['candidate']['iou'] - row['baseline']['iou']
            rows.append(row)
    return dict(schema='tcger-session-iou-distribution/v1', diagnosticOnly=True,
                assignment='Maximum-total-IoU one-to-one pairing without an IoU cutoff. Unassigned/zero-overlap references get zero. This differs from the frozen threshold-specific benchmark matcher.',
                unchanged='Predictions, confidence thresholds, reference labels, checkpoint choices and original benchmark scores.',
                models=comparison['models'], summaries={m: distribution([r[m]['iou'] for r in rows]) for m in ['baseline', 'candidate']},
                photoBalancedMean={m: float(np.mean([np.mean([r[m]['iou'] for r in rows if r['recordId'] == f['id']]) for f in comparison['frames'] if f['versions']['baseline']['referenceInstances']])) for m in ['baseline', 'candidate']},
                originalBenchmark={m: dict(found=comparison['metrics'][m]['detection']['overall']['matches'], tight=comparison['paired'][m]['tight']) for m in ['baseline', 'candidate']},
                paired=dict(improved=sum(r['delta'] > 1e-9 for r in rows), worse=sum(r['delta'] < -1e-9 for r in rows), unchanged=sum(abs(r['delta']) <= 1e-9 for r in rows)),
                rows=rows)


def render(report, output):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.8), layout='constrained')
    colors = {'baseline': '#197b49', 'candidate': '#5554c8'}
    for model, label in [('baseline', 'Earlier YOLO11s'), ('candidate', 'Newer YOLO11s')]:
        values = np.array([r[model]['iou'] for r in report['rows']])
        axes[0].stairs(*np.histogram(values, bins=np.linspace(0, 1, 21)), color=colors[model], label=label, linewidth=2)
        sorted_values = np.sort(values)
        axes[1].step(np.r_[0, sorted_values, 1], np.r_[0, np.arange(1, len(values)+1)/len(values), 1], where='post', color=colors[model], label=label, linewidth=2)
    for ax in axes:
        ax.set_xlim(0, 1)
        ax.set_xlabel('Assigned outline IoU (unassigned references = 0)')
        ax.grid(alpha=.2)
        ax.axvline(.5, color='gray', linestyle=':', linewidth=1)
        ax.axvline(.9, color='gray', linestyle=':', linewidth=1)
    axes[0].set_ylabel('Saved card outlines'); axes[0].set_title('Full distribution, including misses'); axes[0].legend()
    axes[1].set_ylabel('Fraction of references at or below IoU'); axes[1].set_title('Cumulative distribution — lower is better'); axes[1].set_ylim(0, 1)
    fig.suptitle(f"Frozen session · {len(report['rows'])} outlines · fixed saved predictions")
    fig.savefig(output / 'iou-distribution.png', dpi=170)
    fig.savefig(output / 'iou-distribution.svg')
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--comparison', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    raw = args.comparison.read_bytes()
    report = build(json.loads(raw))
    report['comparisonSha256'] = hashlib.sha256(raw).hexdigest()
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / 'distribution.json').write_text(json.dumps(report, indent=2) + '\n')
    render(report, args.output)
    assert args.comparison.read_bytes() == raw
    print(json.dumps({k: report[k] for k in ['summaries', 'photoBalancedMean', 'paired']}, indent=2))


if __name__ == '__main__':
    main()
