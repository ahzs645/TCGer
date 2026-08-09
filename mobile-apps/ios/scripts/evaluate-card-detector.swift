import CoreML
import Foundation
import ImageIO
@preconcurrency import Vision

// Standalone detector scorer for Create ML splits (images/ + annotations.json,
// center-anchored pixel boxes). Mirrors the app's CardObjectDetector: Vision,
// scaleFit, "card" label at confidence >= 0.50, best observation only. Use it
// to compare candidate .mlmodel files on the same split without rebuilding
// the app — e.g. the tight-test split that measures the borderless-crop
// regime the scene-only training data never covered.

guard CommandLine.arguments.count >= 3 else {
    FileHandle.standardError.write(Data(
        "usage: evaluate-card-detector.swift MODEL.mlmodel SPLIT_DIR [SPLIT_DIR...]\n".utf8
    ))
    exit(2)
}

let modelURL = URL(fileURLWithPath: CommandLine.arguments[1])
let compiledURL = try MLModel.compileModel(at: modelURL)
let configuration = MLModelConfiguration()
configuration.computeUnits = .all
let visionModel = try VNCoreMLModel(for: MLModel(contentsOf: compiledURL, configuration: configuration))

struct Annotation: Decodable {
    struct Coordinates: Decodable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double
    }
    let label: String
    let coordinates: Coordinates
}

struct Record: Decodable {
    let image: String
    let annotations: [Annotation]
}

func intersectionOverUnion(_ lhs: CGRect, _ rhs: CGRect) -> Double {
    let intersection = lhs.intersection(rhs)
    guard !intersection.isNull, intersection.width > 0, intersection.height > 0 else { return 0 }
    let intersectionArea = intersection.width * intersection.height
    let unionArea = lhs.width * lhs.height + rhs.width * rhs.height - intersectionArea
    guard unionArea > 0 else { return 0 }
    return Double(intersectionArea / unionArea)
}

for splitPath in CommandLine.arguments.dropFirst(2) {
    let splitURL = URL(fileURLWithPath: splitPath, isDirectory: true)
    let records = try JSONDecoder().decode(
        [Record].self,
        from: Data(contentsOf: splitURL.appendingPathComponent("annotations.json"))
    )
    let imagesURL = splitURL.appendingPathComponent("images", isDirectory: true)

    var processed = 0
    var detected = 0
    var ious: [Double] = []
    for record in records {
        let imageURL = imagesURL.appendingPathComponent(record.image)
        guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { continue }
        processed += 1

        let request = VNCoreMLRequest(model: visionModel)
        request.imageCropAndScaleOption = .scaleFit
        try? VNImageRequestHandler(cgImage: image, orientation: .up).perform([request])
        let best = (request.results as? [VNRecognizedObjectObservation] ?? [])
            .filter { observation in
                observation.labels.contains {
                    $0.identifier.caseInsensitiveCompare("card") == .orderedSame && $0.confidence >= 0.50
                }
            }
            .max { ($0.labels.first?.confidence ?? 0) < ($1.labels.first?.confidence ?? 0) }
        guard let best else { continue }
        detected += 1

        let bounds = best.boundingBox.standardized
        let predicted = CGRect(
            x: bounds.minX * CGFloat(image.width),
            y: (1 - bounds.maxY) * CGFloat(image.height),
            width: bounds.width * CGFloat(image.width),
            height: bounds.height * CGFloat(image.height)
        )
        let bestIoU = record.annotations.map { annotation in
            intersectionOverUnion(predicted, CGRect(
                x: annotation.coordinates.x - annotation.coordinates.width / 2,
                y: annotation.coordinates.y - annotation.coordinates.height / 2,
                width: annotation.coordinates.width,
                height: annotation.coordinates.height
            ))
        }.max() ?? 0
        ious.append(bestIoU)
    }

    let meanIoU = ious.isEmpty ? 0 : ious.reduce(0, +) / Double(ious.count)
    let iou50 = ious.filter { $0 >= 0.5 }.count
    let iou75 = ious.filter { $0 >= 0.75 }.count
    print("""
    \(splitURL.lastPathComponent): images \(processed), detected \(detected) \
    (\(String(format: "%.1f", processed > 0 ? 100 * Double(detected) / Double(processed) : 0))%), \
    meanIoU \(String(format: "%.3f", meanIoU)), \
    IoU>=0.50 \(iou50) (\(String(format: "%.1f", processed > 0 ? 100 * Double(iou50) / Double(processed) : 0))%), \
    IoU>=0.75 \(iou75) (\(String(format: "%.1f", processed > 0 ? 100 * Double(iou75) / Double(processed) : 0))%)
    """)
}
