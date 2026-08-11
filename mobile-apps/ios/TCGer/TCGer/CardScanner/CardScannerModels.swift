import CoreGraphics
import Foundation

enum ScanMode: String, CaseIterable, Identifiable, Sendable {
    case pokemon
    case yugioh
    case mtg

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .pokemon: return "Pokémon"
        case .yugioh: return "Yu-Gi-Oh!"
        case .mtg: return "MTG"
        }
    }

    var description: String {
        switch self {
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
        case .pokemon: return .pokemon
        case .yugioh: return .yugioh
        case .mtg: return .magic
        }
    }

    var accentColorHex: String {
        switch self {
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
        case .automatic, .localOnly, .serverHash:
            return true
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

    init(
        id: UUID = UUID(),
        details: CardDetails,
        confidence: CardScanConfidence,
        originatingStrategy: ScanStrategyKind,
        debugInfo: [String: String] = [:]
    ) {
        self.id = id
        self.details = details
        self.confidence = confidence
        self.originatingStrategy = originatingStrategy
        self.debugInfo = debugInfo
    }
}

extension CardScanCandidate {
    /// The catalog card represented by this match. Some scanner strategies
    /// only retain identity fields, so provide a usable fallback for print
    /// lookup and manual selection.
    var resolvedCard: Card? {
        if let sourceCard = details.sourceCard {
            return sourceCard
        }
        guard details.identity.game != .all else { return nil }
        return Card(
            id: details.identity.id,
            name: details.identity.name,
            tcg: details.identity.game.rawValue,
            setCode: details.identity.setCode,
            setName: details.identity.setName,
            rarity: details.rarity,
            imageUrl: details.imageURL?.absoluteString,
            imageUrlSmall: details.imageURL?.absoluteString,
            price: details.price,
            collectorNumber: nil,
            releasedAt: nil
        )
    }

    static func manual(card: Card) -> CardScanCandidate {
        CardScanCandidate(
            details: CardDetails(card: card),
            confidence: CardScanConfidence(score: 1, reason: "Selected manually"),
            originatingStrategy: .manual
        )
    }
}

struct CardScanResult: Identifiable {
    let id: UUID
    let mode: ScanMode
    let capturedImage: CGImage
    let primary: CardScanCandidate
    let alternatives: [CardScanCandidate]
    let elapsed: TimeInterval
    let debugCapture: APIService.ScanDebugCaptureResponse?
    let debugCaptureError: String?

    init(
        id: UUID = UUID(),
        mode: ScanMode,
        capturedImage: CGImage,
        primary: CardScanCandidate,
        alternatives: [CardScanCandidate],
        elapsed: TimeInterval,
        debugCapture: APIService.ScanDebugCaptureResponse? = nil,
        debugCaptureError: String? = nil
    ) {
        self.id = id
        self.mode = mode
        self.capturedImage = capturedImage
        self.primary = primary
        self.alternatives = alternatives
        self.elapsed = elapsed
        self.debugCapture = debugCapture
        self.debugCaptureError = debugCaptureError
    }
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
    let mode: ScanMode
    let enginePreference: ScanEnginePreference
    let serverConfiguration: ServerConfiguration
    let authToken: String?
    let showPricing: Bool
    let saveDebugCapture: Bool
    let captureNotes: String?
    let setCode: String?
    /// Dev-mode evidence collector. When present, strategies append per-crop
    /// attempt evidence (gate scores, candidates, OCR readings, outcome) as
    /// they work; nil (the default) costs nothing on the normal path.
    var diagnostics: ScanDiagnostics? = nil
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
        case .ineligibleMode:
            return "The selected mode is not supported by the current strategy."
        case .missingAuthToken:
            return "You need to be logged in before scanning cards."
        case .underlying(let error):
            return error.localizedDescription
        }
    }
}
