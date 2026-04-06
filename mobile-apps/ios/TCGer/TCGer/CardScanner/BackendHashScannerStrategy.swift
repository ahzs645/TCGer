import CoreGraphics
import Foundation
import UIKit

final class BackendHashScannerStrategy: ScanStrategy {
    let kind: ScanStrategyKind = .serverHash
    let supportsLiveScanning: Bool = false

    func supports(_ mode: ScanMode) -> Bool {
        switch mode {
        case .pokemon, .yugioh, .mtg:
            return true
        }
    }

    func scan(
        image: CGImage,
        context: CardScannerContext,
        source: ScanInvocationKind,
        apiService: APIService
    ) async throws -> CardScanResult? {
        guard supports(context.mode) else {
            throw CardScannerError.ineligibleMode
        }

        guard source == .photoCapture else {
            return nil
        }

        guard !context.serverConfiguration.isDemoMode else {
            return nil
        }

        guard let token = context.authToken else {
            throw CardScannerError.missingAuthToken
        }

        guard let imageData = UIImage(cgImage: image).jpegData(compressionQuality: 0.88) else {
            throw CardScannerError.underlying(
                NSError(
                    domain: "TCGer.CardScanner",
                    code: -1,
                    userInfo: [NSLocalizedDescriptionKey: "Unable to encode the captured image for upload."]
                )
            )
        }

        let response = try await apiService.scanCardImage(
            config: context.serverConfiguration,
            token: token,
            imageData: imageData,
            tcg: context.mode.tcgGame,
            saveDebugCapture: context.saveDebugCapture,
            captureSource: "ios-card-scanner",
            captureNotes: context.captureNotes
        )

        let orderedMatches: [APIService.ScanMatchResponse] = {
            var seen = Set<String>()
            var items: [APIService.ScanMatchResponse] = []

            func append(_ candidate: APIService.ScanMatchResponse?) {
                guard let candidate else { return }
                let key = "\(candidate.tcg.rawValue):\(candidate.externalId)"
                guard seen.insert(key).inserted else { return }
                items.append(candidate)
            }

            append(response.match)
            for candidate in response.candidates {
                append(candidate)
            }
            return items
        }()

        guard let primaryPayload = response.match ?? orderedMatches.first else {
            return nil
        }

        let candidates = orderedMatches.map { payload in
            makeCandidate(from: payload, meta: response.meta)
        }

        guard let primary = candidates.first(where: {
            $0.details.identity.id == primaryPayload.externalId && $0.details.identity.game == primaryPayload.tcg
        }) ?? candidates.first else {
            return nil
        }

        let alternatives = candidates.filter { candidate in
            candidate.id != primary.id
        }

        return CardScanResult(
            mode: context.mode,
            capturedImage: image,
            primary: primary,
            alternatives: alternatives,
            elapsed: 0,
            debugCapture: response.debugCapture,
            debugCaptureError: response.debugCaptureError
        )
    }

    private func makeCandidate(
        from payload: APIService.ScanMatchResponse,
        meta: APIService.ScanMetaResponse?
    ) -> CardScanCandidate {
        let details = CardDetails(
            identity: CardIdentity(
                id: payload.externalId,
                name: payload.name,
                game: payload.tcg,
                setCode: payload.setCode,
                setName: payload.setName
            ),
            rarity: payload.rarity,
            imageURL: payload.imageUrl.flatMap(URL.init(string:)),
            price: nil
        )

        var reasonParts = ["Server pHash distance \(payload.distance)"]
        if let variant = meta?.variantUsed, !variant.isEmpty {
            reasonParts.append(variant)
        }
        if let threshold = meta?.thresholdUsed {
            reasonParts.append("threshold \(threshold)")
        }

        var debugInfo: [String: String] = [
            "distance": String(payload.distance)
        ]
        if let variant = meta?.variantUsed {
            debugInfo["variant"] = variant
        }
        if let threshold = meta?.thresholdUsed {
            debugInfo["threshold"] = String(threshold)
        }
        if let corrected = meta?.perspectiveCorrected {
            debugInfo["perspectiveCorrected"] = corrected ? "true" : "false"
        }
        if let quality = meta?.quality {
            if let score = quality.score {
                debugInfo["quality"] = String(format: "%.0f%%", score * 100)
            }
            if let contrast = quality.contrast {
                debugInfo["contrast"] = String(format: "%.2f", contrast)
            }
        }
        if let contourConfidence = meta?.contourConfidence {
            debugInfo["contourConfidence"] = String(format: "%.2f", contourConfidence)
        }
        if let cropAspectRatio = meta?.cropAspectRatio {
            debugInfo["cropAspect"] = String(format: "%.3f", cropAspectRatio)
        }
        if let shortlistSize = meta?.shortlistSize {
            debugInfo["shortlist"] = String(shortlistSize)
        }
        if let totalMs = meta?.timings?.totalMs {
            debugInfo["totalMs"] = String(format: "%.0f", totalMs)
        }

        return CardScanCandidate(
            details: details,
            confidence: CardScanConfidence(score: payload.confidence, reason: reasonParts.joined(separator: " • ")),
            originatingStrategy: kind,
            debugInfo: debugInfo
        )
    }
}
