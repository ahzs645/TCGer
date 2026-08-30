// Apple Vision text recognition over a list of image crops, emitting one JSON
// line per image: {"path":…,"lines":[{"text":…,"confidence":…,"box":[x,y,w,h]}]}.
//
// Production-parity OCR for the camera-corpus pipeline: the iOS scanner reads
// titles with VNRecognizeTextRequest, so pseudo-labels derived here behave
// like the app. Boxes are normalized, origin bottom-left (Vision convention).
//
// Usage:
//   swift tools/camera-corpus/ocr-titles.swift [--fast] [--languages en,ja] < paths.txt > ocr.jsonl
//   swift tools/camera-corpus/ocr-titles.swift image1.jpg image2.jpg …
import Foundation
import Vision
import ImageIO

var arguments = Array(CommandLine.arguments.dropFirst())
var level: VNRequestTextRecognitionLevel = .accurate
var languages: [String] = ["en-US"]
var paths: [String] = []
while !arguments.isEmpty {
    let argument = arguments.removeFirst()
    switch argument {
    case "--fast": level = .fast
    case "--languages":
        guard !arguments.isEmpty else { fatalError("--languages needs a value") }
        languages = arguments.removeFirst().split(separator: ",").map(String.init)
    default: paths.append(argument)
    }
}
if paths.isEmpty {
    while let line = readLine(strippingNewline: true) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { paths.append(trimmed) }
    }
}

let encoder = JSONEncoder()
struct Line: Encodable { let text: String; let confidence: Float; let box: [Double] }
struct Record: Encodable { let path: String; let lines: [Line]; let error: String? }

func recognize(_ path: String) -> Record {
    let url = URL(fileURLWithPath: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        return Record(path: path, lines: [], error: "unreadable")
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = level
    request.usesLanguageCorrection = false
    request.recognitionLanguages = languages
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do {
        try handler.perform([request])
    } catch {
        return Record(path: path, lines: [], error: "\(error)")
    }
    let lines: [Line] = (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return Line(
            text: candidate.string,
            confidence: candidate.confidence,
            box: [box.origin.x, box.origin.y, box.size.width, box.size.height]
        )
    }
    return Record(path: path, lines: lines, error: nil)
}

let output = FileHandle.standardOutput
for path in paths {
    let record = recognize(path)
    if let data = try? encoder.encode(record) {
        output.write(data)
        output.write("\n".data(using: .utf8)!)
    }
}
