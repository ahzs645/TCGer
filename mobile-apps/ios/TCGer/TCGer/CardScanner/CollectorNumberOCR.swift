import CoreGraphics
import Foundation
@preconcurrency import Vision

/// Reads the printed collector number from a card footer (Apple Vision, free,
/// on-device, ANE). Mirrors the browser collector-number tiebreaker: the
/// embedding gives a top-K shortlist, and the in-set collector number — keyed
/// (setCode, collectorNumber) from each candidate's id — decides among near
/// twins. Only "NNN/NNN" pairs are returned; bare digits are too noisy to trust
/// (a stray number was observed promoting the wrong same-number card).
struct CollectorNumberOCR {
    /// Footer crop region as a fraction of the (top-left origin) card image.
    private let footerTop: CGFloat = 0.88
    private let footerHeight: CGFloat = 0.11
    private let upscale: CGFloat = 4

    /// Footer OCR output: clean "NNN/NNN" pair numbers, long digit runs
    /// ("079/202" read with the slash dropped arrives as "079202"), and
    /// letter-prefixed promo codes ("SWSH204", "DP11") which never print as
    /// NNN/NNN pairs and were previously unconfirmable.
    struct FooterReading {
        let pairNumbers: [String]
        let digitRuns: [String]
        let promoCodes: [String]
        /// True when this reading came from the `.fast` recognition pipeline.
        /// A fast reading that fails to confirm any shortlist candidate gets
        /// one `.accurate` re-read — fast can be conclusive-but-wrong (a
        /// garbled pair suppresses the fallback yet matches nothing).
        var usedFastPath: Bool = false

        var isEmpty: Bool {
            pairNumbers.isEmpty && digitRuns.isEmpty && promoCodes.isEmpty
        }

        /// A reading strong enough for the fast pass to stand on its own.
        /// Bare digit runs are the noisy class — a fast misread that yields
        /// only runs must not suppress the accurate fallback, or a
        /// confirmable footer silently loses its OCR rescue (measured: one
        /// labeled accept lost when fast+lean combined on exactly this).
        var isConclusive: Bool {
            !pairNumbers.isEmpty || !promoCodes.isEmpty
        }
    }

    /// Returns normalised "NNN/NNN" collector numbers found in the footer.
    func readPairNumbers(from image: CGImage) -> [String] {
        readFooter(from: image).pairNumbers
    }

    /// Reads the footer once and extracts both pair numbers and digit runs.
    /// With `ScannerPerfOptions.isFastFooterOCREnabled`, tries the much
    /// cheaper `.fast` recognition pipeline first and falls back to
    /// `.accurate` only when it extracted nothing usable — the regex layer is
    /// the error corrector for a fixed-format numeric read.
    func readFooter(from image: CGImage) -> FooterReading {
        guard let footer = cropFooter(image) else {
            return FooterReading(pairNumbers: [], digitRuns: [], promoCodes: [])
        }
        if ScannerPerfOptions.isFastFooterOCREnabled {
            // Lean strips apply to the FAST pass only: it reads the unscaled
            // strip with a raised floor (Vision derives its working
            // resolution from `minimumTextHeight`, so this is the actual
            // speed lever). The `.accurate` pass always keeps the 4x upscale
            // — replay measured labeled accepts lost when accurate also went
            // lean, so accuracy-bearing reads stay byte-identical to the
            // original pipeline.
            let lean = ScannerPerfOptions.isLeanOCRStripsEnabled
            if let fastStrip = lean ? cropFooter(image, upscaled: false) : footer {
                var fast = recognize(
                    fastStrip,
                    level: .fast,
                    minimumTextHeight: lean ? 0.1 : 0.02
                )
                if fast.isConclusive {
                    fast.usedFastPath = true
                    return fast
                }
            }
        }
        return recognize(footer, level: .accurate, minimumTextHeight: 0.02)
    }

    /// Unconditional `.accurate` read, used to rescue a fast-path reading
    /// that confirmed nothing.
    func readFooterAccurate(from image: CGImage) -> FooterReading {
        guard let footer = cropFooter(image) else {
            return FooterReading(pairNumbers: [], digitRuns: [], promoCodes: [])
        }
        return recognize(footer, level: .accurate, minimumTextHeight: 0.02)
    }

