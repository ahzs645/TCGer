import Foundation

struct JustTCGIdentifiers: Codable, Hashable, Sendable {
    var cardId: String?
    var variantId: String?
    var tcgplayerId: String?
    var mtgjsonId: String?
    var scryfallId: String?
    var tcgplayerSkuId: String?

    init(
        cardId: String? = nil,
        variantId: String? = nil,
        tcgplayerId: String? = nil,
        mtgjsonId: String? = nil,
        scryfallId: String? = nil,
        tcgplayerSkuId: String? = nil
    ) {
        self.cardId = Self.cleaned(cardId)
        self.variantId = Self.cleaned(variantId)
        self.tcgplayerId = Self.cleaned(tcgplayerId)
        self.mtgjsonId = Self.cleaned(mtgjsonId)
        self.scryfallId = Self.cleaned(scryfallId)
        self.tcgplayerSkuId = Self.cleaned(tcgplayerSkuId)
    }

    var isEmpty: Bool { lookupPair == nil }

    /// JustTCG documents this precedence for batch items.
    var lookupPair: (name: String, value: String)? {
        if let variantId { return ("variantId", variantId) }
        if let tcgplayerSkuId { return ("tcgplayerSkuId", tcgplayerSkuId) }
        if let tcgplayerId { return ("tcgplayerId", tcgplayerId) }
        if let mtgjsonId { return ("mtgjsonId", mtgjsonId) }
        if let scryfallId { return ("scryfallId", scryfallId) }
        if let cardId { return ("cardId", cardId) }
        return nil
    }

    var lookupKey: String? {
        lookupPair.map { "\($0.name):\($0.value.lowercased())" }
    }

    func merging(_ newer: JustTCGIdentifiers) -> JustTCGIdentifiers {
        JustTCGIdentifiers(
            cardId: newer.cardId ?? cardId,
            variantId: newer.variantId ?? variantId,
            tcgplayerId: newer.tcgplayerId ?? tcgplayerId,
            mtgjsonId: newer.mtgjsonId ?? mtgjsonId,
            scryfallId: newer.scryfallId ?? scryfallId,
            tcgplayerSkuId: newer.tcgplayerSkuId ?? tcgplayerSkuId
        )
    }

    static func inferred(tcg: String, externalId: String) -> JustTCGIdentifiers {
        let value = cleaned(externalId)
        guard let value else { return JustTCGIdentifiers() }
        // Older installed copies of the bundled demo collection only contain
        // placeholder external IDs. Keep those records priceable after app upgrades.
        let bundledSampleTCGplayerIDs = [
            "sample-pokemon-pikachu-base": "250303",
            "sample-pokemon-pikachu-surging": "590027",
            "sample-pokemon-charizard": "534416",
            "sample-magic-lightning-bolt-m10": "32656",
            "sample-magic-lightning-bolt-2xm": "276484",
            "sample-magic-black-lotus": "1042",
            "sample-ygo-blue-eyes": "22796"
        ]
        if let tcgplayerID = bundledSampleTCGplayerIDs[value.lowercased()] {
            return JustTCGIdentifiers(tcgplayerId: tcgplayerID)
        }
        if value.lowercased().hasPrefix("tcgplayer:") {
            return JustTCGIdentifiers(tcgplayerId: String(value.dropFirst("tcgplayer:".count)))
        }
        if tcg.caseInsensitiveCompare(TCGGame.magic.rawValue) == .orderedSame,
           UUID(uuidString: value) != nil {
            return JustTCGIdentifiers(scryfallId: value)
        }
        return JustTCGIdentifiers()
    }

    private static func cleaned(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
}

enum JustTCGIdentifierMappingStore {
    static let storageKey = "tcg.pricing.justtcg.identifierMappings.v1"

    static func key(tcg: String, externalId: String) -> String {
        "\(tcg.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()):\(externalId.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())"
    }

