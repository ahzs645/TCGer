import Foundation

/// Declarative, per-game acceptance policy for the embedding scanner.
///
/// Every game runtime is its own encoder/index pair with its own score
/// distribution, so the rules that turn a similarity ranking plus printed
/// evidence into an accept/abstain decision are data, not code paths keyed
/// on `game == .magic`. The contract is
/// `tcger-scanner-acceptance-policy-v1`, published as the optional
/// `acceptancePolicy` object of each game's scanner manifest and mirrored in
/// `tools/scanner-acceptance-policies.json` (the source of truth for
/// publishers). Resolution order, highest priority first:
///
/// 1. environment overrides (replay sweeps and A/B runs);
/// 2. the policy declared by the installed manifest, when valid;
/// 3. the built-in profile for the game (`builtin(for:variant:)`), which
///    must match the JSON file for the three shipped games;
/// 4. `fallback` — the conservative profile every unknown game starts with.
///
/// A future game therefore needs no client code to get a scanner: its
/// manifest declares the policy its replay evidence supports, and until it
/// has that evidence it runs under `fallback`.
nonisolated struct ScannerGameAcceptancePolicy: Decodable, Equatable, Sendable {
    static let schema = "tcger-scanner-acceptance-policy-v1"

    /// When an exact printed title is REQUIRED before any accept.
    enum TitleGate: String, Decodable, Sendable {
        case never
        case binderPage
        case intentionalCaptures
    }

    /// Which printings a footer collector number is matched against.
    enum CollectorNumberScope: String, Decodable, Sendable {
        /// Only the family row's representative printing (legacy behaviour).
        case representative
        /// Every printing the family row represents (`printingAlternatives`).
        case family
    }

    /// Cosine similarity at which a visual top-1 is accepted with no other
    /// evidence. Retry crop hypotheses add the strategy's retry margin.
    var strongAcceptanceScore: Double
    /// Minimum top-1 minus top-2 (different family) similarity; closer than
    /// this abstains unless printed evidence decides.
    var ambiguityMargin: Double
    /// Lowest similarity at which printed evidence may confirm a candidate.
    var evidenceFloor: Double
    var titleGate: TitleGate
    /// An exact, catalog-unique title confirms its visual neighbour from
    /// `evidenceFloor`.
    var uniqueTitleRescue: Bool
    /// An exact title naming the same card the image ranked first (with no
    /// different-name rival inside `ambiguityMargin`) confirms the visual
    /// family from `evidenceFloor`; the printing is then resolved normally.
    var titleAgreementRescue: Bool
    var collectorNumberScope: CollectorNumberScope
    /// Hub rejection: abstain when at least `hubDistinctNames` DIFFERENT
    /// card names sit at or above `hubSimilarity` among the top `hubTopK`
    /// neighbours. Genuine matches never look like that; degenerate crops
    /// (blank, glare-saturated, mis-rectified) do — measured 2026-08-29:
    /// 0 hits on 364 verified real-camera crops, 8/12 on the degenerate
    /// Stone Quarry attempts that scored 0.99 against a back face.
    /// `hubDistinctNames == 0` disables the rule.
    var hubSimilarity: Double
    var hubDistinctNames: Int
    var hubTopK: Int
    /// Colour normalization applied to every query crop before the encoder's
    /// resize contract. Per game because it depends on what the encoder was
    /// trained on: the catalog-only Magic encoder gains (108 labeled frames:
    /// correct family first on 79 raw vs 104 normalized crops), while the
    /// Pokémon encoder, trained toward camera captures, loses (76-label
    /// replay 53 → 49). See `QueryColorNormalization`.
    var queryNormalization: QueryNormalization

    enum QueryNormalization: String, Decodable, Sendable {
        case none
        case greyWorldAutocontrast = "grey-world-autocontrast"
    }

    init(
        strongAcceptanceScore: Double,
        ambiguityMargin: Double,
        evidenceFloor: Double = 0.55,
        titleGate: TitleGate = .never,
        uniqueTitleRescue: Bool = true,
        titleAgreementRescue: Bool = true,
        collectorNumberScope: CollectorNumberScope = .family,
        hubSimilarity: Double = 0.90,
        hubDistinctNames: Int = 2,
        hubTopK: Int = 5,
        queryNormalization: QueryNormalization = .none
    ) {
        self.queryNormalization = queryNormalization
        self.hubSimilarity = hubSimilarity
        self.hubDistinctNames = hubDistinctNames
        self.hubTopK = hubTopK
        self.strongAcceptanceScore = strongAcceptanceScore
        self.ambiguityMargin = ambiguityMargin
        self.evidenceFloor = evidenceFloor
        self.titleGate = titleGate
        self.uniqueTitleRescue = uniqueTitleRescue
        self.titleAgreementRescue = titleAgreementRescue
        self.collectorNumberScope = collectorNumberScope
    }

    private enum CodingKeys: String, CodingKey {
        case schema
        case strongAcceptanceScore
        case ambiguityMargin
        case evidenceFloor
        case titleGate
        case uniqueTitleRescue
        case titleAgreementRescue
        case collectorNumberScope
        case hubSimilarity
        case hubDistinctNames
        case hubTopK
        case queryNormalization
    }

    /// Missing keys take the `fallback` value so a manifest may declare only
    /// what it calibrated; an unknown `schema` is rejected by `isValid`.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let defaults = Self.fallback
        declaredSchema = try container.decodeIfPresent(String.self, forKey: .schema)
        strongAcceptanceScore = try container.decodeIfPresent(Double.self, forKey: .strongAcceptanceScore)
            ?? defaults.strongAcceptanceScore
        ambiguityMargin = try container.decodeIfPresent(Double.self, forKey: .ambiguityMargin)
            ?? defaults.ambiguityMargin
        evidenceFloor = try container.decodeIfPresent(Double.self, forKey: .evidenceFloor)
            ?? defaults.evidenceFloor
        titleGate = try container.decodeIfPresent(TitleGate.self, forKey: .titleGate)
            ?? defaults.titleGate
        uniqueTitleRescue = try container.decodeIfPresent(Bool.self, forKey: .uniqueTitleRescue)
            ?? defaults.uniqueTitleRescue
        titleAgreementRescue = try container.decodeIfPresent(Bool.self, forKey: .titleAgreementRescue)
            ?? defaults.titleAgreementRescue
        collectorNumberScope = try container.decodeIfPresent(CollectorNumberScope.self, forKey: .collectorNumberScope)
            ?? defaults.collectorNumberScope
        hubSimilarity = try container.decodeIfPresent(Double.self, forKey: .hubSimilarity) ?? defaults.hubSimilarity
        hubDistinctNames = try container.decodeIfPresent(Int.self, forKey: .hubDistinctNames) ?? defaults.hubDistinctNames
        hubTopK = try container.decodeIfPresent(Int.self, forKey: .hubTopK) ?? defaults.hubTopK
        queryNormalization = try container.decodeIfPresent(QueryNormalization.self, forKey: .queryNormalization)
            ?? defaults.queryNormalization
    }

    private var declaredSchema: String?

    /// Structural validity of a declared policy. Values outside these ranges
    /// mean a broken publish, and the client falls back to its built-in
    /// profile rather than scanning with nonsense thresholds.
    var isValid: Bool {
        (declaredSchema == nil || declaredSchema == Self.schema)
            && (0.0...1.0).contains(strongAcceptanceScore)
            && (0.0...1.0).contains(ambiguityMargin)
            && (0.0...1.0).contains(evidenceFloor)
            && evidenceFloor <= strongAcceptanceScore
            && (0.0...1.0).contains(hubSimilarity)
            && hubDistinctNames >= 0
            && hubTopK >= 1
    }

    /// Conservative profile for a game with no replay evidence: the highest
    /// measured strong-accept point, visual-first, bounded OCR rescues.
    static let fallback = ScannerGameAcceptancePolicy(
        strongAcceptanceScore: 0.70,
        ambiguityMargin: 0.05
    )

    /// Built-in profiles. These mirror `tools/scanner-acceptance-policies.json`
    /// for the shipped games and serve manifests that predate the field.
    static func builtin(
        for game: TCGGame,
        variant: ScannerEncoderVariant = .arcface
    ) -> ScannerGameAcceptancePolicy {
        switch (variant, game) {
        case (.arcface, .pokemon), (.arcface, .yugioh):
            return ScannerGameAcceptancePolicy(
                strongAcceptanceScore: variant.strongAcceptanceScore,
                ambiguityMargin: variant.ambiguityMargin
            )
        case (.arcface, .magic):
            // 49 labeled frames (2026-08-27 + 2026-08-29): plain-visual 0.65
            // admitted three wrong accepts at 0.64–0.69, 0.70 admitted none.
            // Binder pages keep the title requirement — a page multiplies
            // every false-positive opportunity by the pocket count.
            return ScannerGameAcceptancePolicy(
                strongAcceptanceScore: 0.70,
                ambiguityMargin: variant.ambiguityMargin,
                titleGate: .binderPage,
                queryNormalization: .greyWorldAutocontrast
            )
        case (.dinov2, _):
            // Historical DINOv2 calibration; its rejection gate and thresholds
            // are one atomic bundle with the encoder.
            return ScannerGameAcceptancePolicy(
                strongAcceptanceScore: variant.strongAcceptanceScore,
                ambiguityMargin: variant.ambiguityMargin,
                titleGate: game == .magic ? .intentionalCaptures : .never
            )
        default:
            return fallback
        }
    }

    /// The pre-2026-08-29 Magic policy: title gate on every intentional
    /// capture, encoder-wide strong accept, representative-only footer
    /// matching and no title/visual agreement rescue. Replayable from the
    /// same build with `SCANNER_MTG_LEGACY_POLICY=1`.
    static func legacyMagic(variant: ScannerEncoderVariant = .arcface) -> ScannerGameAcceptancePolicy {
        ScannerGameAcceptancePolicy(
            strongAcceptanceScore: variant.strongAcceptanceScore,
            ambiguityMargin: variant.ambiguityMargin,
            titleGate: .intentionalCaptures,
            uniqueTitleRescue: true,
            titleAgreementRescue: false,
            collectorNumberScope: .representative,
            hubDistinctNames: 0
        )
    }

    /// Hub collapse: `candidates` are (name, similarity) in ranked order.
    func isHubCollapse(_ candidates: [(name: String, similarity: Double)]) -> Bool {
        guard hubDistinctNames > 0 else { return false }
        var names: Set<String> = []
        for candidate in candidates.prefix(hubTopK) where candidate.similarity >= hubSimilarity {
            names.insert(CardTitleOCR.normalizedName(candidate.name))
        }
        return names.count >= hubDistinctNames
    }

    /// Whether this policy demands an exact printed title before accepting.
    func requiresTitleConfirmation(purpose: CardScanPurpose, source: ScanInvocationKind) -> Bool {
        switch titleGate {
        case .never:
            return false
        case .binderPage:
            return purpose == .binderPage
        case .intentionalCaptures:
            if purpose == .binderPage { return true }
            switch source {
            case .livePreview: return false
            case .photoCapture, .importedPhoto: return true
            }
        }
    }

    /// Environment overrides for sweeps and A/B replays (`TEST_RUNNER_`
    /// passthrough from xcodebuild). `SCANNER_STRONG_ACCEPT` and
    /// `SCANNER_AMBIGUITY_MARGIN` apply to every game;
    /// `SCANNER_STRONG_ACCEPT_<GAME>` (e.g. `_MAGIC`) to one game;
    /// `SCANNER_MTG_TITLE_GATE=1` and `SCANNER_MTG_LEGACY_POLICY=1` keep
    /// their historical meaning for Magic.
    func applyingEnvironmentOverrides(
        for game: TCGGame,
        variant: ScannerEncoderVariant = .arcface,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> ScannerGameAcceptancePolicy {
        func flag(_ name: String) -> Bool {
            environment[name].map { ["1", "true", "yes"].contains($0.lowercased()) } ?? false
        }
        var policy = self
        if game == .magic, flag("SCANNER_MTG_LEGACY_POLICY") {
            policy = Self.legacyMagic(variant: variant)
        }
        if game == .magic, flag("SCANNER_MTG_TITLE_GATE") {
            policy.titleGate = .intentionalCaptures
        }
        let gameKey = "SCANNER_STRONG_ACCEPT_" + game.rawValue.uppercased()
        if let raw = environment[gameKey], let value = Double(raw) {
            policy.strongAcceptanceScore = value
        }
        if let raw = environment["SCANNER_STRONG_ACCEPT"], let value = Double(raw) {
            policy.strongAcceptanceScore = value
        }
        if let raw = environment["SCANNER_AMBIGUITY_MARGIN"], let value = Double(raw) {
            policy.ambiguityMargin = value
        }
        return policy
    }

    /// The policy a strategy runs for `game`: a valid declared policy from
    /// the installed manifest, else the built-in profile, with environment
    /// overrides applied last.
    static func resolve(
        game: TCGGame,
        declared: ScannerGameAcceptancePolicy?,
        variant: ScannerEncoderVariant = .arcface,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> ScannerGameAcceptancePolicy {
        let base = (declared?.isValid == true ? declared : nil) ?? builtin(for: game, variant: variant)
        return base.applyingEnvironmentOverrides(for: game, variant: variant, environment: environment)
    }
}
