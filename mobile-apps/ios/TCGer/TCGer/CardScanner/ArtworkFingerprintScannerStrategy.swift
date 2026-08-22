import CoreGraphics
import Foundation

/// Scanner strategy using artwork fingerprint + HSV histogram matching.
///
/// Uses Vision rectangle detection (existing CardCropper) for card localization,
/// then computes artwork fingerprint + HSV histogram for identification against
/// a per-game database of card fingerprints.
///
/// Databases are per game — `artwork-fingerprints-<tcg>-uint8.json` (e.g.
/// `artwork-fingerprints-pokemon-uint8.json`) — looked up in the app bundle
/// first, then in the Documents directory (the downloaded-database path). The
/// pre-per-game filename `artwork-fingerprints-uint8.json` is still honored as
/// a fallback; the game it serves is whatever its own `tcg` field declares.
///
/// Loading is lazy, per game, on first use: parsing the ~53 MB Pokémon
/// database eagerly at init used to block scanner startup for every game.
///
/// Combined score: 5% artwork cosine similarity + 95% HSV cosine similarity
/// (see `ArtworkFingerprintMatcher.artworkWeight` for the tuning sweep).
final class ArtworkFingerprintScannerStrategy: ScanStrategy {
    private enum Config {
        static let confidentSimilarity: Float = 0.95
        static let minimumCandidateSeparation: Float = 0.015
        static let topN = 5
        static let databaseExtension = "json"
        /// Legacy single-database filename (game declared by its `tcg` field).
        static let legacyDatabaseFilename = "artwork-fingerprints-uint8"

        static func databaseFilename(for game: TCGGame) -> String {
            "artwork-fingerprints-\(game.rawValue)-uint8"
        }
    }

    let kind: ScanStrategyKind = .artworkFingerprint
    let supportsLiveScanning: Bool = true

    private let cropper: CardCropper
    private let bundle: Bundle
    private let fileManager: FileManager

    private let lock = NSLock()
    private var databases: [ScanMode: [ArtworkFingerprintMatcher.Entry]] = [:]
    private var legacyResolved = false

    init(
        cropper: CardCropper = CardCropper(),
        bundle: Bundle = .main,
        fileManager: FileManager = .default
    ) {
        self.cropper = cropper
        self.bundle = bundle
        self.fileManager = fileManager
    }

    func supports(_ mode: ScanMode) -> Bool {
        lock.lock()
        let cached = databases[mode]
        let legacyResolved = self.legacyResolved
        lock.unlock()

        if let cached { return !cached.isEmpty }
        if databaseURL(named: Config.databaseFilename(for: mode.tcgGame)) != nil {
            return true
        }
        // The legacy file's game is unknown until it is parsed; stay
        // optimistic and let the first scan resolve it — a wrong guess
        // surfaces as a clean no-match, and the coordinator moves on.
        return !legacyResolved && databaseURL(named: Config.legacyDatabaseFilename) != nil
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

        let database = loadDatabaseIfNeeded(for: context.mode)
        guard !database.isEmpty else { return nil }

        // Step 1: Detect and crop the card using Vision
        let cropped = try cropper.bestCrop(
            from: image,
            intrinsics: context.cameraIntrinsics
        ) ?? image

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

        guard Self.accepts(matches: matches) else {
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

    /// Cosine scores are nearest-neighbor rankings, not calibrated
    /// probabilities. Require both a strong absolute score and meaningful
    /// separation from the next different card before showing a result.
    static func accepts(matches: [ArtworkFingerprintMatcher.Match]) -> Bool {
        guard let best = matches.first,
              best.similarity >= Config.confidentSimilarity
        else { return false }

        guard let rival = matches.dropFirst().first(where: {
            $0.externalId != best.externalId && $0.name != best.name
        }) else { return true }
        return best.similarity - rival.similarity >= Config.minimumCandidateSeparation
    }

    // MARK: - Database Loading

    /// The bundled fingerprint database is a ~53 MB JSON that otherwise
    /// parses lazily inside the user's first no-match scan — while holding
    /// the same lock `supports(_:)` takes from SwiftUI body evaluation. Warm
    /// it with the other scanner assets instead.
    func warmUp() async {
        loadDatabaseIfNeeded(for: .pokemon)
    }

    /// Loads (and caches) the database for a mode. Internal rather than
    /// private so performance tests can measure the cold-load cost directly.
    @discardableResult
    func loadDatabaseIfNeeded(for mode: ScanMode) -> [ArtworkFingerprintMatcher.Entry] {
        lock.lock()
        defer { lock.unlock() }

        if let cached = databases[mode] { return cached }

        if let url = databaseURL(named: Config.databaseFilename(for: mode.tcgGame)) {
            let loaded = Self.loadFromURL(url)
            // A per-game file declaring a different game is a build error:
            // serve it under its declared game, nothing under this one.
            let resolvedMode = loaded.mode ?? mode
            databases[resolvedMode] = loaded.entries
            if resolvedMode != mode {
                print("[ArtworkFP] \(url.lastPathComponent) declares tcg \(String(describing: loaded.mode)), not \(mode)")
                databases[mode] = []
            }
            return databases[mode] ?? []
        }

        if !legacyResolved, let url = databaseURL(named: Config.legacyDatabaseFilename) {
            legacyResolved = true
            let loaded = Self.loadFromURL(url)
            if let resolvedMode = loaded.mode, databases[resolvedMode] == nil {
                databases[resolvedMode] = loaded.entries
            }
            if databases[mode] == nil {
                databases[mode] = []
            }
            return databases[mode] ?? []
        }

        databases[mode] = []
        return []
    }

    private func databaseURL(named name: String) -> URL? {
        if let url = bundle.url(forResource: name, withExtension: Config.databaseExtension) {
            return url
        }
        // Downloaded-database path (used when a game's database is delivered
        // out-of-band instead of shipping in the bundle).
        let docsURL = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first?
            .appendingPathComponent("\(name).\(Config.databaseExtension)")
        guard let docsURL, fileManager.fileExists(atPath: docsURL.path) else {
            return nil
        }
        return docsURL
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

        print("[ArtworkFP] Loaded \(database.count) entries from \(url.lastPathComponent) (quantized: \(isQuantized))")
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