    static func load(from defaults: UserDefaults = .standard) -> [String: JustTCGIdentifiers] {
        guard let data = defaults.data(forKey: storageKey),
              let mappings = try? JSONDecoder().decode([String: JustTCGIdentifiers].self, from: data) else {
            return [:]
        }
        return mappings
    }

    static func save(
        _ identifiers: JustTCGIdentifiers,
        tcg: String,
        externalId: String,
        to defaults: UserDefaults = .standard
    ) {
        guard !identifiers.isEmpty else { return }
        var mappings = load(from: defaults)
        let mappingKey = key(tcg: tcg, externalId: externalId)
        mappings[mappingKey] = (mappings[mappingKey] ?? JustTCGIdentifiers()).merging(identifiers)
        if let data = try? JSONEncoder().encode(mappings) {
            defaults.set(data, forKey: storageKey)
        }
    }

    static func identifiers(
        tcg: String,
        externalId: String,
        in defaults: UserDefaults = .standard
    ) -> JustTCGIdentifiers? {
        load(from: defaults)[key(tcg: tcg, externalId: externalId)]
    }
}

extension CollectionCard {
    var justTCGIdentifiers: JustTCGIdentifiers {
        func string(_ keys: [String]) -> String? {
            let normalizedKeys = Set(keys.map { $0.lowercased().replacingOccurrences(of: "_", with: "") })
            for (key, value) in attributes ?? [:] {
                let normalized = key.lowercased().replacingOccurrences(of: "_", with: "")
                guard normalizedKeys.contains(normalized) else { continue }
                switch value {
                case .string(let text): return text
                case .number(let number): return number.formatted(.number.grouping(.never))
                default: continue
                }
            }
            return nil
        }

        let explicit = JustTCGIdentifiers(
            cardId: string(["justtcgCardId", "justtcgUuid"]),
            variantId: string(["justtcgVariantId"]),
            tcgplayerId: string(["tcgplayerId", "tcgplayerProductId"])
                ?? pokemonPrint?.worldChampionship?.sourceProductId,
            mtgjsonId: string(["mtgjsonId", "mtgjsonUuid"]),
            scryfallId: string(["scryfallId"]),
            tcgplayerSkuId: string(["tcgplayerSkuId"])
        )
        return JustTCGIdentifiers.inferred(
            tcg: tcg,
            externalId: externalId ?? cardId
        ).merging(explicit)
    }
}

extension APIService {
    struct JustTCGCardLookupHint: Codable, Hashable, Sendable {
        let name: String?
        let setCode: String?
        let setName: String?
        let collectorNumber: String?

        init(
            name: String? = nil,
            setCode: String? = nil,
            setName: String? = nil,
            collectorNumber: String? = nil
        ) {
            self.name = Self.cleaned(name)
            self.setCode = Self.cleaned(setCode)
            self.setName = Self.cleaned(setName)
            self.collectorNumber = Self.cleaned(collectorNumber)
        }

        private static func cleaned(_ value: String?) -> String? {
            let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return trimmed.isEmpty ? nil : trimmed
        }
    }

    func fetchOnDeviceJustTCGPrices(
        _ items: [TrackedPriceItem]
    ) async throws -> [String: CardPriceQuote] {
        guard let apiKey = try JustTCGCredentialStore.loadAPIKey() else { return [:] }
        return try await fetchOnDeviceJustTCGPrices(items, apiKey: apiKey)
    }

