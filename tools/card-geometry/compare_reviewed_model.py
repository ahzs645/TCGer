#!/usr/bin/env python3
"""Compare frozen predictions with saved labels without creating new annotations."""
import argparse
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

from benchmark_geometry import Truth, _prediction, _truth_geometry, match_record
from model_review import sha, write_json

POLICY = {"matchIou": .5, "majorBorderIou": .75, "tightBorderIou": .9,
          "humanCornerMeanFraction": .05,
          "description": "Diagnostic triage only; does not change the model, decoder, labels or benchmark scores."}


def compare(record, scene, results):
    source = record["source"]
    truths = [Truth(record["recordId"], i, scene, "real", source["width"], source["height"],
                    item, _truth_geometry(item), None) for i, item in enumerate(record["instances"])]
    predictions = [_prediction(result, i) for i, result in enumerate(results)]
    matches, misses, unmatched, duplicates, extras = match_record(truths, predictions)
    details, reference = [], []
    for truth in truths:
        corners = truth.instance.get("corners", [])
        human = len(corners) == 4 and all(c.get("coordinateKnown") and c.get("cornerSource") == "human" for c in corners)
        reference.append({"id": f"T{truth.instance_index + 1}", "human": human,
                          "orientationKnown": bool(truth.instance.get("orientationKnown")),
                          "corners": list(map(list, truth.geometry)) if truth.geometry is not None else None})
    for match in matches:
        truth = reference[match.truth.instance_index]
        row = {"cardId": f"C{match.prediction.index + 1}", "truthId": truth["id"],
               "iou": match.iou, "human": truth["human"], "topMismatch": False,
               "majorBorder": match.iou < POLICY["majorBorderIou"],
               "borderDifference": match.iou < POLICY["tightBorderIou"]}
        if truth["human"]:
            tp = [(x * source["width"], y * source["height"]) for x, y in truth["corners"]]
            pp = [(x * source["width"], y * source["height"]) for x, y in match.prediction.quad]
            scale = sum(math.dist(tp[i], tp[(i+1)%4]) for i in range(4)) / 4
            rolls = [[math.dist(tp[i], pp[(i + roll) % 4]) for i in range(4)] for roll in range(4)]
            best = min(range(4), key=lambda i: sum(rolls[i]))
            row.update({"meanCornerPixels": sum(rolls[best]) / 4, "maxCornerPixels": max(rolls[best]),
                        "meanCornerFraction": sum(rolls[best]) / (4 * scale),
                        "printedOrderMeanPixels": sum(rolls[0]) / 4, "bestCornerRoll": best,
                        "topMismatch": truth["orientationKnown"] and best != 0})
            row["borderDifference"] |= row["meanCornerFraction"] > POLICY["humanCornerMeanFraction"]
        details.append(row)
    # Unmatched predictions may be valid unannotated cards: inspection decides.
    reasons = []
    if misses: reasons.append(f"{len(misses)} reference card(s) unmatched")
    if unmatched: reasons.append(f"{len(unmatched)} prediction(s) unmatched")
    if (n := sum(d["majorBorder"] for d in details)): reasons.append(f"{n} large border difference(s)")
    if (n := sum(d["topMismatch"] for d in details)): reasons.append(f"{n} printed-top difference(s)")
    major = bool(reasons)
    if not major and (n := sum(d["borderDifference"] for d in details)):
        reasons.append(f"{n} smaller border difference(s)")
    return {"basis": "human-corners" if all(t["human"] for t in reference) and reference else "imported-geometry",
            "status": "flagged" if major else "minor-difference" if reasons else "close-agreement",
            "reasons": reasons, "matches": details, "referenceInstances": reference,
            "missedTruthIds": [f"T{t.instance_index+1}" for t in misses],
            "unmatchedCardIds": [f"C{p.index+1}" for p in unmatched],
            "counts": {"truth": len(truths), "matched": len(matches), "misses": len(misses),
                       "extras": extras, "duplicates": duplicates,
                       "majorBorders": sum(d["majorBorder"] for d in details),
                       "topDifferences": sum(d["topMismatch"] for d in details),
                       "smallerBorders": sum(d["borderDifference"] and not d["majorBorder"] for d in details)}}


