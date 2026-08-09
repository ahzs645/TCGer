#!/usr/bin/env python3
"""Export a TCGer scanner recording for Label Studio and COCO tooling.

The recorder's Vision quadrilateral is exported as a prediction, not as
human-reviewed ground truth. Existing scanner identity matches are retained as
task/annotation metadata so a reviewer can correct them without losing context.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import struct
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import quote


LABEL_CONFIG = """<View>
  <Header value="Card geometry"/>
  <Image name="image" value="$image" zoomControl="true" rotateControl="true"/>
  <PolygonLabels name="card" toName="image" strokeWidth="3" opacity="0.2">
    <Label value="Card" background="#FF3B30"/>
  </PolygonLabels>
  <Header value="Recognition ground truth"/>
  <Choices name="review_status" toName="image" choice="single" showInline="true">
    <Choice value="Correct match"/>
    <Choice value="Wrong match"/>
    <Choice value="No card present"/>
    <Choice value="Uncertain"/>
  </Choices>
  <TextArea
    name="expected_card_id"
    toName="image"
    rows="1"
    placeholder="Canonical card ID, for example pl4-AR3"
  />
  <TextArea name="notes" toName="image" rows="2" placeholder="Glare, blur, partial card, multiple cards…"/>
</View>
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert a TCGer scanner recording ZIP/folder to Label Studio and COCO."
    )
    parser.add_argument("recording", type=Path, help="Exported scanner ZIP or extracted folder")
    parser.add_argument("--output", required=True, type=Path, help="New output directory")
    parser.add_argument(
        "--local-files-root",
        type=Path,
        help=(
            "Label Studio local-files document root. Defaults to the output directory's parent, "
            "so task URLs use /data/local-files/?d=<output>/images/..."
        ),
    )
    return parser.parse_args()


def safe_extract(archive: Path, destination: Path) -> None:
    destination = destination.resolve()
    with zipfile.ZipFile(archive) as source:
        for member in source.infolist():
            target = (destination / member.filename).resolve()
            if target != destination and destination not in target.parents:
                raise ValueError(f"Unsafe archive path: {member.filename}")
        source.extractall(destination)


def find_recording_root(path: Path) -> Path:
    direct = path / "results.json"
    if direct.is_file():
        return path
    manifests = list(path.rglob("results.json"))
    if len(manifests) != 1:
        raise ValueError(f"Expected exactly one results.json, found {len(manifests)}")
    return manifests[0].parent


def jpeg_dimensions(path: Path) -> tuple[int, int]:
    """Read JPEG dimensions without a third-party image dependency."""
    start_of_frame = {
        0xC0,
        0xC1,
        0xC2,
        0xC3,
        0xC5,
        0xC6,
        0xC7,
        0xC9,
        0xCA,
        0xCB,
        0xCD,
        0xCE,
        0xCF,
    }
    with path.open("rb") as image:
        if image.read(2) != b"\xff\xd8":
            raise ValueError(f"Not a JPEG image: {path}")
        while True:
            marker_prefix = image.read(1)
            if not marker_prefix:
                break
            if marker_prefix != b"\xff":
                continue
            marker = image.read(1)
            while marker == b"\xff":
                marker = image.read(1)
            if not marker:
                break
            marker_value = marker[0]
            if marker_value in {0xD8, 0xD9}:
                continue
            length_bytes = image.read(2)
            if len(length_bytes) != 2:
                break
            segment_length = struct.unpack(">H", length_bytes)[0]
            if marker_value in start_of_frame:
                precision_height_width = image.read(5)
                if len(precision_height_width) != 5:
                    break
                _, height, width = struct.unpack(">BHH", precision_height_width)
                return width, height
            image.seek(segment_length - 2, 1)
    raise ValueError(f"Could not read JPEG dimensions: {path}")


def label_studio_points(quad: list[list[float]]) -> list[list[float]]:
    # Vision is normalized with a bottom-left origin; Label Studio percentages
    # use a top-left origin.
    return [[x * 100.0, (1.0 - y) * 100.0] for x, y in quad]