    func fetchOnDeviceJustTCGPrices(
        _ items: [TrackedPriceItem],
        apiKey: String
    ) async throws -> [String: CardPriceQuote] {

        var identifiersByItemKey: [String: JustTCGIdentifiers] = [:]
        for item in items {
            let saved = JustTCGIdentifierMappingStore.identifiers(
                tcg: item.tcg,
                externalId: item.externalId
            ) ?? JustTCGIdentifiers()
            let inferred = JustTCGIdentifiers.inferred(tcg: item.tcg, externalId: item.externalId)
            let identifiers = inferred.merging(saved).merging(item.identifiers ?? JustTCGIdentifiers())
            if !identifiers.isEmpty {
                identifiersByItemKey[item.key] = identifiers
            }
        }

        // Resolve older/non-Magic catalog IDs once, then persist the stable UUID
        // returned by JustTCG so later refreshes can go straight to the batch API.
        let unresolvedGroups = Dictionary(
            grouping: items.filter { identifiersByItemKey[$0.key] == nil },
            by: { "\($0.tcg.lowercased()):\($0.externalId.lowercased())" }
        )
        for unresolvedItems in unresolvedGroups.values {
            guard let representative = unresolvedItems.first else { continue }
            if let card = try await resolveJustTCGCard(representative, apiKey: apiKey) {
                let identifiers = card.identifiers
                for item in unresolvedItems {
                    identifiersByItemKey[item.key] = identifiers
                    JustTCGIdentifierMappingStore.save(
                        identifiers,
                        tcg: item.tcg,
                        externalId: item.externalId
                    )
                }
            }
        }

        let groups = Dictionary(grouping: items.compactMap { item -> (String, TrackedPriceItem, JustTCGIdentifiers)? in
            guard let identifiers = identifiersByItemKey[item.key],
                  let lookupKey = identifiers.lookupKey else { return nil }
            return (lookupKey, item, identifiers)
        }, by: { $0.0 })

        let uniqueLookups = groups.keys.sorted().compactMap { key -> JustTCGBatchLookup? in
            groups[key]?.first.map { JustTCGBatchLookup(identifiers: $0.2) }
        }
        var cardsByLookupKey: [String: JustTCGCard] = [:]
        for start in stride(from: 0, to: uniqueLookups.count, by: 20) {
            let end = min(start + 20, uniqueLookups.count)
            let cards = try await requestJustTCGBatch(
                Array(uniqueLookups[start..<end]),
                apiKey: apiKey
            )
            for card in cards {
                for lookup in uniqueLookups[start..<end] where card.matches(lookup.identifiers) {
                    if let lookupKey = lookup.identifiers.lookupKey {
                        cardsByLookupKey[lookupKey] = card
                    }
                }
            }
        }

        var quotes: [String: CardPriceQuote] = [:]
        for (lookupKey, requests) in groups {
            guard let card = cardsByLookupKey[lookupKey] else { continue }
            for (_, item, _) in requests {
                if let price = card.preferredPrice(for: item) {
                    quotes[item.key] = CardPriceQuote(source: "justtcg", price: price, currency: "USD")
                }
                JustTCGIdentifierMappingStore.save(
                    card.identifiers,
                    tcg: item.tcg,
                    externalId: item.externalId
                )
            }
        }
        return quotes
    }

    private func resolveJustTCGCard(
        _ item: TrackedPriceItem,
        apiKey: String
    ) async throws -> JustTCGCard? {
        guard let hint = item.lookupHint, let name = hint.name,
              var components = URLComponents(string: "https://api.justtcg.com/v1/cards") else {
            return nil
        }
        var queryItems = [
            URLQueryItem(name: "q", value: name),
            URLQueryItem(name: "game", value: Self.justTCGGameID(item.tcg)),
            URLQueryItem(name: "limit", value: "20")
        ]
        if let collectorNumber = hint.collectorNumber {
            queryItems.append(URLQueryItem(name: "number", value: collectorNumber))
        }
        components.queryItems = queryItems
        guard let url = components.url else { throw APIError.invalidURL }
        let payload = try await requestJustTCG(url: url, apiKey: apiKey)
        return payload.cards
            .filter { Self.cardNameMatches($0.name, requestedName: name) }
            .sorted { Self.cardMatchScore($0, hint: hint) > Self.cardMatchScore($1, hint: hint) }
            .first
    }

