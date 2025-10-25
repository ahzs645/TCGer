import CoreGraphics
import Foundation
@preconcurrency import Vision

final class PokemonTextScannerStrategy: ScanStrategy {
    private struct OCRCandidate {
        let text: String
        let confidence: Double
    }

    let kind: ScanStrategyKind = .textOCR
    let supportsLiveScanning: Bool = true

    func supports(_ mode: ScanMode) -> Bool {
        mode == .pokemon
    }

    func scan(
        image: CGImage,
        context: CardScannerContext,
        apiService: APIService
    ) async throws -> CardScanResult? {
        guard supports(context.mode) else {
            throw CardScannerError.ineligibleMode
        }

        guard let token = context.authToken else {
            throw CardScannerError.missingAuthToken
        }

        let candidates = try await recognizeText(in: image)
        guard !candidates.isEmpty else {
            return nil
        }

        var scanCandidates: [CardScanCandidate] = []

        for (index, candidate) in candidates.prefix(4).enumerated() {
            let sanitized = sanitizeCandidate(candidate.text)
            guard !sanitized.isEmpty else { continue }

            do {
                let searchResponse = try await apiService.searchCards(
                    config: context.serverConfiguration,
                    token: token,
                    query: sanitized,
                    game: context.mode.tcgGame
                )

                let trimmedCards = searchResponse.cards.prefix(5)
                guard !trimmedCards.isEmpty else { continue }

                for (offset, card) in trimmedCards.enumerated() {
                    let details = CardDetails(card: card)
                    var score = candidate.confidence + 0.25
                    score -= Double(index) * 0.1
                    score -= Double(offset) * 0.05
                    score = min(1.0, max(0.05, score))

                    let confidence = CardScanConfidence(
                        score: score,
                        reason: "OCR hit \"\(sanitized)\""
                    )

                    let debugInfo: [String: String] = [
                        "ocrText": sanitized,
                        "ocrConfidence": String(format: "%.2f", candidate.confidence),
                        "resultRank": "\(offset + 1)"
                    ]

                    scanCandidates.append(
                        CardScanCandidate(
                            details: details,
                            confidence: confidence,
                            originatingStrategy: kind,
                            debugInfo: debugInfo
                        )
                    )
                }

                if !scanCandidates.isEmpty {
                    break
                }
            } catch {
                throw CardScannerError.underlying(error)
            }
        }

        guard let primary = scanCandidates.first else {
            return nil
        }

        return CardScanResult(
            mode: context.mode,
            capturedImage: image,
            primary: primary,
            alternatives: Array(scanCandidates.dropFirst()),
            elapsed: 0
        )
    }

    private func recognizeText(in image: CGImage) async throws -> [OCRCandidate] {
        try await withCheckedThrowingContinuation { continuation in
            let request = VNRecognizeTextRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                guard
                    let observations = request.results as? [VNRecognizedTextObservation]
                else {
                    continuation.resume(returning: [])
                    return
                }

                let mapped: [OCRCandidate] = observations.compactMap { observation in
                    guard let topCandidate = observation.topCandidates(1).first else { return nil }
                    let normalized = topCandidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !normalized.isEmpty else { return nil }
                    return OCRCandidate(
                        text: normalized,
                        confidence: Double(topCandidate.confidence)
                    )
                }
                .sorted { $0.confidence > $1.confidence }

                continuation.resume(returning: mapped)
            }

            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            request.customWords = ["Pokémon", "EX", "GX", "VSTAR", "Trainer", "Energy"]
            request.recognitionLanguages = ["en-US"]

            let handler = VNImageRequestHandler(cgImage: image, options: [:])

            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    private func sanitizeCandidate(_ string: String) -> String {
        var result = string
        if let delimiterRange = result.range(of: "#") {
            result.removeSubrange(delimiterRange.lowerBound..<result.endIndex)
        }
        result = result.trimmingCharacters(in: .whitespacesAndNewlines)
        result = result.replacingOccurrences(of: "—", with: "-")

        if result.count <= 2 {
            return ""
        }

        return result
    }
}
