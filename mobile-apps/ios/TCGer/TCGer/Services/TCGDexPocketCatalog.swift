import Foundation

// MARK: - TCGdex transport models

nonisolated struct TCGDexPocketSeries: Decodable, Sendable {
    let id: String
    let name: String
    let releaseDate: String?
    let sets: [TCGDexPocketSet]
}

nonisolated struct TCGDexPocketSet: Decodable, Sendable {
    struct CardCount: Decodable, Sendable {
        let official: Int
        let total: Int
    }

    let cardCount: CardCount
    let id: String
    let logo: String?
    let name: String?
    let symbol: String?
    let releaseDate: String?
    let serie: TCGDexPocketSeriesReference?
    let boosters: [PokemonBooster]?
    let cards: [TCGDexPocketCardSummary]?
}

nonisolated struct TCGDexPocketSeriesReference: Decodable, Sendable {
    let id: String
    let name: String?
}

nonisolated struct TCGDexPocketCardSummary: Decodable, Sendable {
    let id: String
    let image: String?
    let localId: String
    let name: String
}

nonisolated enum TCGDexStringOrNumber: Decodable, Sendable {
    case string(String)
    case number(Int)

    var displayValue: String {
        switch self {
        case .string(let value): value
        case .number(let value): String(value)
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let string = try? container.decode(String.self) {
            self = .string(string)
        } else {
            self = .number(try container.decode(Int.self))
        }
    }
}

nonisolated struct TCGDexPocketCard: Decodable, Sendable {
    struct SetReference: Decodable, Sendable {
        let cardCount: TCGDexPocketSet.CardCount
        let id: String
        let logo: String?
        let name: String
        let symbol: String?
    }

    struct Variants: Decodable, Sendable {
        let firstEdition: Bool?
        let holo: Bool?
        let normal: Bool?
        let reverse: Bool?
        let wPromo: Bool?
    }

    struct Ability: Decodable, Sendable {
        let type: String?
        let name: String
        let effect: String
    }

    struct Attack: Decodable, Sendable {
        let cost: [String]?
        let name: String
        let effect: String?
        let damage: TCGDexStringOrNumber?
    }

    struct Weakness: Decodable, Sendable {
        let type: String
        let value: String
    }

    struct Legality: Decodable, Sendable {
        let standard: Bool?
        let expanded: Bool?
    }

    let id: String
    let category: String
    let illustrator: String?
    let image: String?
    let localId: String
    let name: String
    let rarity: String?
    let set: SetReference
    let variants: Variants?
    let effect: String?
    let hp: Int?
    let types: [String]?
    let description: String?
    let stage: String?
    let abilities: [Ability]?
    let attacks: [Attack]?
    let weaknesses: [Weakness]?
    let retreat: Int?
    let legal: Legality?
    let boosters: [PokemonBooster]?
}

// MARK: - Safe endpoints and HTTP client

nonisolated struct TCGDexPocketEndpoints: Sendable {
    enum EndpointError: Error, Equatable {
        case invalidBaseURL
        case invalidIdentifier
    }

    let baseURL: URL

    init(baseURL: URL = URL(string: "https://api.tcgdex.net/v2/en")!) throws {
        guard baseURL.scheme == "https", baseURL.host != nil else {
            throw EndpointError.invalidBaseURL
        }
        self.baseURL = baseURL
    }

    func series() -> URL {
        baseURL.appendingPathComponent("series").appendingPathComponent("tcgp")
    }

    func set(id: String) throws -> URL {
        try resourceURL(collection: "sets", id: id)
    }

    func card(id: String) throws -> URL {
        try resourceURL(collection: "cards", id: id)
    }

    private func resourceURL(collection: String, id: String) throws -> URL {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
        guard !id.isEmpty, id.unicodeScalars.allSatisfy(allowed.contains) else {
            throw EndpointError.invalidIdentifier
        }
        return baseURL.appendingPathComponent(collection).appendingPathComponent(id)
    }
}

actor TCGDexPocketClient {
    enum ClientError: LocalizedError, Equatable {
        case invalidResponse
        case httpStatus(Int)

        var errorDescription: String? {
            switch self {
            case .invalidResponse: "TCGdex returned an invalid response."
            case .httpStatus(let status): "TCGdex returned HTTP status \(status)."
            }
        }
    }

    private let session: URLSession
    private let endpoints: TCGDexPocketEndpoints
    private let decoder = JSONDecoder()

    init(
        session: URLSession = .shared,
        endpoints: TCGDexPocketEndpoints = try! TCGDexPocketEndpoints()
    ) {
        self.session = session
        self.endpoints = endpoints
    }

    func fetchSeries() async throws -> TCGDexPocketSeries {
        try await fetch(TCGDexPocketSeries.self, from: endpoints.series())
    }

    func fetchSet(id: String) async throws -> TCGDexPocketSet {
        try await fetch(TCGDexPocketSet.self, from: endpoints.set(id: id))
    }

    func fetchCard(id: String) async throws -> TCGDexPocketCard {
        try await fetch(TCGDexPocketCard.self, from: endpoints.card(id: id))
    }

    private func fetch<Value: Decodable>(_ type: Value.Type, from url: URL) async throws -> Value {
        try Task.checkCancellation()
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 30
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ClientError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw ClientError.httpStatus(httpResponse.statusCode)
        }
        // Deliberately do not log payloads: a decode error provides the coding
        // path without leaking or flooding logs with raw upstream JSON.
        return try decoder.decode(type, from: data)
    }
}

