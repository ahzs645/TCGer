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

enum ScanStrategyKind: String, Sendable {
    case textOCR
    case perceptualHash
    case mlDetector
    case serverHash
    case artworkFingerprint
}

struct CardScannerContext: Sendable {
    let mode: ScanMode
    let serverConfiguration: ServerConfiguration
    let authToken: String?
    let showPricing: Bool
    let saveDebugCapture: Bool
    let captureNotes: String?
}

enum ScanInvocationKind: Sendable {
    case livePreview
    case photoCapture
}

enum CardScannerError: Error, LocalizedError, Sendable {
    case cameraUnavailable
    case permissionDenied
    case noMatch
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
        case .ineligibleMode:
            return "The selected mode is not supported by the current strategy."
        case .missingAuthToken:
            return "You need to be logged in before scanning cards."
        case .underlying(let error):
            return error.localizedDescription
        }
    }
}
