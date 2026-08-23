#!/usr/bin/env python3
"""Offline acceptance-policy sweep over dumped replay evidence.

Approximates BoardCardEmbeddingScannerStrategy's acceptance ladder per frame
from recorded attempts (candidates + OCR readings), sweeping the strong-accept
threshold, retry margin, and ambiguity margin. The chosen operating point must
be re-validated with a real replay run — this narrows the grid, it doesn't
replace the harness.
"""
import json
import sys
from pathlib import Path

EVID_DIR = Path(sys.argv[1])
frames = [json.load(open(p)) for p in sorted(EVID_DIR.glob("*.json"))]
print(f"frames: {len(frames)}", file=sys.stderr)


def collector_number(card_id):
    if "-" not in card_id:
        return None
    num = card_id.split("-", 1)[1].lower().lstrip("0")
    return num or "0"


def ocr_confirms(att, cand_id):
    cn = collector_number(cand_id)
    if not cn:
        return False
    pairs = {p.lower().lstrip("0") or "0" for p in att.get("footerPairNumbers", [])}
    return cn in pairs


def attempt_accepts(att, idx, S, R, A, title_hi, title_sep):
    cands = att.get("topCandidates") or []
    if not cands:
        return None
    top1 = cands[0]
    rival = next((c for c in cands[1:] if c["cardID"] != top1["cardID"]), None)
    required = S if idx < 2 else S + R

    # OCR-confirmed path: any shortlist candidate whose collector number the
    # footer reading confirms (within the recorded eligibility superset).
    ocr_hit = None
    need_verify = top1["similarity"] < S
    need_tiebreak = rival is not None and (top1["similarity"] - rival["similarity"]) < 0.1
    if need_verify or need_tiebreak:
        for c in cands:
            eligible = need_verify or (top1["similarity"] - c["similarity"]) < 0.1
            if eligible and ocr_confirms(att, c["cardID"]):
                ocr_hit = c
                break
    if ocr_hit is not None:
        return ocr_hit["cardID"]

    if top1["similarity"] < required:
        return None
    # Title printing guard (title matched, multiple printings, no OCR).
    if att.get("titleMatchedName") and (att.get("titlePrintingCount") or 0) > 1:
        runner = cands[1]["similarity"] if len(cands) > 1 else 0.0
        if not (top1["similarity"] >= title_hi and top1["similarity"] - runner >= title_sep):
            return None
    if rival is not None and (top1["similarity"] - rival["similarity"]) < A:
        return None
    return top1["cardID"]


def frame_result(f, **kw):
    for idx, att in enumerate(f.get("attempts") or []):
        got = attempt_accepts(att, idx, **kw)
        if got:
            return got
    return None


def score(S, R, A, title_hi=0.85, title_sep=0.05):
    correct = wrong = false_acc = lost = labeled = accepted = 0
    for f in frames:
        got = frame_result(f, S=S, R=R, A=A, title_hi=title_hi, title_sep=title_sep)
        if got:
            accepted += 1
        if f.get("expected"):
            labeled += 1
            if got == f["expected"]:
                correct += 1
            elif got:
                wrong += 1
        if f.get("expectedNoMatch") and got:
            false_acc += 1
        if f["baseline"] != "noMatch" and not got:
            lost += 1
    return dict(S=S, R=R, A=A, correct=correct, labeled=labeled, wrong=wrong,
                false_acc=false_acc, lost=lost, accepted=accepted)


results = []
for S in [0.60, 0.64, 0.68, 0.70, 0.72, 0.74, 0.76, 0.78, 0.80, 0.82]:
    for R in [0.02, 0.04]:
        for A in [0.01, 0.02, 0.03, 0.05]:
            results.append(score(S, R, A))

# Current policy reference point:
ref = score(0.72, 0.02, 0.02)
print(f"reference (current 0.72/0.02/0.02): {ref}")

clean = [r for r in results if r["wrong"] == 0 and r["false_acc"] == 0]
clean.sort(key=lambda r: (-r["correct"], r["lost"]))
print("\nTop zero-wrong operating points:")
for r in clean[:8]:
    print(f"  S={r['S']:.2f} R={r['R']:.2f} A={r['A']:.2f} -> "
          f"correct {r['correct']}/{r['labeled']}, lost {r['lost']}, accepted {r['accepted']}")

best_overall = sorted(results, key=lambda r: (r["wrong"] + r["false_acc"], -r["correct"], r["lost"]))[:5]
print("\nBest overall (incl. non-clean):")
for r in best_overall:
    print(f"  S={r['S']:.2f} R={r['R']:.2f} A={r['A']:.2f} -> "
          f"correct {r['correct']}/{r['labeled']}, wrong {r['wrong']}, false {r['false_acc']}, lost {r['lost']}")