    private func requestJustTCGBatch(
        _ lookups: [JustTCGBatchLookup],
        apiKey: String
    ) async throws -> [JustTCGCard] {
        guard let url = URL(string: "https://api.justtcg.com/v1/cards") else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.httpBody = try JSONEncoder().encode(lookups)
        let (data, response) = try await execute(request)
        guard response.statusCode == 200 else {
            throw APIError.serverError(
                status: response.statusCode,
                message: parseServerMessage(from: data)
            )
        }
        guard let payload = try? JSONDecoder().decode(JustTCGCardsResponse.self, from: data) else {
            throw APIError.decodingError
        }
        return payload.cards
    }

    private func requestJustTCG(url: URL, apiKey: String) async throws -> JustTCGCardsResponse {
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        let (data, response) = try await execute(request)
        if response.statusCode == 404 { return JustTCGCardsResponse(cards: []) }
        guard response.statusCode == 200 else {
            throw APIError.serverError(
                status: response.statusCode,
                message: parseServerMessage(from: data)
            )
        }
        guard let payload = try? JSONDecoder().decode(JustTCGCardsResponse.self, from: data) else {
            throw APIError.decodingError
        }
        return payload
    }

    private static func justTCGGameID(_ tcg: String) -> String {
        switch tcg.lowercased() {
        case TCGGame.magic.rawValue: return "magic-the-gathering"
        case TCGGame.yugioh.rawValue: return "yugioh"
        case TCGGame.onepiece.rawValue: return "one-piece-card-game"
        case TCGGame.lorcana.rawValue: return "disney-lorcana"
        case TCGGame.dragonball.rawValue: return "dragon-ball-super-masters"
        default: return tcg.lowercased()
        }
    }

    private static func cardMatchScore(_ card: JustTCGCard, hint: JustTCGCardLookupHint) -> Int {
        var score = 0
        if let number = hint.collectorNumber,
           collectorNumberMatches(card.number, requestedNumber: number) { score += 8 }
        if let setName = hint.setName,
           identityContains(card.setName, requestedValue: setName) { score += 6 }
        if let setCode = hint.setCode,
           identityContains(card.set, requestedValue: setCode) { score += 3 }
        return score
    }

    private static func cardNameMatches(_ cardName: String?, requestedName: String) -> Bool {
        let card = normalizedIdentity(cardName)
        let requested = normalizedIdentity(requestedName)
        return card == requested || card.hasPrefix(requested) || requested.hasPrefix(card)
    }

    private static func collectorNumberMatches(_ cardNumber: String?, requestedNumber: String) -> Bool {
        func normalizedComponent(_ value: String?) -> String {
            let first = (value ?? "").split(separator: "/", maxSplits: 1).first.map(String.init) ?? ""
            let trimmed = first.drop(while: { $0 == "0" })
            return normalizedIdentity(trimmed.isEmpty ? first : String(trimmed))
        }
        return normalizedComponent(cardNumber) == normalizedComponent(requestedNumber)
    }

    private static func identityContains(_ value: String?, requestedValue: String) -> Bool {
        let candidate = normalizedIdentity(value)
        let requested = normalizedIdentity(requestedValue)
        return candidate == requested || candidate.contains(requested) || requested.contains(candidate)
    }

    private static func normalizedIdentity(_ value: String?) -> String {
        (value ?? "")
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            .unicodeScalars
            .filter(CharacterSet.alphanumerics.contains)
            .map(String.init)
            .joined()
            .lowercased()
    }
}

private struct JustTCGBatchLookup: Encodable {
    let identifiers: JustTCGIdentifiers

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: DynamicCodingKey.self)
        guard let pair = identifiers.lookupPair else { return }
        try container.encode(pair.value, forKey: DynamicCodingKey(pair.name))
    }
}

private struct DynamicCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int? = nil

    init(_ stringValue: String) { self.stringValue = stringValue }
    init?(stringValue: String) { self.init(stringValue) }
    init?(intValue: Int) { return nil }
}

