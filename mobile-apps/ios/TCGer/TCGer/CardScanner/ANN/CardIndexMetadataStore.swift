import Foundation

struct CardIndexPrintingEntry: Codable, Hashable, Sendable {
    let cardId: String
    let exactPrintingId: String?
    let format: String?
    let setCode: String?
    let collectorNumber: String?
    let setName: String?
    let rarity: String?
    let imageURL: String?
    let price: Double?
    let releaseDate: String?
}

struct CardIndexMetadataEntry: Codable {
    let annIndex: Int
    let cardId: String
    let exactPrintingId: String?
    let recognitionFamilyId: String?
    let name: String
    let game: String?
    /// `pocket` identifies digital-only Pokémon TCG Pocket artwork. Older
    /// generated indices omit this field, so `isPhysicalScanEligible` also
    /// recognizes the stable TCGdex `/tcgp/` asset path.
    let format: String?
    let setCode: String?
    let collectorNumber: String?
    let setName: String?
    let rarity: String?
    let imageURL: String?
    let price: Double?
    let releaseDate: String?
    let printings: [CardIndexPrintingEntry]?

    init(
        annIndex: Int,
        cardId: String,
        exactPrintingId: String? = nil,
        recognitionFamilyId: String? = nil,
        name: String,
        game: String?,
        format: String? = nil,
        setCode: String?,
        collectorNumber: String? = nil,
        setName: String?,
        rarity: String?,
        imageURL: String?,
        price: Double?,
        releaseDate: String? = nil,
        printings: [CardIndexPrintingEntry]? = nil
    ) {
        self.annIndex = annIndex
        self.cardId = cardId
        self.exactPrintingId = exactPrintingId
        self.recognitionFamilyId = recognitionFamilyId
        self.name = name
        self.game = game
        self.format = format
        self.setCode = setCode
        self.collectorNumber = collectorNumber
        self.setName = setName
        self.rarity = rarity
        self.imageURL = imageURL
        self.price = price
        self.releaseDate = releaseDate
        self.printings = printings
    }

    nonisolated var resolvedGame: TCGGame {
        guard let game else { return .pokemon }
        switch game.lowercased() {
        case "pokemon": return .pokemon
        case "magic", "mtg": return .magic
        case "yugioh", "yu-gi-oh", "yu_gi_oh": return .yugioh
        default: return .all
        }
    }

    nonisolated var isPhysicalScanEligible: Bool {
        if format?.caseInsensitiveCompare("pocket") == .orderedSame {
            return false
        }
        if imageURL?.localizedCaseInsensitiveContains("/tcgp/") == true {
            return false
        }
        return !ScannerGalleryExclusions.excludes(name: name, game: resolvedGame)
    }

    /// Scanner packages published before the visual-family contract omit a
    /// family id. Falling back to normalized game + card name keeps those
    /// packages usable: title-confirmed same-name printings are treated as one
    /// unresolved family instead of being rejected as unrelated ambiguity.
    /// New packages always win by supplying their artwork-derived family id.
    nonisolated var resolvedRecognitionFamilyId: String? {
        if let recognitionFamilyId,
           !recognitionFamilyId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return recognitionFamilyId
        }
        let game = resolvedGame
        let normalizedName = CardTitleOCR.normalizedName(name)
        guard game != .all, !normalizedName.isEmpty else { return nil }
        return "\(game.rawValue):legacy-name:\(normalizedName)"
    }

    nonisolated func contains(setCode requestedSetCode: String) -> Bool {
        if setCode?.caseInsensitiveCompare(requestedSetCode) == .orderedSame { return true }
        return printings?.contains {
            $0.setCode?.caseInsensitiveCompare(requestedSetCode) == .orderedSame
        } == true
    }
}