// MARK: - Adapter used by the shared/offline catalog importer

nonisolated struct TCGDexPocketCatalogSnapshot: Sendable {
    let sets: [TcgSet]
    let cards: [Card]
}

nonisolated enum TCGDexPocketCatalogAdapter {
    enum AdapterError: Error, Equatable {
        case unexpectedSeries(String)
    }

    static func map(
        series: TCGDexPocketSeries,
        cardDetails: [String: TCGDexPocketCard]
    ) throws -> TCGDexPocketCatalogSnapshot {
        guard series.id.lowercased() == "tcgp" else {
            throw AdapterError.unexpectedSeries(series.id)
        }

        let sets = series.sets.map(mapSet)
        let setsByID = Dictionary(uniqueKeysWithValues: sets.map { ($0.code, $0) })
        let cards = cardDetails.values
            .map { mapCard($0, set: setsByID[$0.set.id]) }
            .sorted { lhs, rhs in
                if lhs.setCode != rhs.setCode { return (lhs.setCode ?? "") < (rhs.setCode ?? "") }
                return (lhs.collectorNumber ?? "").localizedStandardCompare(rhs.collectorNumber ?? "") == .orderedAscending
            }
        return TCGDexPocketCatalogSnapshot(sets: sets, cards: cards)
    }

    static func imageURL(base: String?, quality: String) -> String? {
        guard let base,
              (quality == "low" || quality == "high"),
              var components = URLComponents(string: base),
              components.scheme == "https",
              components.host != nil else {
            return nil
        }
        if URL(fileURLWithPath: components.path).pathExtension.isEmpty {
            components.path += "/\(quality).webp"
        }
        return components.url?.absoluteString
    }

    static func setAssetURL(base: String?) -> String? {
        guard let base,
              var components = URLComponents(string: base),
              components.scheme == "https",
              components.host != nil else {
            return nil
        }
        if URL(fileURLWithPath: components.path).pathExtension.isEmpty {
            components.path += ".webp"
        }
        return components.url?.absoluteString
    }

    private static func mapSet(_ set: TCGDexPocketSet) -> TcgSet {
        TcgSet(
            code: set.id,
            name: set.name ?? set.id,
            tcg: TCGGame.pokemon.rawValue,
            releaseDate: set.releaseDate,
            totalCards: set.cardCount.total,
            standardCards: set.cardCount.official,
            iconUrl: setAssetURL(base: set.symbol),
            logoUrl: setAssetURL(base: set.logo),
            series: "tcgp",
            boosters: set.boosters
        )
    }

    private static func mapCard(_ card: TCGDexPocketCard, set: TcgSet?) -> Card {
        let formatLegality = card.legal.map {
            PokemonFormatLegality(standard: $0.standard, expanded: $0.expanded)
        }
        let variants = card.variants.map {
            PokemonVariantFlags(
                normal: $0.normal,
                reverse: $0.reverse,
                holo: $0.holo,
                firstEdition: $0.firstEdition
            )
        }
        let pocket = PokemonPocketMetadata(
            hp: card.hp,
            effect: card.effect,
            cardDescription: card.description,
            abilities: card.abilities?.map {
                PokemonAbility(type: $0.type, name: $0.name, effect: $0.effect)
            },
            attacks: card.attacks?.map {
                PokemonAttack(
                    cost: $0.cost ?? [],
                    name: $0.name,
                    effect: $0.effect,
                    damage: $0.damage?.displayValue
                )
            },
            weaknesses: card.weaknesses?.map {
                PokemonWeakness(type: $0.type, value: $0.value)
            },
            retreatCost: card.retreat,
            boosters: card.boosters
        )

        return Card(
            id: card.id,
            name: card.name,
            tcg: TCGGame.pokemon.rawValue,
            setCode: card.set.id,
            setName: set?.name ?? card.set.name,
            rarity: card.rarity,
            artist: card.illustrator,
            imageUrl: imageURL(base: card.image, quality: "high"),
            imageUrlSmall: imageURL(base: card.image, quality: "low"),
            price: nil,
            collectorNumber: card.localId,
            releasedAt: nil,
            supertype: card.category,
            subtypes: card.stage.map { [$0] },
            types: card.types,
            formatLegality: formatLegality,
            setSymbolUrl: set?.iconUrl,
            setLogoUrl: set?.logoUrl,
            pokemonPrint: PokemonPrintMetadata(
                tcgdexId: card.id,
                tcgdexImage: imageURL(base: card.image, quality: "high"),
                variants: variants,
                finishes: nil,
                category: card.category,
                regulationMark: nil,
                language: "EN",
                formatLegality: formatLegality,
                dexEntries: nil,
                region: nil,
                format: .pocket,
                pocket: pocket
            )
        )
    }
}

