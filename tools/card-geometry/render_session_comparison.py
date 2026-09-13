#!/usr/bin/env python3
"""Build a read-only gallery and contact sheets from saved comparison outputs."""
import argparse
import copy
import json
from pathlib import Path
import shutil

from PIL import Image, ImageDraw, ImageFont
from corpus_release import sha256_file, write_json


def render(root):
    source = root / "comparison.json"
    report = json.loads(source.read_text())
    output = root / "gallery"
    output.mkdir(exist_ok=True)
    images = output / "images"
    images.mkdir(exist_ok=True)
    for name, path in [("index.html", Path(__file__).with_name("session-comparison.html")),
                       ("backup-status.js", Path(__file__).with_name("backup-status.js")),
                       ("geometry.js", Path(__file__).with_name("corner-editor") / "geometry.js")]:
        shutil.copy2(path, output / name)
    gallery = copy.deepcopy(report)
    inspection_path = root / "visual-inspection.json"
    if inspection_path.exists():
        inspection = json.loads(inspection_path.read_text())
        if inspection["comparisonSha256"] != sha256_file(source):
            raise ValueError("Visual inspection belongs to different model results")
        for frame in gallery["frames"]:
            frame["inspection"] = [e for e in inspection["entries"] if e["reference"] == frame["reference"]]
    adjudication_path = root / "reference-adjudication.json"
    if adjudication_path.exists():
        adjudication = json.loads(adjudication_path.read_text())
        if adjudication["comparisonSha256"] != sha256_file(source):
            raise ValueError("Reference adjudication belongs to different results")
        for frame in gallery["frames"]:
            updates = [e for e in adjudication["entries"] if e["reference"] == frame["reference"]]
            if updates:
                frame["inspection"] = [e for e in frame.get("inspection", []) if e["kind"] != "reference-check"]
                frame["inspection"] += [dict(e, kind="reference-checked") for e in updates]
    for frame in gallery["frames"]:
        image_path = Path(frame["source"]["path"])
        if sha256_file(image_path) != frame["source"]["sha256"]:
            raise ValueError("Source image hash changed")
        with Image.open(image_path) as opened:
            image = opened.convert("RGB")
            image.thumbnail((1600, 1600))
            image.save(images / f"{frame['reference']}.jpg", quality=94)
        frame["imageUrl"] = f"images/{frame['reference']}.jpg"
    write_json(output / "data.json", gallery)
    sheets = root / "inspection-sheets"
    sheets.mkdir(exist_ok=True)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Monaco.ttf", 14)
    except OSError:
        font = ImageFont.load_default()
    for start in range(0, len(report["frames"]), 12):
        sheet = Image.new("RGB", (1600, 1530), "#10171f")
        draw = ImageDraw.Draw(sheet)
        for slot, frame in enumerate(report["frames"][start:start+12]):
            left, top = (slot % 4)*400, (slot//4)*510
            draw.text((left+10,top+8), frame["reference"]+"  "+frame["key"].split("/")[-1], fill="white", font=font)
            for n,(name,color) in enumerate((("baseline", "#78ffae"),("candidate", "#a8beff"))):
                v=frame["versions"][name]
                text=f"{'B' if n==0 else 'C'} {v['counts']['matched']}/{v['counts']['truth']} found; {sum(m['iou']>=.9 for m in v['matches'])} tight; {v['counts']['extras']+v['counts']['duplicates']} extra"
                draw.text((left+10,top+30+n*19), text, fill=color, font=font)
            with Image.open(frame["source"]["path"]) as opened:
                image=opened.convert("RGB")
            image.thumbnail((330,370))
            x,y=left+(400-image.width)//2,top+85+(370-image.height)//2
            sheet.paste(image,(x,y))
            def outline(points,color,width):
                pixels=[(x+p[0]*image.width,y+p[1]*image.height) for p in points]
                draw.line(pixels+[pixels[0]],fill=color,width=width)
            for name,color in (("baseline","#78ffae"),("candidate","#a8beff")):
                for result in frame["predictions"][name]:
                    outline([[c['point']['x'],c['point']['y']] for c in result['corners']],color,2)
            for truth in frame["versions"]["baseline"]["referenceInstances"]:
                outline(truth['corners'],'#ffce71',1)
            draw.text((left+10,top+475),'Gold truth / Green baseline / Blue candidate',fill='#aabac9',font=font)
        sheet.save(sheets/f"sheet-{start//12+1:02d}.jpg",quality=94)
    write_json(output / "gallery-verification.json", {"comparisonSha256":sha256_file(source),
        "readOnly":True,"frames":len(gallery['frames']),"images":len(list(images.glob('*.jpg'))),
        "files":{str(p.relative_to(output)):sha256_file(p) for p in output.rglob('*') if p.is_file() and p.name!='gallery-verification.json'}})
    print(output)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--comparison-root',type=Path,required=True)
    render(parser.parse_args().comparison_root)
