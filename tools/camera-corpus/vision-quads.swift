// Apple Vision card localization, as the iOS scanner does it, for offline
// benchmarking: VNDetectDocumentSegmentationRequest first, then
// VNDetectRectanglesRequest, optionally gated by a Core ML card detector box
// (the app's YOLO11s CardDetector.mlpackage), emitting one JSON line per
// image with every candidate quad in normalized bottom-left coordinates.
//
// Usage:
//   swift tools/camera-corpus/vision-quads.swift [--detector CardDetector.mlmodelc] < paths.txt
// Output line: {"path":…,"detector":[x,y,w,h]|null,"document":[[x,y]x4]|null,"rectangles":[[[x,y]x4],…]}
import CoreML
import Foundation
import ImageIO
import Vision

var arguments = Array(CommandLine.arguments.dropFirst())
var detectorPath: String?
var paths: [String] = []
while !arguments.isEmpty {
    let argument = arguments.removeFirst()
    if argument == "--detector" { detectorPath = arguments.removeFirst() } else { paths.append(argument) }
}
if paths.isEmpty {
    while let line = readLine(strippingNewline: true) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { paths.append(trimmed) }
    }
}

var detectorModel: VNCoreMLModel?
if let detectorPath {
    let url = URL(fileURLWithPath: detectorPath)
    let compiled = url.pathExtension == "mlmodelc" ? url : try! MLModel.compileModel(at: url)
    detectorModel = try? VNCoreMLModel(for: try! MLModel(contentsOf: compiled))
}

struct Output: Encodable {
    let path: String
    let detector: [Double]?
    let detectorConfidence: Double?
    /// Every detector box, [x, y, w, h, confidence], normalized bottom-left.
    let detections: [[Double]]
    let document: [[Double]]?
    let documentConfidence: Double?
    let rectangles: [[[Double]]]
}

func quad(_ o: VNRectangleObservation) -> [[Double]] {
    [o.topLeft, o.topRight, o.bottomRight, o.bottomLeft].map { [Double($0.x), Double($0.y)] }
}

let encoder = JSONEncoder()
for path in paths {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { continue }
    let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
    var detectorBox: [Double]?
    var detectorConfidence: Double?
    var detections: [[Double]] = []
    if let detectorModel {
        let request = VNCoreMLRequest(model: detectorModel)
        request.imageCropAndScaleOption = .scaleFit
        try? handler.perform([request])
        for observation in (request.results as? [VNRecognizedObjectObservation]) ?? [] {
            let b = observation.boundingBox
            detections.append([Double(b.origin.x), Double(b.origin.y), Double(b.size.width), Double(b.size.height), Double(observation.confidence)])
        }
        // Mirror CardObjectDetector.indicesSuppressingNestedBoxes: a detection
        // lying >= 80% inside a larger detection is an art panel, not a card.
        let observations = (request.results as? [VNRecognizedObjectObservation]) ?? []
        let topLevel = observations.filter { candidate in
            let box = candidate.boundingBox.standardized
            let area = box.width * box.height
            guard area > 0 else { return false }
            return !observations.contains { other in
                let container = other.boundingBox.standardized
                guard container.width * container.height > area else { return false }
                let overlap = box.intersection(container)
                guard !overlap.isNull else { return false }
                return overlap.width * overlap.height >= area * 0.8
            }
        }
        if let best = topLevel.max(by: { $0.confidence < $1.confidence }) {
            let b = best.boundingBox
            detectorBox = [Double(b.origin.x), Double(b.origin.y), Double(b.size.width), Double(b.size.height)]
            detectorConfidence = Double(best.confidence)
        }
    }
    let document = VNDetectDocumentSegmentationRequest()
    let rectangles = VNDetectRectanglesRequest()
    rectangles.maximumObservations = 5
    rectangles.minimumConfidence = 0.5
    rectangles.minimumAspectRatio = 0.4
    rectangles.maximumAspectRatio = 1.0
    rectangles.minimumSize = 0.15
    try? handler.perform([document, rectangles])
    let doc = document.results?.first
    let output = Output(
        path: path,
        detector: detectorBox,
        detectorConfidence: detectorConfidence,
        detections: detections,
        document: doc.map(quad),
        documentConfidence: doc.map { Double($0.confidence) },
        rectangles: (rectangles.results ?? []).map(quad)
    )
    if let data = try? encoder.encode(output) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    }
}
