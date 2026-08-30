import CoreGraphics
import Foundation

enum ScanMode: String, CaseIterable, Identifiable, Sendable {
    case automatic
    case pokemon
    case yugioh
    case mtg

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .automatic: return "Automatic"
        case .pokemon: return "Pokémon"
        case .yugioh: return "Yu-Gi-Oh!"
        case .mtg: return "MTG"
        }
    }

    var description: String {
        switch self {
        case .automatic:
            return "Identify the game automatically using all installed card indexes."
        case .pokemon:
            return "Use clear lighting and center the Pokémon card within the frame."
        case .yugioh:
            return "Keep the foil text sharp and fill the frame with the Yu-Gi-Oh! card."
        case .mtg:
            return "Capture the full Magic card art and name line for best results."
        }
    }

    var tcgGame: TCGGame {
        switch self {
        case .automatic: return .all
        case .pokemon: return .pokemon
        case .yugioh: return .yugioh
        case .mtg: return .magic
        }
    }

    var accentColorHex: String {
        switch self {
        case .automatic: return "#0A84FF"
        case .pokemon: return "#FF3B30"
        case .yugioh: return "#AF52DE"
        case .mtg: return "#34C759"
        }
    }
}

enum ScanEnginePreference: String, CaseIterable, Identifiable, Sendable {
    case automatic
    case localOnly
    case serverHash
    case serverEmbedding

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .automatic:
            return "Automatic"
        case .localOnly:
            return "On-Device"
        case .serverHash:
            return "Hash"
        case .serverEmbedding:
            return "Embedding"
        }
    }

    var description: String {
        switch self {
        case .automatic:
            return "Keep the current local-first scan flow and fall back through the existing strategies."
        case .localOnly:
            return "Match entirely on this phone with the bundled fingerprint and hash databases. No server or internet required."
        case .serverHash:
            return "Send the captured photo to the server pHash matcher only."
        case .serverEmbedding:
            return "Send the captured photo to the server embedding matcher derived from the Trading-Card-Scanner pipeline."
        }
    }

    var apiValue: String? {
        switch self {
        case .automatic, .localOnly:
            return nil
        case .serverHash:
            return "phash"
        case .serverEmbedding:
            return "embedding"
        }
    }

    var requiresServerOnlyFlow: Bool {
        switch self {
        case .automatic, .localOnly:
            return false
        case .serverHash, .serverEmbedding:
            return true
        }
    }

    /// True for engines that never contact a server — usable with no backend.
    var isLocalOnly: Bool {
        self == .localOnly
    }

    func supports(_ mode: ScanMode) -> Bool {
        switch self {
        case .automatic, .localOnly:
            return true
        case .serverHash:
            return mode != .automatic
        case .serverEmbedding:
            return mode == .pokemon
        }
    }
}

struct CardIdentity: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let game: TCGGame
    let setCode: String?
    let setName: String?
    let collectorNumber: String?
    let recognitionFamilyID: String?
    let exactPrintingID: String?
    /// ISO-8601 calendar date from the scanner artifact. Lexical ordering is
    /// deliberate and deterministic for the `YYYY-MM-DD` source contract.
    let releaseDate: String?

    nonisolated init(
        id: String,
        name: String,
        game: TCGGame,
        setCode: String?,
        setName: String?,
        collectorNumber: String? = nil,
        recognitionFamilyID: String? = nil,
        exactPrintingID: String? = nil,
        releaseDate: String? = nil
    ) {
        self.id = id
        self.name = name
        self.game = game
        self.setCode = setCode
        self.setName = setName
        self.collectorNumber = collectorNumber
        self.recognitionFamilyID = recognitionFamilyID
        self.exactPrintingID = exactPrintingID
        self.releaseDate = releaseDate
    }
}

struct CardDetails: Hashable, Sendable {
    let identity: CardIdentity
    let rarity: String?
    let imageURL: URL?
    let price: Double?
    let sourceCard: Card?

    nonisolated init(identity: CardIdentity, rarity: String?, imageURL: URL?, price: Double?, sourceCard: Card? = nil) {
        self.identity = identity
        self.rarity = rarity
        self.imageURL = imageURL
        self.price = price
        self.sourceCard = sourceCard
    }

