import CoreGraphics
import Foundation

/// Scanner strategy using artwork fingerprint + HSV histogram matching.
///
/// Uses Vision rectangle detection (existing CardCropper) for card localization,
/// then computes artwork fingerprint + HSV histogram for identification against
/// a preloaded database of 21,900 Pokemon card fingerprints.
///
/// Combined score: 5% artwork cosine similarity + 95% HSV cosine similarity
/// (see `ArtworkFingerprintMatcher.artworkWeight` for the tuning sweep).
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
    private let database: [ArtworkFingerprintMatcher.Entry]
    private let supportedModes: Set<ScanMode>

    init(
        cropper: CardCropper = CardCropper(),
        bundle: Bundle = .main,
        fileManager: FileManager = .default
    ) {
        self.cropper = cropper
        let loaded = Self.loadDatabase(bundle: bundle, fileManager: fileManager)
        database = loaded.entries
        supportedModes = loaded.entries.isEmpty ? [] : Set([loaded.mode].compactMap { $0 })
    }

    func supports(_ mode: ScanMode) -> Bool {
        supportedModes.contains(mode)
    }

    func scan(
        image: CGImage,
        context: CardScannerContext,
        source: ScanInvocationKind,
        apiService: APIService
    ) async throws -> CardScanResult? {
        let start = Date()

        guard supports(context.mode) else {
            throw CardScannerError.ineligibleMode
        }

        guard !database.isEmpty else { return nil }

        // Step 1: Detect and crop the card using Vision
        let cropped = try cropper.bestCrop(from: image) ?? image

        // Step 2: Compute artwork fingerprint + HSV histogram
        let tcg = context.mode.tcgGame.rawValue
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

        // Step 4: Build result candidates
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

        let primary = candidates[0]
        let alternatives = Array(candidates.dropFirst())

        return CardScanResult(
            mode: context.mode,
            capturedImage: cropped,
            primary: primary,
            alternatives: alternatives,
            elapsed: Date().timeIntervalSince(start)
        )
    }

    // MARK: - Database Loading

    private static func loadDatabase(
        bundle: Bundle,
        fileManager: FileManager
    ) -> (entries: [ArtworkFingerprintMatcher.Entry], mode: ScanMode?) {
        guard let url = bundle.url(
            forResource: Config.databaseFilename,
            withExtension: Config.databaseExtension
        ) else {
            // Try loading from Documents or downloaded location
            let docsURL = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first?
                .appendingPathComponent("\(Config.databaseFilename).\(Config.databaseExtension)")
            guard let docsURL, fileManager.fileExists(atPath: docsURL.path) else {
                print("[ArtworkFP] Database not found in bundle or documents")
                return ([], nil)
            }
            return loadFromURL(docsURL)
        }

        return loadFromURL(url)
    }

    private static func loadFromURL(
        _ url: URL
    ) -> (entries: [ArtworkFingerprintMatcher.Entry], mode: ScanMode?) {
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let entries = json["entries"] as? [[String: Any]]
        else {
            print("[ArtworkFP] Invalid database format")
            return ([], nil)
        }

        let isQuantized = json["hsvQuantized"] as? Bool ?? false

        let database = entries.compactMap { entry -> ArtworkFingerprintMatcher.Entry? in
            guard let externalId = entry["externalId"] as? String,
                  let name = entry["name"] as? String,
                  let fpB64 = entry["fingerprint"] as? String
            else { return nil }

            let fp = Self.decodeBase64Float32(fpB64)
            guard !fp.isEmpty else { return nil }

            var hsv: [Float]? = nil
            if let hsvB64 = entry["hsvHist"] as? String {
                if isQuantized, let scale = entry["hsvScale"] as? Double, scale > 0 {
                    hsv = Self.decodeBase64Uint8ToFloat(hsvB64, scale: Float(scale))
                } else {
                    hsv = Self.decodeBase64Float32(hsvB64)
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

        print("[ArtworkFP] Loaded \(database.count) entries (quantized: \(isQuantized))")
        return (database, mode(for: json["tcg"] as? String))
    }

    // MARK: - Base64 Decoding

    private static func decodeBase64Float32(_ b64: String) -> [Float] {
        guard let data = Data(base64Encoded: b64) else { return [] }
        return data.withUnsafeBytes { buf -> [Float] in
            let floatBuf = buf.bindMemory(to: Float.self)
            return Array(floatBuf)
        }
    }

    private static func decodeBase64Uint8ToFloat(_ b64: String, scale: Float) -> [Float] {
        guard let data = Data(base64Encoded: b64) else { return [] }
        let invScale = scale / 255.0
        return data.map { Float($0) * invScale }
    }

    private static func l2Norm(_ v: [Float]) -> Float {
        var sumSq: Float = 0
        for val in v { sumSq += val * val }
        return sqrt(sumSq)
    }

    private static func mode(for tcg: String?) -> ScanMode? {
        switch tcg?.lowercased() ?? "pokemon" {
        case "pokemon": return .pokemon
        case "magic", "mtg": return .mtg
        case "yugioh", "yu-gi-oh", "yu_gi_oh": return .yugioh
        default: return nil
        }
    }
}
