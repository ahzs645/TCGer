#!/usr/bin/env python3
"""Create the deterministic Android fp32 ArcFace ONNX from the web fp16 graph.

Requires the `onnx` Python package. The conversion preserves the source fp16
initializer values; it only expands their storage/arithmetic type and removes
the graph's input/output Cast pair.
"""

import argparse
import hashlib
from pathlib import Path

import onnx
from onnx import TensorProto, numpy_helper

SOURCE_SHA256 = "a5d867cc0b2b16a91ee7f12106bb9b57a3ab8cd752352dbb87db53d177abd2b5"
OUTPUT_SHA256 = "1f1af50e30c5ce05d8b2964c745afed2c35df0ebb84aa019dc5abd216e0bc43a"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if sha256(args.source) != SOURCE_SHA256:
        raise SystemExit("source ONNX SHA-256 does not match the calibrated web model")

    model = onnx.load(args.source)
    for index, tensor in enumerate(model.graph.initializer):
        if tensor.data_type == TensorProto.FLOAT16:
            expanded = numpy_helper.to_array(tensor).astype("float32")
            model.graph.initializer[index].CopyFrom(numpy_helper.from_array(expanded, tensor.name))
    for info in model.graph.value_info:
        if info.type.tensor_type.elem_type == TensorProto.FLOAT16:
            info.type.tensor_type.elem_type = TensorProto.FLOAT

    input_cast = next(
        node for node in model.graph.node if node.op_type == "Cast" and node.input[0] == "pixel_values"
    )
    cast_output = input_cast.output[0]
    for node in model.graph.node:
        for index, name in enumerate(node.input):
            if name == cast_output:
                node.input[index] = "pixel_values"
    model.graph.node.remove(input_cast)

    output_cast = next(
        node for node in model.graph.node if node.op_type == "Cast" and node.output[0] == "embedding"
    )
    source_output = output_cast.input[0]
    producer = next(node for node in model.graph.node if source_output in node.output)
    for index, name in enumerate(producer.output):
        if name == source_output:
            producer.output[index] = "embedding"
    model.graph.node.remove(output_cast)

    onnx.checker.check_model(model)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, args.output)
    actual = sha256(args.output)
    if actual != OUTPUT_SHA256:
        raise SystemExit(f"output SHA-256 {actual} does not match {OUTPUT_SHA256}")
    print(f"wrote {args.output} ({args.output.stat().st_size} bytes, SHA-256 {actual})")


if __name__ == "__main__":
    main()