private struct JustTCGCardsResponse: Decodable {
    let cards: [JustTCGCard]

    private enum CodingKeys: String, CodingKey { case data }

    init(cards: [JustTCGCard]) { self.cards = cards }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let cards = try? container.decode([JustTCGCard].self, forKey: .data) {
            self.cards = cards
        } else {
            self.cards = [try container.decode(JustTCGCard.self, forKey: .data)]
        }
    }
}

private struct JustTCGCard: Decodable {
    let id: String?
    let uuid: String?
    let name: String?
    let set: String?
    let setName: String?
    let number: String?
    let tcgplayerId: String?
    let mtgjsonId: String?
    let scryfallId: String?
    let variants: [JustTCGVariant]

    private enum CodingKeys: String, CodingKey {
        case id, uuid, name, set, number, tcgplayerId, mtgjsonId, scryfallId, variants
        case setName = "set_name"
    }

    var identifiers: JustTCGIdentifiers {
        JustTCGIdentifiers(
            cardId: uuid ?? id,
            tcgplayerId: tcgplayerId,
            mtgjsonId: mtgjsonId,
            scryfallId: scryfallId
        )
    }

    func matches(_ identifiers: JustTCGIdentifiers) -> Bool {
        func equal(_ lhs: String?, _ rhs: String?) -> Bool {
            guard let lhs, let rhs else { return false }
            return lhs.caseInsensitiveCompare(rhs) == .orderedSame
        }
        return equal(uuid, identifiers.cardId)
            || equal(id, identifiers.cardId)
            || equal(tcgplayerId, identifiers.tcgplayerId)
            || equal(mtgjsonId, identifiers.mtgjsonId)
            || equal(scryfallId, identifiers.scryfallId)
            || variants.contains { variant in
                equal(variant.uuid, identifiers.variantId)
                    || equal(variant.id, identifiers.variantId)
                    || equal(variant.tcgplayerSkuId, identifiers.tcgplayerSkuId)
            }
    }

    func preferredPrice(for item: APIService.TrackedPriceItem) -> Double? {
        variants
            .filter { ($0.price ?? 0) > 0 && ($0.price?.isFinite ?? false) }
            .sorted { $0.preferenceScore(for: item) < $1.preferenceScore(for: item) }
            .first?.price
    }
}

private struct JustTCGVariant: Decodable {
    let id: String?
    let uuid: String?
    let condition: String?
    let printing: String?
    let language: String?
    let tcgplayerSkuId: String?
    let price: Double?

    func preferenceScore(for item: APIService.TrackedPriceItem) -> Int {
        let conditionScore = Self.matches(condition, item.condition) ? 0
            : Self.matches(condition, JustTCGPricingPreferences.fallbackCondition) ? 1 : 2
        let languageScore = Self.matches(language, item.language) ? 0 : (language == nil ? 1 : 2)
        let printingScore = Self.printingScore(printing, finishCode: item.finishCode)
        return (conditionScore * 100) + (languageScore * 10) + printingScore
    }

    private static func matches(_ lhs: String?, _ rhs: String?) -> Bool {
        guard let lhs, let rhs else { return lhs == nil && rhs == nil }
        func normalized(_ value: String) -> String {
            value.lowercased().filter(\.isLetter)
        }
        return normalized(lhs) == normalized(rhs)
    }

    private static func printingScore(_ printing: String?, finishCode: String?) -> Int {
        let printing = printing?.lowercased() ?? ""
        let finish = finishCode?.lowercased() ?? ""
        if finish.contains("etched") { return printing.contains("etched") ? 0 : 3 }
        if finish.contains("reverse") { return printing.contains("reverse") ? 0 : 3 }
        if finish.contains("foil") || finish.contains("holo") {
            return (printing.contains("foil") || printing.contains("holo")) ? 0 : 3
        }
        return (printing.contains("foil") || printing.contains("holo") || printing.contains("etched")) ? 3 : 0
    }
}