    init(card: Card) {
        let game = TCGGame(rawValue: card.tcg) ?? {
            switch card.tcg.lowercased() {
            case "pokemon": return TCGGame.pokemon
            case "yugioh", "yu-gi-oh", "yu_gi_oh": return TCGGame.yugioh
            case "magic", "mtg": return TCGGame.magic
            default: return TCGGame.all
            }
        }()
        let identity = CardIdentity(
            id: card.id,
            name: card.name,
            game: game,
            setCode: card.setCode,
            setName: card.setName
        )
        self.init(
            identity: identity,
            rarity: card.rarity,
            imageURL: card.imageUrl.flatMap(URL.init(string:)),
            price: card.price,
            sourceCard: card
        )
    }
}

struct CardScanConfidence: Hashable, Sendable {
    let score: Double
    let reason: String?

    static let low = CardScanConfidence(score: 0.2, reason: nil)
    static let none = CardScanConfidence(score: 0, reason: nil)
}

enum CardScanDebugFeedbackStatus: String, CaseIterable, Identifiable, Codable, Sendable {
    case unreviewed
    case correct
    case incorrect
    case needsReview = "needs_review"

    var id: String { rawValue }

    var displayLabel: String {
        switch self {
        case .unreviewed:
            return "Unreviewed"
        case .correct:
            return "Correct"
        case .incorrect:
            return "Wrong"
        case .needsReview:
            return "Needs Review"
        }
    }
}

enum CardScanReviewTag: String, CaseIterable, Identifiable, Codable, Sendable {
    case wrongPrinting = "wrong_printing"
    case wrongSpecies = "wrong_species"
    case badCrop = "bad_crop"
    case blur
    case glare
    case multipleCards = "multiple_cards"
    case energyOrTrainer = "energy_or_trainer"
    case noCardPresent = "no_card_present"

    var id: String { rawValue }

    var displayLabel: String {
        switch self {
        case .wrongPrinting:
            return "Wrong Printing"
        case .wrongSpecies:
            return "Wrong Species"
        case .badCrop:
            return "Bad Crop"
        case .blur:
            return "Blur"
        case .glare:
            return "Glare"
        case .multipleCards:
            return "Multiple Cards"
        case .energyOrTrainer:
            return "Energy / Trainer"
        case .noCardPresent:
            return "No Card Present"
        }
    }
}

struct CardScanCandidate: Identifiable, Hashable, Sendable {
    let id: UUID
    let details: CardDetails
    let confidence: CardScanConfidence
    let originatingStrategy: ScanStrategyKind
    let debugInfo: [String: String]
    let printingAlternatives: [CardDetails]

    nonisolated init(
        id: UUID = UUID(),
        details: CardDetails,
        confidence: CardScanConfidence,
        originatingStrategy: ScanStrategyKind,
        debugInfo: [String: String] = [:],
        printingAlternatives: [CardDetails] = []
    ) {
        self.id = id
        self.details = details
        self.confidence = confidence
        self.originatingStrategy = originatingStrategy
        self.debugInfo = debugInfo
        self.printingAlternatives = printingAlternatives
    }
}

enum CardScanResolution: String, Sendable {
    /// The scanner has enough evidence to identify the catalog printing.
    case exactPrinting
    /// The printed title is verified, but the exact catalog printing still
    /// needs a human choice. Binder review may surface this; it must never be
    /// bulk-added as the arbitrary top visual printing.
    case nameOnly
}

enum ScannerPrintingMode: String, CaseIterable, Identifiable, Equatable, Sendable {
    case quickLatest = "quick_latest"
    case exactPrinting = "exact_printing"

    static let defaultsKey = "scanner.printingMode"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .quickLatest: return "Quick Scan"
        case .exactPrinting: return "Exact Printing"
        }
    }

    var explanation: String {
        switch self {
        case .quickLatest:
            return "Use verified print details when available; otherwise choose the newest compatible printing in the matched artwork family."
        case .exactPrinting:
            return "Never guess among visually identical printings. Ask you to choose when printed details cannot decide."
        }
    }
}

