import Foundation

/// Which embedding encoder the scanner runs. Two are bundled:
///
/// - `.arcface` (DEFAULT): the in-house FastViT-T8 encoder trained with
///   ArcFace classification-as-retrieval on the card catalog (2026-08-23).
///   6.9 MB, ANE-fast, and on the full replay corpus scores 46/76 labeled
///   frames correct with zero wrong accepts at its calibrated thresholds —
///   versus 31/76 with one wrong accept for DINOv2.
/// - `.dinov2`: the original off-the-shelf `facebook/dinov2-small` encoder.
///   Kept bundled as the rollback path; selecting it restores the exact
///   pre-ArcFace pipeline including its rejection gate and thresholds.
///
/// A variant is an ATOMIC bundle of model + index + thresholds + gate — the
/// pieces are calibrated to each other and must never mix (an index embeds
/// the catalog in one encoder's space; thresholds are operating points on one
/// encoder's score distribution; the gate is trained on one encoder's
/// embeddings).
///
/// Resolution order: `SCANNER_ENCODER` env (test harness) > UserDefaults
/// (the dev-menu "Recognition Model" picker) > `.arcface`. Read at strategy
/// construction, so switching takes effect the next time the scanner opens.
nonisolated enum ScannerEncoderVariant: String, CaseIterable, Identifiable {
    case arcface
    case dinov2

    var id: String { rawValue }

    static let defaultsKey = "scannerEncoderVariant"

    static var current: ScannerEncoderVariant {
        if let raw = ProcessInfo.processInfo.environment["SCANNER_ENCODER"],
           let variant = ScannerEncoderVariant(rawValue: raw.lowercased()) {
            return variant
        }
        if let raw = UserDefaults.standard.string(forKey: defaultsKey),
           let variant = ScannerEncoderVariant(rawValue: raw) {
            return variant
        }
        return .arcface
    }

    var displayName: String {
        switch self {
        case .arcface: return "TCGer ArcFace (default)"
        case .dinov2: return "DINOv2 (original)"
        }
    }

    /// Bundled compiled-model name (`<name>.mlmodelc`).
    var embeddingModelName: String {
        switch self {
        case .arcface: return "CardEmbeddings-arcface"
        case .dinov2: return "CardEmbeddings"
        }
    }

    /// Bundled packed int8 index resource (`<name>.bin`). Same header/scale
    /// format for both; the vectors live in the matching encoder's space.
    var indexResourceName: String {
        switch self {
        case .arcface: return "CardsIndexVectors-arcface"
        case .dinov2: return "CardsIndexVectors"
        }
    }

    /// The card-face rejection gate is a logistic head trained on DINOv2
    /// embeddings; it is meaningless in the ArcFace space (retraining it is
    /// on the polish list). The strategy's policy already handles a nil gate.
    var usesRejectionGate: Bool {
        self == .dinov2
    }

    /// Strong-accept threshold, calibrated per encoder against the replay
    /// corpus (offline sweep + real-replay validation; see the recalibration
    /// section of CardScanner/README.md). Env-overridable for sweeps.
    var strongAcceptanceScore: Double {
        if let raw = ProcessInfo.processInfo.environment["SCANNER_STRONG_ACCEPT"],
           let value = Double(raw) {
            return value
        }
        switch self {
        case .arcface: return 0.60  // wrong accepts appear below 0.59 (measured 2026-08-23)
        case .dinov2: return 0.72   // historical calibration; see Configuration notes
        }
    }

    /// Ambiguity margin between the top-2 distinct candidates. ArcFace
    /// separates matches more sharply, so a wider margin costs little recall
    /// and buys precision.
    var ambiguityMargin: Double {
        if let raw = ProcessInfo.processInfo.environment["SCANNER_AMBIGUITY_MARGIN"],
           let value = Double(raw) {
            return value
        }
        switch self {
        case .arcface: return 0.05
        case .dinov2: return 0.02
        }
    }
}