    private func recognize(
        _ footer: CGImage,
        level: VNRequestTextRecognitionLevel,
        minimumTextHeight: Float
    ) -> FooterReading {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = level
        request.usesLanguageCorrection = false
        // The default floor is ~1/32; tiny collector-number digits need it
        // lowered on upscaled strips.
        request.minimumTextHeight = minimumTextHeight

        let handler = VNImageRequestHandler(cgImage: footer, orientation: .up, options: [:])
        try? handler.perform([request])

        let text = (request.results ?? [])
            .compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: " ")
        return FooterReading(
            pairNumbers: Self.extractPairNumbers(text),
            digitRuns: Self.extractDigitRuns(text),
            promoCodes: Self.extractPromoCodes(text)
        )
    }

    private func cropFooter(_ image: CGImage, upscaled: Bool = true) -> CGImage? {
        let w = CGFloat(image.width)
        let h = CGFloat(image.height)
        let rect = CGRect(x: 0, y: h * footerTop, width: w, height: h * footerHeight)
            .integral
        guard let strip = image.cropping(to: rect) else { return nil }
        if !upscaled { return strip }

        // Upscale to help recognition of small digits.
        let outW = Int(CGFloat(strip.width) * upscale)
        let outH = Int(CGFloat(strip.height) * upscale)
        guard outW > 0, outH > 0,
              let ctx = CGContext(
                data: nil,
                width: outW,
                height: outH,
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
              )
        else { return strip }
        ctx.interpolationQuality = .high
        ctx.draw(strip, in: CGRect(x: 0, y: 0, width: outW, height: outH))
        return ctx.makeImage() ?? strip
    }

    /// Extract "NNN/NNN" pairs → normalised collector numbers (the part before the slash).
    static func extractPairNumbers(_ text: String) -> [String] {
        var results: [String] = []
        let pattern = #"(\d{1,4})\s*/\s*(\d{1,4})"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return results }
        let ns = text as NSString
        for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            if match.numberOfRanges >= 2 {
                results.append(normalize(ns.substring(with: match.range(at: 1))))
            }
        }
        return results
    }

    /// Extract letter-prefixed promo collector codes ("SWSH204", "DP 11",
    /// "XY-208") → normalised lowercase letters+digits ("swsh204", "dp11",
    /// "xy208"), matching `collectorNumber(fromCardId:)` for promo ids like
    /// "swshp-SWSH204". A stray extraction is harmless — it only matters when
    /// it exactly equals a shortlist candidate's own collector code.
    static func extractPromoCodes(_ text: String) -> [String] {
        let pattern = #"\b([A-Za-z]{2,5})\s*[-–]?\s*0*(\d{1,4})\b"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let ns = text as NSString
        return regex.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { match in
            let letters = ns.substring(with: match.range(at: 1)).lowercased()
            let digits = normalize(ns.substring(with: match.range(at: 2)))
            return letters + digits
        }
    }

    /// Extract long digit runs (5-8 digits): slash-less footer reads.
    static func extractDigitRuns(_ text: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: #"\d{5,8}"#) else { return [] }
        let ns = text as NSString
        return regex.matches(in: text, range: NSRange(location: 0, length: ns.length))
            .map { ns.substring(with: $0.range) }
    }

    /// True when a digit run has exactly the shape `0-padded number +
    /// 2-3 digit denominator` for the given (normalised, numeric) collector
    /// number — i.e. "NNN/NNN" with the slash dropped. Far stricter than a
    /// bare-number match; callers must additionally require that only one
    /// distinct shortlist number is confirmed before overriding the embedding.
    static func runsConfirm(number: String, in runs: [String]) -> Bool {
        guard !number.isEmpty, number.allSatisfy(\.isNumber) else { return false }
        guard let regex = try? NSRegularExpression(pattern: "^0{0,3}\(number)\\d{2,3}$") else {
            return false
        }
        return runs.contains { run in
            regex.firstMatch(in: run, range: NSRange(location: 0, length: (run as NSString).length)) != nil
        }
    }

    /// Strip leading zeros, lowercase — matches the index/externalId convention.
    static func normalize(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespaces).lowercased()
        let stripped = trimmed.drop(while: { $0 == "0" })
        return stripped.isEmpty ? (trimmed.isEmpty ? "" : "0") : String(stripped)
    }

    /// Parse the collector number from an externalId/cardId "SET-NUM".
    static func collectorNumber(fromCardId cardId: String) -> String? {
        guard let dash = cardId.firstIndex(of: "-") else { return nil }
        let num = cardId[cardId.index(after: dash)...]
        return num.isEmpty ? nil : normalize(String(num))
    }
}