enum CardPrintingResolutionProvenance: String, Equatable, Sendable {
    case verified
    case singlePrinting = "single_printing"
    case latestFallback = "latest_fallback"
    case userSelected = "user_selected"
    case unresolved
}

nonisolated enum CardPrintingResolver {
    struct Decision: Sendable {
        let selected: CardScanCandidate?
        let candidates: [CardScanCandidate]
        let provenance: CardPrintingResolutionProvenance

        var requiresSelection: Bool {
            guard case nil = selected else { return false }
            return candidates.count > 1
        }
    }

    static func resolve(
        primary: CardScanCandidate,
        candidates: [CardScanCandidate],
        mode: ScannerPrintingMode,
        verifiedExactPrintingID: String? = nil
    ) -> Decision {
        // Expanded printings keep the family's alternative list so a
        // resolved result still knows which printings it stands in for
        // (the result editor and replay scoring both read it).
        let expanded = primary.printingAlternatives.map { details in
            CardScanCandidate(
                details: details,
                confidence: primary.confidence,
                originatingStrategy: primary.originatingStrategy,
                debugInfo: primary.debugInfo,
                printingAlternatives: primary.printingAlternatives
            )
        }
        let unique = (expanded + [primary] + candidates).reduce(into: [String: CardScanCandidate]()) {
            $0[$1.details.identity.exactPrintingID ?? $1.details.identity.id] = $1
        }
        let familyID = primary.details.identity.recognitionFamilyID
        let family = unique.values.filter { candidate in
            guard let familyID else {
                return candidate.details.identity.id == primary.details.identity.id
            }
            return candidate.details.identity.recognitionFamilyID == familyID
        }
        let ordered = family.sorted(by: newestFirst)

        if let verifiedExactPrintingID,
           let verified = ordered.first(where: {
               ($0.details.identity.exactPrintingID ?? $0.details.identity.id) == verifiedExactPrintingID
           }) {
            return Decision(selected: verified, candidates: ordered, provenance: .verified)
        }
        guard ordered.count > 1 else {
            return Decision(selected: ordered.first ?? primary, candidates: ordered, provenance: .singlePrinting)
        }
        switch mode {
        case .quickLatest:
            return Decision(selected: ordered.first, candidates: ordered, provenance: .latestFallback)
        case .exactPrinting:
            return Decision(selected: nil, candidates: ordered, provenance: .unresolved)
        }
    }

    private static func newestFirst(_ left: CardScanCandidate, _ right: CardScanCandidate) -> Bool {
        let leftIdentity = left.details.identity
        let rightIdentity = right.details.identity
        let leftDate = leftIdentity.releaseDate ?? ""
        let rightDate = rightIdentity.releaseDate ?? ""
        if leftDate != rightDate { return leftDate > rightDate }
        return (leftIdentity.exactPrintingID ?? leftIdentity.id)
            > (rightIdentity.exactPrintingID ?? rightIdentity.id)
    }
}

struct CardScanResult: Identifiable {
    let id: UUID
    let mode: ScanMode
    let capturedImage: CGImage
    let primary: CardScanCandidate
    let alternatives: [CardScanCandidate]
    let resolution: CardScanResolution
    let printingResolutionProvenance: CardPrintingResolutionProvenance
    let elapsed: TimeInterval
    let debugCapture: APIService.ScanDebugCaptureResponse?
    let debugCaptureError: String?

    nonisolated init(
        id: UUID = UUID(),
        mode: ScanMode,
        capturedImage: CGImage,
        primary: CardScanCandidate,
        alternatives: [CardScanCandidate],
        resolution: CardScanResolution = .exactPrinting,
        printingResolutionProvenance: CardPrintingResolutionProvenance = .verified,
        elapsed: TimeInterval,
        debugCapture: APIService.ScanDebugCaptureResponse? = nil,
        debugCaptureError: String? = nil
    ) {
        self.id = id
        self.mode = mode
        self.capturedImage = capturedImage
        self.primary = primary
        self.alternatives = alternatives
        self.resolution = resolution
        self.printingResolutionProvenance = printingResolutionProvenance
        self.elapsed = elapsed
        self.debugCapture = debugCapture
        self.debugCaptureError = debugCaptureError
    }
}