actor CardIndexMetadataStore {
    enum MetadataError: Error {
        case metadataUnavailable
    }

    static let shared = CardIndexMetadataStore()

    private let bundle: Bundle?
    private let fileURL: URL?
    private let resource: String
    private let fileExtension: String
    private var cache: [Int: CardIndexMetadataEntry] = [:]
    private var indicesByGameAndName: [TCGGame: [String: Set<Int>]] = [:]
    private var isLoaded = false
    /// Memoized `physicalCardIndices` results. Safe to keep forever: `cache`
    /// is immutable once loaded (bundle decode or the in-memory initializer),
    /// so a (game, setCode) answer can never change within a process.
    private var physicalIndicesMemo: [String: Set<Int>] = [:]
    nonisolated let supportedGames: Set<TCGGame>

    init(
        bundle: Bundle = .main,
        resource: String = "CardsIndexMetadata",
        fileExtension: String = "json"
    ) {
        self.bundle = bundle
        fileURL = nil
        self.resource = resource
        self.fileExtension = fileExtension
        supportedGames = Self.detectSupportedGames(
            in: bundle,
            resource: resource,
            fileExtension: fileExtension
        )
    }

    init(fileURL: URL) {
        bundle = nil
        self.fileURL = fileURL
        resource = ""
        fileExtension = ""
        supportedGames = Self.detectSupportedGames(at: fileURL)
    }

    /// In-memory initializer for unit tests and imported replay manifests.
    init(entries: [CardIndexMetadataEntry]) {
        bundle = nil
        fileURL = nil
        resource = ""
        fileExtension = ""
        cache = entries.reduce(into: [:]) { result, entry in
            result[entry.annIndex] = entry
        }
        indicesByGameAndName = Self.makeNameIndex(entries)
        isLoaded = true
        supportedGames = Set(entries.map(\.resolvedGame).filter { $0 != .all })
    }

    func entry(for index: Int) -> CardIndexMetadataEntry? {
        loadIfNeeded()
        return cache[index]
    }

    func details(for index: Int) -> CardDetails? {
        loadIfNeeded()
        guard let entry = cache[index] else { return nil }
        return Self.makeDetails(from: entry)
    }

    func printingDetails(for index: Int, setCode: String? = nil) -> [CardDetails] {
        loadIfNeeded()
        guard let entry = cache[index] else { return [] }
        let rows = entry.printings ?? []
        guard !rows.isEmpty else { return [Self.makeDetails(from: entry)] }
        return rows
            .filter { printing in
                guard let setCode else { return true }
                return printing.setCode?.caseInsensitiveCompare(setCode) == .orderedSame
            }
            .map { Self.makeDetails(from: entry, printing: $0) }
    }

    func indices(for game: TCGGame) -> Set<Int> {
        loadIfNeeded()
        return Set(cache.values.lazy.filter { $0.resolvedGame == game }.map(\.annIndex))
    }

    func indices(for game: TCGGame, setCode: String?) -> Set<Int> {
        loadIfNeeded()
        guard let setCode else { return indices(for: game) }
        return Set(cache.values.lazy.filter {
            $0.resolvedGame == game &&
                $0.contains(setCode: setCode)
        }.map(\.annIndex))
    }

    /// Candidate rows suitable for a camera scan of a physical card. Pokémon
    /// TCG Pocket cards are digital-only and otherwise share `.pokemon`, which
    /// allowed unrelated Pocket art to become high-confidence physical-card
    /// matches.
    func physicalCardIndices(for game: TCGGame, setCode: String?) -> Set<Int> {
        loadIfNeeded()
        let memoKey = "\(game.rawValue)|\(setCode?.lowercased() ?? "*")"
        if ScannerPerfOptions.isAllowedIndexCacheEnabled,
           let memoized = physicalIndicesMemo[memoKey] {
            return memoized
        }
        let indices = Set(cache.values.lazy.filter {
            guard (game == .all || $0.resolvedGame == game),
                  $0.resolvedGame != .all,
                  $0.isPhysicalScanEligible
            else { return false }
            guard let setCode else { return true }
            return $0.contains(setCode: setCode)
        }.map(\.annIndex))
        if ScannerPerfOptions.isAllowedIndexCacheEnabled {
            physicalIndicesMemo[memoKey] = indices
        }
        return indices
    }

    func entries(for game: TCGGame, setCode: String) -> [CardIndexMetadataEntry] {
        loadIfNeeded()
        return cache.values
            .filter {
                $0.resolvedGame == game &&
                    $0.contains(setCode: setCode)
            }
            .sorted { $0.annIndex < $1.annIndex }
    }

    /// Returns the exact catalog name and printing rows confirmed by OCR.
    /// Matching is deliberately normalization-only (case, accents and
    /// punctuation); it does not use edit distance, so noisy text cannot pull
    /// the embedding search toward an unrelated card.
    func exactNameMatch(
        for candidates: [CardTitleOCR.Candidate],
        game: TCGGame,
        setCode: String?,
        physicalCardsOnly: Bool = false
    ) -> (name: String, indices: Set<Int>, printingCount: Int)? {
        loadIfNeeded()
        let names = indicesByGameAndName[game] ?? [:]
        let matches = candidates.compactMap { candidate -> (String, Set<Int>, Int, Double, Int)? in
            guard candidate.confidence >= 0.25 else { return nil }
            let key = CardTitleOCR.normalizedName(candidate.text)
            guard key.count >= 4, var indices = names[key], !indices.isEmpty else { return nil }
            if physicalCardsOnly {
                indices = indices.filter { cache[$0]?.isPhysicalScanEligible == true }
            }
            if let setCode {
                indices = indices.filter { cache[$0]?.contains(setCode: setCode) == true }
            }
            guard !indices.isEmpty,
                  let canonicalName = indices.compactMap({ cache[$0]?.name }).first
            else { return nil }
            let printingCount = indices.reduce(0) { count, index in
                guard let entry = cache[index] else { return count }
                if let setCode {
                    return count + (entry.printings?.filter {
                        $0.setCode?.caseInsensitiveCompare(setCode) == .orderedSame
                    }.count ?? 1)
                }
                return count + max(entry.printings?.count ?? 0, 1)
            }
            return (canonicalName, indices, key.count, candidate.confidence, printingCount)
        }
        .sorted {
            if $0.2 != $1.2 { return $0.2 > $1.2 }
            return $0.3 > $1.3
        }
        return matches.first.map { ($0.0, $0.1, $0.4) }
    }

    private func loadIfNeeded() {
        guard !isLoaded else { return }
        isLoaded = true
        let entries: [CardIndexMetadataEntry]
        if let fileURL {
            entries = Self.loadEntries(at: fileURL)
        } else if let bundle {
            entries = Self.loadEntries(
                from: bundle,
                resource: resource,
                fileExtension: fileExtension
            )
        } else {
            entries = []
        }
        cache = entries.reduce(into: [:]) { result, entry in
            result[entry.annIndex] = entry
        }
        indicesByGameAndName = Self.makeNameIndex(entries)
    }

    private nonisolated static func makeNameIndex(
        _ entries: [CardIndexMetadataEntry]
    ) -> [TCGGame: [String: Set<Int>]] {
        entries.reduce(into: [:]) { result, entry in
            let game = entry.resolvedGame
            guard game != .all else { return }
            let key = CardTitleOCR.normalizedName(entry.name)
            guard !key.isEmpty else { return }
            result[game, default: [:]][key, default: []].insert(entry.annIndex)
        }
    }

    private nonisolated static func makeDetails(from entry: CardIndexMetadataEntry) -> CardDetails {
        let identity = CardIdentity(
            id: entry.cardId,
            name: entry.name,
            game: entry.resolvedGame,
            setCode: entry.setCode,
            setName: entry.setName,
            collectorNumber: entry.collectorNumber,
            recognitionFamilyID: entry.resolvedRecognitionFamilyId,
            exactPrintingID: entry.exactPrintingId ?? entry.cardId,
            releaseDate: entry.releaseDate
        )
        let url = entry.imageURL.flatMap(URL.init(string:))
        return CardDetails(
            identity: identity,
            rarity: entry.rarity,
            imageURL: url,
            price: entry.price,
            sourceCard: nil
        )
    }


    private nonisolated static func makeDetails(
        from entry: CardIndexMetadataEntry,
        printing: CardIndexPrintingEntry
    ) -> CardDetails {
        CardDetails(
            identity: CardIdentity(
                id: printing.cardId,
                name: entry.name,
                game: entry.resolvedGame,
                setCode: printing.setCode,
                setName: printing.setName,
                collectorNumber: printing.collectorNumber,
                recognitionFamilyID: entry.resolvedRecognitionFamilyId,
                exactPrintingID: printing.exactPrintingId ?? printing.cardId,
                releaseDate: printing.releaseDate
            ),
            rarity: printing.rarity,
            imageURL: printing.imageURL.flatMap(URL.init(string:)),
            price: printing.price,
            sourceCard: nil
        )
    }

    private nonisolated static func loadEntries(
        from bundle: Bundle,
        resource: String,
        fileExtension: String
    ) -> [CardIndexMetadataEntry] {
        guard let url = bundle.url(forResource: resource, withExtension: fileExtension) else {
            return []
        }
        return loadEntries(at: url)
    }

    private nonisolated static func loadEntries(at url: URL) -> [CardIndexMetadataEntry] {
        do {
            let data = try Data(contentsOf: url)
            return try JSONDecoder().decode([CardIndexMetadataEntry].self, from: data)
        } catch {
            return []
        }
    }

    /// Determines mode support without decoding and indexing the full metadata
    /// catalog. The generated scanner metadata is compact JSON, so searching
    /// its memory-mapped bytes for the game field touches only a tiny fraction
    /// of the work performed by JSONDecoder and dictionary construction.
    private nonisolated static func detectSupportedGames(
        in bundle: Bundle,
        resource: String,
        fileExtension: String
    ) -> Set<TCGGame> {
        guard let url = bundle.url(forResource: resource, withExtension: fileExtension) else {
            return []
        }
        return detectSupportedGames(at: url)
    }

    private nonisolated static func detectSupportedGames(at url: URL) -> Set<TCGGame> {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return [] }

        let tokens: [(TCGGame, [Data])] = [
            (.pokemon, [Data(#""game":"pokemon""#.utf8), Data(#""game": "pokemon""#.utf8)]),
            (.magic, [Data(#""game":"magic""#.utf8), Data(#""game": "magic""#.utf8)]),
            (.yugioh, [
                Data(#""game":"yugioh""#.utf8),
                Data(#""game": "yugioh""#.utf8),
                Data(#""game":"yu-gi-oh""#.utf8),
                Data(#""game": "yu-gi-oh""#.utf8),
            ]),
        ]
        return Set(tokens.compactMap { game, patterns in
            patterns.contains { data.range(of: $0) != nil } ? game : nil
        })
    }
}

/// Catalog rows that are not scan targets and must never be retrieved:
/// substitute cards, World Championship bio cards, emblems, punchcards,
/// checklists. A blank or glare-saturated crop embeds within 0.93 of a
/// Double-Faced Substitute Card render — above every strong-accept point —
/// so these rows would turn degenerate input into confident wrong accepts.
/// Mirrors `tools/scanner-gallery-exclusions.json`; publishers drop the rows
/// when they re-pack an index, this keeps already-installed packs safe.
nonisolated enum ScannerGalleryExclusions {
    static let magicPatterns: [NSRegularExpression] = [
        "^double-faced substitute card$",
        "^substitute card$",
        "^blank card$",
        " bio( \\(\\d{4}\\))?$",
        " emblem$",
        "^punchcard$",
        "checklist",
        "^art card:",
        "^the tokenator$",
    ].compactMap { try? NSRegularExpression(pattern: $0, options: [.caseInsensitive]) }

    static func patterns(for game: TCGGame) -> [NSRegularExpression] {
        switch game {
        case .magic: return magicPatterns
        default: return []
        }
    }

    static func excludes(name: String, game: TCGGame) -> Bool {
        let patterns = patterns(for: game)
        guard !patterns.isEmpty else { return false }
        let range = NSRange(name.startIndex..., in: name)
        return patterns.contains { $0.firstMatch(in: name, options: [], range: range) != nil }
    }
}