def render_sheets(frames, catalog, output):
    """Diagnostic overlays: photographed pixels, green model and gold reference."""
    from PIL import Image, ImageDraw, ImageFont
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Monaco.ttf", 14)
    except OSError:
        font = ImageFont.load_default()
    output.mkdir(parents=True, exist_ok=True)
    paths = []
    for start in range(0, len(frames), 4):
        sheet = Image.new("RGB", (1200, 1120), "#111814")
        draw = ImageDraw.Draw(sheet)
        for slot, row in enumerate(frames[start:start+4]):
            x, y = (slot % 2)*600, (slot // 2)*560
            frame = catalog[row["id"]]
            with Image.open(frame["imagePath"]) as opened:
                image = opened.convert("RGB")
            image.thumbnail((572, 438))
            left, top = x+(600-image.width)//2, y+85
            sheet.paste(image, (left,top))
            draw.text((x+14,y+10), f"{row['reference']}  {row['scene']}  {row['current']['status']}", fill="white", font=font)
            reason = "; ".join(row["current"]["reasons"]) or "Close agreement with saved reference"
            for i in range(0,min(len(reason),140),70):
                draw.text((x+14,y+33+(i//70)*18),reason[i:i+70],fill="#ffcf7d",font=font)
            def outline(points, color, label):
                if not points:return
                points=[(left+p[0]*image.width,top+p[1]*image.height) for p in points]
                draw.line(points+[points[0]],fill=color,width=2)
                p=points[0];draw.text((max(x+2,min(x+555,p[0])),max(y+75,min(y+520,p[1]))),label,fill=color,font=font,stroke_width=1,stroke_fill="black")
            for truth in row["current"]["referenceInstances"]:
                outline(truth["corners"],"#ffce71",truth["id"])
            for card in frame["proposals"]:
                outline(card["corners"],"#78ffae",card["id"])
            draw.text((x+14,y+534),"GREEN = prediction C#   GOLD = saved reference T#",fill="#acc5b5",font=font)
        path=output/f"sheet-{start//4+1:02d}.jpg";sheet.save(path,quality=92);paths.append(str(path))
    return paths


def run(args):
    config=json.loads(args.config.read_text());catalog_path=Path(config["catalog"])
    if sha(catalog_path.read_bytes()) != config["catalogSha256"]:raise ValueError("Catalog hash mismatch")
    catalog=json.loads(catalog_path.read_text());manifest=json.loads((args.release/"manifest.json").read_text())
    if manifest["corpusHash"] != catalog["corpusHash"]:raise ValueError("Evaluation corpus mismatch")
    entries={e["recordId"]:e for e in manifest["records"]};frames=[]
    for f in catalog["frames"]:
        entry=entries[f["id"]];data=(args.release/entry["path"]).read_bytes()
        if sha(data)!=entry["sha256"]:raise ValueError("Evaluation labels changed")
        record=json.loads(data)
        def results(cards):
            return [{"confidence":c["confidence"],"corners":[{"point":{"x":p[0],"y":p[1]}} for p in c["corners"]]} for c in cards]
        current=compare(record,f["scene"],results(f["proposals"]));previous=compare(record,f["scene"],results(f["previous"]))
        frames.append({"id":f["id"],"reference":f["reference"],"scene":f["scene"],"imageSha256":f["imageSha256"],
                       "current":current,"previous":previous})
    summary={}
    for basis in ("human-corners","imported-geometry"):
        group=[f for f in frames if f["current"]["basis"]==basis]
        summary[basis]={"photos":len(group),"cards":sum(f["current"]["counts"]["truth"] for f in group),
                        "statuses":dict(Counter(f["current"]["status"] for f in group)),
                        "current":dict(sum((Counter(f["current"]["counts"]) for f in group),Counter())),
                        "previous":dict(sum((Counter(f["previous"]["counts"]) for f in group),Counter()))}
    flagged=sorted([f for f in frames if f["current"]["status"]=="flagged"],key=lambda f:(
        f["current"]["basis"]!="human-corners",-(f["current"]["counts"]["misses"]*4+f["current"]["counts"]["extras"]*3+f["current"]["counts"]["majorBorders"]),f["reference"]))
    report={"schema":"tcger-model-reference-comparison/v1","catalogSha256":config["catalogSha256"],
            "modelSha256":config["modelSha256"],"corpusHash":manifest["corpusHash"],"policy":POLICY,
            "summary":summary,"flaggedIds":[f["id"] for f in flagged],"frames":frames}
    if args.inspection:
        inspection=json.loads(args.inspection.read_text())
        if any(inspection[k] != report[k] for k in ("catalogSha256","modelSha256")):
            raise ValueError("Visual inspection belongs to different inputs")
        by_reference={f["reference"]:f for f in frames}
        seen=set()
        for item in inspection["entries"]:
            ref=item["reference"]
            if ref in seen or ref not in by_reference:raise ValueError("Unknown or repeated inspection reference")
            seen.add(ref);by_reference[ref]["inspection"]=item
        report["exampleIds"]=[by_reference[ref]["id"] for ref in inspection["examples"]]
        report["visualInspection"]={"author":inspection["author"],"photos":len(seen),
                                    "outcomes":dict(Counter(i["outcome"] for i in inspection["entries"]))}
        report["inspectionSha256"]=sha(args.inspection.read_bytes())
    write_json(args.output,report)
    if args.sheets:
        # All directly reviewed photos plus flagged imported examples, not a random accuracy sample.
        inspected=sorted([f for f in frames if f["current"]["basis"]=="human-corners"],key=lambda f:f["reference"])
        inspected += [f for f in flagged if f["current"]["basis"]!="human-corners"]
        sheets=render_sheets(inspected,{f["id"]:f for f in catalog["frames"]},args.sheets)
        write_json(args.sheets/"index.json",{"sheets":sheets,"references":[f["reference"] for f in inspected]})
    print(json.dumps({"summary":summary,"flagged":len(flagged),"output":str(args.output)},indent=2))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config",type=Path,required=True);parser.add_argument("--release",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True);parser.add_argument("--sheets",type=Path)
    parser.add_argument("--inspection",type=Path,help="separate, input-bound visual inspection notes")
    run(parser.parse_args())
