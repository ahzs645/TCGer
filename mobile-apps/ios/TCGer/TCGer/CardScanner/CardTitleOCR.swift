import CoreGraphics
import Foundation
@preconcurrency import Vision

/// Reads the title band of a normalized card crop. The embedding strategy uses
/// exact catalog-name matches only; arbitrary OCR text never becomes a result.
struct CardTitleOCR {
    struct Candidate: Sendable {
        let text: String
        let confidence: Double
    }

    private let titleHeight: CGFloat = 0.24
    private let upscale: CGFloat = 2

    func read(from image: CGImage) -> [Candidate] {
        guard let title = cropTitle(image) else { return [] }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["en-US"]
        request.customWords = ["Pokémon", "ex", "EX", "GX", "V", "VMAX", "VSTAR"]
        request.minimumTextHeight = 0.025

        try? VNImageRequestHandler(cgImage: title, orientation: .up).perform([request])
        let observations = (request.results ?? []).sorted {
            if abs($0.boundingBox.midY - $1.boundingBox.midY) > 0.025 {
                return $0.boundingBox.midY > $1.boundingBox.midY
            }
            return $0.boundingBox.minX < $1.boundingBox.minX
        }
        let raw = observations.compactMap { observation -> Candidate? in
            guard let recognized = observation.topCandidates(1).first else { return nil }
            let text = recognized.string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            return Candidate(text: text, confidence: Double(recognized.confidence))
        }

        // Vision occasionally splits a suffix such as "ex" into its own box.
        // Adjacent combinations let "Charizard" + "ex" match the exact
        // catalog name without fuzzy matching unrelated OCR noise.
        var candidates = raw
        for index in raw.indices.dropLast() {
            let next = raw.index(after: index)
            candidates.append(Candidate(
                text: raw[index].text + " " + raw[next].text,
                confidence: min(raw[index].confidence, raw[next].confidence)
            ))
        }
        return candidates
    }

    static func normalizedName(_ value: String) -> String {
        value
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US"))
            .unicodeScalars
            .filter(CharacterSet.alphanumerics.contains)
            .map(String.init)
            .joined()
            .lowercased()
    }

    private func cropTitle(_ image: CGImage) -> CGImage? {
        let width = CGFloat(image.width)
        let height = CGFloat(image.height)
        let rect = CGRect(x: 0, y: 0, width: width, height: height * titleHeight).integral
        guard let strip = image.cropping(to: rect) else { return nil }
        let outputWidth = Int(CGFloat(strip.width) * upscale)
        let outputHeight = Int(CGFloat(strip.height) * upscale)
        guard outputWidth > 0,
              outputHeight > 0,
              let context = CGContext(
                data: nil,
                width: outputWidth,
                height: outputHeight,
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
              )
        else { return strip }
        context.interpolationQuality = .high
        context.draw(strip, in: CGRect(x: 0, y: 0, width: outputWidth, height: outputHeight))
        return context.makeImage() ?? strip
    }
}
