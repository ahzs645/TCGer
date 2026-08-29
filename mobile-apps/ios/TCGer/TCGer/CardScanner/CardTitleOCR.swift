import CoreGraphics
import Foundation
@preconcurrency import Vision

/// Reads the title band of a normalized card crop. The embedding strategy uses
/// exact catalog-name matches only; arbitrary OCR text never becomes a result.
nonisolated struct CardTitleOCR {
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

    /// Repairs a single OCR substitution only when the visual shortlist has
    /// exactly one plausible catalog spelling. This is deliberately not a
    /// catalog-wide fuzzy search: the embedding must first put the card in the
    /// high-confidence visual shortlist, and short/noisy strings are excluded.
    /// For example, Vision's `Thrór's Man` can confirm the already retrieved
    /// `Thrór's Map`; it cannot pull an unrelated name into consideration.
    static func singleEditCorrection(
        for candidates: [Candidate],
        shortlistNames: [String]
    ) -> Candidate? {
        let canonicalNames = Dictionary(
            shortlistNames.map { (normalizedName($0), $0) },
            uniquingKeysWith: { first, _ in first }
        )
        var corrections: [String: Candidate] = [:]
        for candidate in candidates where candidate.confidence >= 0.8 {
            let observed = normalizedName(candidate.text)
            guard observed.count >= 8 else { continue }
            for (canonical, displayName) in canonicalNames {
                guard canonical.count >= 8,
                      editDistanceAtMostOne(observed, canonical),
                      observed != canonical
                else { continue }
                corrections[canonical] = Candidate(
                    text: displayName,
                    confidence: candidate.confidence
                )
            }
        }
        guard corrections.count == 1 else { return nil }
        return corrections.values.first
    }

    private static func editDistanceAtMostOne(_ lhs: String, _ rhs: String) -> Bool {
        let left = Array(lhs)
        let right = Array(rhs)
        guard abs(left.count - right.count) <= 1 else { return false }
        var leftIndex = 0
        var rightIndex = 0
        var edits = 0
        while leftIndex < left.count, rightIndex < right.count {
            if left[leftIndex] == right[rightIndex] {
                leftIndex += 1
                rightIndex += 1
                continue
            }
            edits += 1
            if edits > 1 { return false }
            if left.count > right.count {
                leftIndex += 1
            } else if right.count > left.count {
                rightIndex += 1
            } else {
                leftIndex += 1
                rightIndex += 1
            }
        }
        edits += (left.count - leftIndex) + (right.count - rightIndex)
        return edits <= 1
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