enum CardScanPurpose: String, Sendable {
    case singleCard
    case binderPage
}

nonisolated enum ScanStrategyKind: String, Sendable {
    case manual
    case textOCR
    case perceptualHash
    case mlDetector
    case serverHash
    case serverEmbedding
    case artworkFingerprint

    var displayName: String {
        switch self {
        case .manual:
            return "Manual Selection"
        case .textOCR:
            return "Text OCR"
        case .perceptualHash:
            return "Perceptual Hash"
        case .mlDetector:
            return "Board Embedding"
        case .serverHash:
            return "Server Hash"
        case .serverEmbedding:
            return "Server Embedding"
        case .artworkFingerprint:
            return "Artwork Fingerprint"
        }
    }
}

struct CardScannerContext: Sendable {
    var mode: ScanMode
    let enginePreference: ScanEnginePreference
    let serverConfiguration: ServerConfiguration
    let authToken: String?
    let showPricing: Bool
    let saveDebugCapture: Bool
    let captureNotes: String?
    let setCode: String?
    var printingMode: ScannerPrintingMode = .quickLatest
    /// Binder pages use a stricter auto-import policy and may surface a
    /// title-confirmed, printing-unresolved suggestion for human review.
    var purpose: CardScanPurpose = .singleCard
    /// Dev-mode evidence collector. When present, strategies append per-crop
    /// attempt evidence (gate scores, candidates, OCR readings, outcome) as
    /// they work; nil (the default) costs nothing on the normal path.
    var diagnostics: ScanDiagnostics? = nil
    /// Per-capture camera calibration, scaled to the image passed into the
    /// coordinator. Imports and live frames may not provide it.
    var cameraIntrinsics: ScannerCameraIntrinsics? = nil
}

struct CardScanScope: Hashable, Sendable {
    let game: TCGGame
    let setCode: String
    let setName: String

    var scanMode: ScanMode? {
        ScanMode.allCases.first { $0.tcgGame == game }
    }
}

enum ScanInvocationKind: Sendable {
    case livePreview
    /// A camera shutter capture that has already been framed by the on-screen
    /// guide crop, so the card fills most of the frame with a thin border.
    case photoCapture
    /// A still image that never passed through the camera guide: photo-library
    /// imports, Simulator Test Photo/Demo, and test fixtures. The frame may
    /// already BE the card with no background at all, which the scene-trained
    /// detector cannot handle — strategies may consider the whole frame as a
    /// crop candidate for this source only.
    case importedPhoto
}

enum CardScannerError: Error, LocalizedError, Sendable {
    case cameraUnavailable
    case permissionDenied
    case noMatch
    /// A local open-set gate positively identified the input as unsuitable for
    /// card recognition. The coordinator must not let a looser fallback turn
    /// this into a confident nearest-neighbor false positive.
    case rejectedInput
    /// Hub collapse: the crop embedded into a degenerate region (blank, glare,
    /// mis-rectified) near many unrelated rows at once. Unlike `rejectedInput`
    /// this voids only the crop hypothesis it came from.
    case degenerateInput
    case ineligibleMode
    case missingAuthToken
    case underlying(Error)

    var errorDescription: String? {
        switch self {
        case .cameraUnavailable:
            return "Camera is not available on this device."
        case .permissionDenied:
            return "Camera access is required to scan cards. Enable it in Settings."
        case .noMatch:
            return "We could not recognize this card. Try adjusting lighting and framing."
        case .rejectedInput:
            return "We could not find a clear card face. Center one card and try again."
        case .degenerateInput:
            return "We could not read a card from this crop. Reduce glare and try again."
        case .ineligibleMode:
            return "The selected mode is not supported by the current strategy."
        case .missingAuthToken:
            return "You need to be logged in before scanning cards."
        case .underlying(let error):
            return error.localizedDescription
        }
    }
}