def coco_geometry(
    quad: list[list[float]], width: int, height: int
) -> tuple[list[float], list[float], float]:
    points = [(x * width, (1.0 - y) * height) for x, y in quad]
    polygon = [coordinate for point in points for coordinate in point]
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    bbox = [min_x, min_y, max_x - min_x, max_y - min_y]
    area = 0.0
    for index, point in enumerate(points):
        next_point = points[(index + 1) % len(points)]
        area += point[0] * next_point[1] - next_point[0] * point[1]
    return polygon, bbox, abs(area) / 2.0


def make_label_studio_prediction(
    frame: dict, width: int, height: int
) -> list[dict]:
    quad = frame.get("quad")
    if not quad:
        return []
    result = {
        "id": f"card-{frame['index']:04d}",
        "from_name": "card",
        "to_name": "image",
        "type": "polygonlabels",
        "original_width": width,
        "original_height": height,
        "image_rotation": 0,
        "value": {
            "points": label_studio_points(quad),
            "polygonlabels": ["Card"],
        },
    }
    prediction: dict = {
        "model_version": "tcger-ios-vision-recording",
        "result": [result],
    }
    confidence = frame.get("segmentationConfidence")
    if confidence is not None:
        prediction["score"] = confidence
    return [prediction]


def export_bundle(recording_root: Path, output: Path, local_files_root: Path) -> None:
    if output.exists() and any(output.iterdir()):
        raise ValueError(f"Output directory is not empty: {output}")
    output.mkdir(parents=True, exist_ok=True)
    images_output = output / "images"
    images_output.mkdir()

    manifest = json.loads((recording_root / "results.json").read_text())
    frames = manifest["frames"]
    output_relative = output.resolve().relative_to(local_files_root.resolve())

    tasks: list[dict] = []
    coco_images: list[dict] = []
    coco_annotations: list[dict] = []
    review_rows: list[dict] = []
    annotation_id = 1

    for frame in frames:
        source_image = recording_root / frame["imageFile"]
        if not source_image.is_file():
            raise FileNotFoundError(source_image)
        image_name = Path(frame["imageFile"]).name
        destination_image = images_output / image_name
        shutil.copy2(source_image, destination_image)
        width, height = jpeg_dimensions(destination_image)
        local_path = output_relative / "images" / image_name
        image_url = f"/data/local-files/?d={quote(local_path.as_posix(), safe='/')}"

        tasks.append(
            {
                "id": frame["index"],
                "data": {
                    "image": image_url,
                    "frame_index": frame["index"],
                    "timestamp_seconds": frame["timestampSeconds"],
                    "recorded_match_id": frame.get("bestMatchCardId"),
                    "recorded_match_name": frame.get("bestMatchName"),
                    "recorded_confidence": frame.get("confidence"),
                    "recorded_identified": frame["identified"],
                    "segmentation_confidence": frame.get("segmentationConfidence"),
                    "alternatives": frame.get("alternatives", []),
                    "alternative_card_ids": frame.get("alternativeCardIds") or [],
                },
                "meta": {
                    "mode": frame["mode"],
                    "pipeline": frame["pipeline"],
                    "detected_count": frame["detectedCount"],
                    "elapsed_ms": frame["elapsedMs"],
                },
                "predictions": make_label_studio_prediction(frame, width, height),
            }
        )

        coco_images.append(
            {
                "id": frame["index"],
                "file_name": f"images/{image_name}",
                "width": width,
                "height": height,
            }
        )
        if frame.get("quad"):
            polygon, bbox, area = coco_geometry(frame["quad"], width, height)
            coco_annotations.append(
                {
                    "id": annotation_id,
                    "image_id": frame["index"],
                    "category_id": 1,
                    "segmentation": [polygon],
                    "bbox": bbox,
                    "area": area,
                    "iscrowd": 0,
                    "score": frame.get("segmentationConfidence"),
                    "attributes": {
                        "source": "tcger-ios-vision-recording",
                        "recorded_match_id": frame.get("bestMatchCardId"),
                        "recorded_match_name": frame.get("bestMatchName"),
                        "recorded_match_confidence": frame.get("confidence"),
                    },
                }
            )
            annotation_id += 1

        review_rows.append(
            {
                "frame_index": frame["index"],
                "image": f"images/{image_name}",
                "recorded_identified": frame["identified"],
                "recorded_match_id": frame.get("bestMatchCardId") or "",
                "recorded_match_name": frame.get("bestMatchName") or "",
                "recorded_confidence": frame.get("confidence") or "",
                "segmentation_confidence": frame.get("segmentationConfidence") or "",
                "expected_card_id": "",
                "expected_no_match": "",
                "geometry_accepted": "",
                "notes": "",
            }
        )

    (output / "label-studio-tasks.json").write_text(
        json.dumps(tasks, indent=2, ensure_ascii=False) + "\n"
    )
    (output / "label-studio-config.xml").write_text(LABEL_CONFIG)
    (output / "coco-predictions.json").write_text(
        json.dumps(
            {
                "info": {
                    "description": "TCGer iOS scanner recording predictions",
                    "source": manifest["summary"],
                    "warning": "Predictions are not human-reviewed ground truth.",
                },
                "images": coco_images,
                "annotations": coco_annotations,
                "categories": [{"id": 1, "name": "card", "supercategory": "card"}],
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n"
    )
    with (output / "review.csv").open("w", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=list(review_rows[0]))
        writer.writeheader()
        writer.writerows(review_rows)

    matched_count = sum(bool(frame["identified"]) for frame in frames)
    readme = f"""# TCGer scanner recording annotation bundle

Generated from {recording_root.name}.

- Frames: {len(frames)}
- Recorded identity matches: {matched_count}
- Vision geometry predictions: {len(coco_annotations)}
- Game: {manifest["summary"]["mode"]}
- Pipeline: {manifest["summary"]["pipeline"]}

The geometry and identity fields are model predictions, not reviewed labels.
Use review_status, expected_card_id, and notes to create ground truth.

## Label Studio

1. Install/start Label Studio separately.
2. Enable local file serving with:

   LABEL_STUDIO_LOCAL_FILES_SERVING_ENABLED=true

   LABEL_STUDIO_LOCAL_FILES_DOCUMENT_ROOT={local_files_root.resolve()}

3. Create a project and paste label-studio-config.xml into its labeling setup.
4. Import label-studio-tasks.json.

## COCO / Roboflow

coco-predictions.json contains one card polygon and bounding box per Vision
quadrilateral. Import it with the images folder, then review every annotation
before using it as training truth.
"""
    (output / "README.md").write_text(readme)

    print(
        json.dumps(
            {
                "output": str(output.resolve()),
                "frames": len(frames),
                "recorded_matches": matched_count,
                "geometry_predictions": len(coco_annotations),
            },
            indent=2,
        )
    )


def main() -> None:
    args = parse_args()
    output = args.output.expanduser().resolve()
    local_files_root = (
        args.local_files_root.expanduser().resolve()
        if args.local_files_root
        else output.parent
    )
    if local_files_root != output and local_files_root not in output.parents:
        raise ValueError("--output must be inside --local-files-root")

    recording = args.recording.expanduser().resolve()
    if recording.is_file():
        if recording.suffix.lower() != ".zip":
            raise ValueError("Recording file must be a .zip archive")
        with tempfile.TemporaryDirectory(prefix="tcger-scanner-labels-") as temporary:
            extracted = Path(temporary)
            safe_extract(recording, extracted)
            export_bundle(find_recording_root(extracted), output, local_files_root)
    else:
        export_bundle(find_recording_root(recording), output, local_files_root)


if __name__ == "__main__":
    main()
