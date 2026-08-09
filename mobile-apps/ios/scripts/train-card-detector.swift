import CreateML
import Foundation

guard CommandLine.arguments.count >= 3 else {
    FileHandle.standardError.write(Data(
        "usage: train-card-detector.swift DATASET_ROOT OUTPUT_MODEL [ITERATIONS]\n".utf8
    ))
    exit(2)
}

let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let iterations = CommandLine.arguments.count >= 4
    ? Int(CommandLine.arguments[3]) ?? 500
    : 500

func source(_ split: String) -> MLObjectDetector.DataSource {
    let directory = root.appendingPathComponent(split, isDirectory: true)
    return .directoryWithImages(
        at: directory.appendingPathComponent("images", isDirectory: true),
        annotationFile: directory.appendingPathComponent("annotations.json")
    )
}

let training = source("train")
let validation = source("valid")
let parameters = MLObjectDetector.ModelParameters(
    validation: .dataSource(validation),
    batchSize: 16,
    maxIterations: iterations,
    gridSize: CGSize(width: 13, height: 13),
    algorithm: .darknetYolo
)

print("Training one-class card detector for \(iterations) iterations…")
let detector = try MLObjectDetector(
    trainingData: training,
    parameters: parameters,
    annotationType: .boundingBox(units: .pixel, origin: .topLeft, anchor: .center)
)
print("Training metrics: \(detector.trainingMetrics)")
print("Validation metrics: \(detector.validationMetrics)")

let testMetrics = detector.evaluation(on: source("test"))
print("Test metrics: \(testMetrics)")

// Present only when the dataset was prepared with --tight-crops: measures the
// borderless-card regime separately from scene localization.
let tightTest = root.appendingPathComponent("tight-test", isDirectory: true)
if FileManager.default.fileExists(atPath: tightTest.path) {
    let tightMetrics = detector.evaluation(on: source("tight-test"))
    print("Tight-test metrics: \(tightMetrics)")
}

let metadata = MLModelMetadata(
    author: "TCGer",
    shortDescription: "Single-class trading card detector trained from Roboflow archives",
    license: nil,
    version: "1.0",
    additional: [
        "class": "card",
        "iterations": String(iterations),
    ]
)
try detector.write(to: output, metadata: metadata)
print("Wrote \(output.path)")