/// An explicit importer boundary for tools that refresh the shared generated
/// catalog. App screens consume `CatalogStore`; they do not call TCGdex.
struct TCGDexPocketCatalogImporter: Sendable {
    private let client: TCGDexPocketClient

    init(client: TCGDexPocketClient = TCGDexPocketClient()) {
        self.client = client
    }

    func fetchSnapshot() async throws -> TCGDexPocketCatalogSnapshot {
        let series = try await client.fetchSeries()
        var detailedSets: [TCGDexPocketSet] = []
        for batch in series.sets.chunked(into: 4) {
            try Task.checkCancellation()
            let values = try await withThrowingTaskGroup(of: TCGDexPocketSet.self) { group in
                for set in batch {
                    group.addTask { try await client.fetchSet(id: set.id) }
                }
                return try await group.reduce(into: []) { $0.append($1) }
            }
            detailedSets.append(contentsOf: values)
        }

        let summaries = detailedSets.flatMap { $0.cards ?? [] }
        var details: [String: TCGDexPocketCard] = [:]
        for batch in summaries.chunked(into: 8) {
            try Task.checkCancellation()
            let values = try await withThrowingTaskGroup(of: TCGDexPocketCard.self) { group in
                for card in batch {
                    group.addTask { try await client.fetchCard(id: card.id) }
                }
                return try await group.reduce(into: []) { $0.append($1) }
            }
            for card in values { details[card.id] = card }
        }

        let completeSeries = TCGDexPocketSeries(
            id: series.id,
            name: series.name,
            releaseDate: series.releaseDate,
            sets: detailedSets
        )
        return try TCGDexPocketCatalogAdapter.map(series: completeSeries, cardDetails: details)
    }
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        guard size > 0 else { return [] }
        return stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
