import CoreGraphics
import Foundation

/// Scanner strategy using artwork fingerprint + HSV histogram matching.
///
/// Uses Vision rectangle detection (existing CardCropper) for card localization,
/// then computes artwork fingerprint + HSV histogram for identification against
/// a preloaded database of 21,900 Pokemon card fingerprints.
///
/// Combined score: 85% artwork cosine similarity + 15% HSV cosine similarity.
/// Reduces matching ambiguity from 77% to 53% compared to artwork-only matching.
final class ArtworkFingerprintScannerStrategy: ScanStrategy {
    private enum Config {
        static let minimumSimilarity: Float = 0.90
        static let confidentSimilarity: Float = 0.95
        static let topN = 5
        /// Path to the artwork fingerprints database in the app bundle.
        static let databaseFilename = "artwork-fingerprints-uint8"
        static let databaseExtension = "json"
    }

    let kind: ScanStrategyKind = .artworkFingerprint
    let supportsLiveScanning: Bool = true

    private let cropper: CardCropper
    private var database: [ArtworkFingerprintMatcher.Entry] = []
    private var isLoaded = false

    init(cropper: CardCropper = CardCropper()) {
        self.cropper = cropper
    }

    func supports(_ mode: ScanMode) -> Bool {
        switch mode {
        case .pokemon: return true
        case .mtg, .yugioh: return false // TODO: build fingerprint DBs for these
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

        // Load database on first use
        if !isLoaded {
            try await loadDatabase()
        }

        guard !database.isEmpty else { return nil }

        // Step 1: Detect and crop the card using Vision
        let cropped = try cropper.bestCrop(from: image) ?? image

        // Step 2: Compute artwork fingerprint + HSV histogram
        let tcg = context.mode.rawValue
        let fingerprint = ArtworkFingerprintMatcher.computeFingerprint(from: cropped, tcg: tcg)
        let hsvHist = ArtworkFingerprintMatcher.computeHSVHistogram(from: cropped, tcg: tcg)

        // Step 3: Match against database
        let matches = ArtworkFingerprintMatcher.match(
            queryFp: fingerprint,
            queryHSV: hsvHist,
            database: database,
            topN: Config.topN
        )

        guard let best = matches.first, best.similarity >= Config.minimumSimilarity else {
            return nil
        }

        // Step 4: Build result
        let gap = matches.count >= 2
            ? best.similarity - matches[1].similarity
            : 1.0

        let confidence = CardScanConfidence(
            score: Double(best.similarity),
            reason: "Artwork+HSV sim=\(String(format: "%.4f", best.similarity)) gap=\(String(format: "%.4f", gap))"
        )

        let identity = CardIdentity(
            id: best.externalId,
            name: best.name,
            game: context.mode.tcgGame,
            setCode: best.setCode,
            setName: nil
        )

        let details = CardDetails(
            identity: identity,
            rarity: nil,
            imageURL: nil,
            price: nil,
            sourceCard: nil
        )

        var candidates = [CardScanCandidate]()
        for match in matches {
            let cIdentity = CardIdentity(
                id: match.externalId,
                name: match.name,
                game: context.mode.tcgGame,
                setCode: match.setCode,
                setName: nil
            )
            candidates.append(CardScanCandidate(
                details: CardDetails(
                    identity: cIdentity,
                    rarity: nil,
                    imageURL: nil,
                    price: nil,
                    sourceCard: nil
                ),
                confidence: CardScanConfidence(
                    score: Double(match.similarity),
                    reason: "artwork+hsv"
                ),
                originatingStrategy: kind,
                debugInfo: [:]
            ))
        }

        return CardScanResult(
            bestCandidate: candidates.first!,
            alternativeCandidates: Array(candidates.dropFirst()),
            strategyUsed: kind
        )
    }

    // MARK: - Database Loading

    private func loadDatabase() async throws {
        guard let url = Bundle.main.url(
            forResource: Config.databaseFilename,
            withExtension: Config.databaseExtension
        ) else {
            // Try loading from Documents or downloaded location
            let docsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
                .appendingPathComponent("\(Config.databaseFilename).\(Config.databaseExtension)")
            guard let docsURL, FileManager.default.fileExists(atPath: docsURL.path) else {
                print("[ArtworkFP] Database not found in bundle or documents")
                isLoaded = true
                return
            }
            try loadFromURL(docsURL)
            return
        }

        try loadFromURL(url)
    }

    private func loadFromURL(_ url: URL) throws {
        let data = try Data(contentsOf: url)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let entries = json?["entries"] as? [[String: Any]] else {
            print("[ArtworkFP] Invalid database format")
            isLoaded = true
            return
        }

        let isQuantized = json?["hsvQuantized"] as? Bool ?? false

        database = entries.compactMap { entry -> ArtworkFingerprintMatcher.Entry? in
            guard let externalId = entry["externalId"] as? String,
                  let name = entry["name"] as? String,
                  let fpB64 = entry["fingerprint"] as? String
            else { return nil }

            let fp = decodeBase64Float32(fpB64)
            guard !fp.isEmpty else { return nil }

            var hsv: [Float]? = nil
            if let hsvB64 = entry["hsvHist"] as? String {
                if isQuantized, let scale = entry["hsvScale"] as? Double, scale > 0 {
                    hsv = decodeBase64Uint8ToFloat(hsvB64, scale: Float(scale))
                } else {
                    hsv = decodeBase64Float32(hsvB64)
                }
            }

            return ArtworkFingerprintMatcher.Entry(
                externalId: externalId,
                name: name,
                setCode: entry["setCode"] as? String,
                fingerprint: fp,
                fpNorm: Self.l2Norm(fp),
                hsvHist: hsv,
                hsvNorm: hsv.map { Self.l2Norm($0) } ?? 0
            )
        }

        isLoaded = true
        print("[ArtworkFP] Loaded \(database.count) entries (quantized: \(isQuantized))")
    }

    // MARK: - Base64 Decoding

    private func decodeBase64Float32(_ b64: String) -> [Float] {
        guard let data = Data(base64Encoded: b64) else { return [] }
        return data.withUnsafeBytes { buf -> [Float] in
            let floatBuf = buf.bindMemory(to: Float.self)
            return Array(floatBuf)
        }
    }

    private func decodeBase64Uint8ToFloat(_ b64: String, scale: Float) -> [Float] {
        guard let data = Data(base64Encoded: b64) else { return [] }
        let invScale = scale / 255.0
        return data.map { Float($0) * invScale }
    }

    private static func l2Norm(_ v: [Float]) -> Float {
        var sumSq: Float = 0
        for val in v { sumSq += val * val }
        return sqrt(sumSq)
    }
}
