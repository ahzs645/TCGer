import Foundation

enum PricingSource: String, CaseIterable, Codable, Identifiable, Sendable {
    case justTCG = "justtcg"
    case collectrPrivateTest = "collectr-private-test"

    static let storageKey = "tcg.pricing.selectedSource"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .justTCG: return "JustTCG"
        case .collectrPrivateTest: return "Collectr"
        }
    }

    static func selected(in defaults: UserDefaults = .standard) -> PricingSource {
        defaults.string(forKey: storageKey).flatMap(PricingSource.init(rawValue:)) ?? .justTCG
    }
}

struct CardPriceQuote: Equatable, Sendable {
    let source: String
    let price: Double
    let currency: String
}

protocol CardPriceProviding: Sendable {
    var name: String { get }

    func fetchPrice(tcg: String, externalID: String) async throws -> CardPriceQuote?
}

struct CollectrProductMapping: Codable, Equatable, Identifiable, Sendable {
    let tcg: String
    let externalID: String
    let collectrProductID: String

    var id: String { Self.key(tcg: tcg, externalID: externalID) }

    static func key(tcg: String, externalID: String) -> String {
        "\(tcg.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()):\(externalID.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())"
    }
}

struct CollectrProductMappingStore {
    enum StoreError: LocalizedError {
        case emptyTCG
        case emptyExternalID
        case emptyProductID
        case encodingFailed

        var errorDescription: String? {
            switch self {
            case .emptyTCG: return "Choose a card game."
            case .emptyExternalID: return "Enter TCGer's external card ID."
            case .emptyProductID: return "Enter Collectr's product ID."
            case .encodingFailed: return "The Collectr product mapping could not be saved."
            }
        }
    }

    private static let defaultStorageKey = "tcg.pricing.collectrPrivate.productMappings"
    private let defaults: UserDefaults
    private let storageKey: String

    init(defaults: UserDefaults = .standard, storageKey: String = defaultStorageKey) {
        self.defaults = defaults
        self.storageKey = storageKey
    }

    var mappings: [CollectrProductMapping] {
        guard let data = defaults.data(forKey: storageKey),
              let decoded = try? JSONDecoder().decode([CollectrProductMapping].self, from: data) else {
            return []
        }
        return decoded.sorted { $0.id < $1.id }
    }

    func save(tcg: String, externalID: String, collectrProductID: String) throws {
        let normalizedTCG = tcg.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let normalizedExternalID = externalID.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedProductID = collectrProductID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedTCG.isEmpty else { throw StoreError.emptyTCG }
        guard !normalizedExternalID.isEmpty else { throw StoreError.emptyExternalID }
        guard !normalizedProductID.isEmpty else { throw StoreError.emptyProductID }

        let mapping = CollectrProductMapping(
            tcg: normalizedTCG,
            externalID: normalizedExternalID,
            collectrProductID: normalizedProductID
        )
        var updated = mappings.filter { $0.id != mapping.id }
        updated.append(mapping)
        guard let encoded = try? JSONEncoder().encode(updated) else {
            throw StoreError.encodingFailed
        }
        defaults.set(encoded, forKey: storageKey)
    }

    func remove(id: String) throws {
        let updated = mappings.filter { $0.id != id }
        guard let encoded = try? JSONEncoder().encode(updated) else {
            throw StoreError.encodingFailed
        }
        defaults.set(encoded, forKey: storageKey)
    }

    func removeAll() {
        defaults.removeObject(forKey: storageKey)
    }
}

struct CollectrPrivatePriceClient: Sendable {
    enum ClientError: LocalizedError {
        case invalidBaseURL
        case server(status: Int, message: String?)

        var errorDescription: String? {
            switch self {
            case .invalidBaseURL:
                return "Enter a valid HTTPS Collectr API base URL."
            case .server(let status, let message):
                return message.map { "Collectr returned HTTP \(status): \($0)" }
                    ?? "Collectr returned HTTP \(status)."
            }
        }
    }

    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func makeRequest(
        productID: String,
        configuration: CollectrPrivateAPIConfiguration
    ) throws -> URLRequest {
        guard let baseURL = URL(string: configuration.baseURL),
              baseURL.scheme?.lowercased() == "https" else {
            throw ClientError.invalidBaseURL
        }

        let productURL = baseURL
            .appendingPathComponent("catalog", isDirectory: true)
            .appendingPathComponent("products", isDirectory: true)
            .appendingPathComponent(productID, isDirectory: false)
        guard var components = URLComponents(url: productURL, resolvingAgainstBaseURL: false) else {
            throw ClientError.invalidBaseURL
        }
        var queryItems = [
            URLQueryItem(name: "username", value: configuration.username),
            URLQueryItem(name: "details", value: "true")
        ]
        if !configuration.collectionID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            queryItems.insert(
                URLQueryItem(name: "collectionId", value: configuration.collectionID),
                at: 1
            )
        }
        components.queryItems = queryItems
        guard let url = components.url else { throw ClientError.invalidBaseURL }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 10
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        configuration.nonEmptyHeaders.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        return request
    }

    func loadPayload(
        productID: String,
        configuration: CollectrPrivateAPIConfiguration
    ) async throws -> Data {
        let request = try makeRequest(productID: productID, configuration: configuration)
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ClientError.server(status: -1, message: "Invalid response")
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw ClientError.server(
                status: httpResponse.statusCode,
                message: message?.isEmpty == false ? message : nil
            )
        }
        return data
    }
}

/// Experimental adapter for Collectr product-detail responses used by private builds.
/// Authentication is supplied explicitly from the user's own captured session.
/// TCGer does not derive or embed Collectr's private security key.
struct CollectrTestPriceProvider: CardPriceProviding {
    enum ProviderError: LocalizedError {
        case mappingNotFound

        var errorDescription: String? {
            "No Collectr product ID is mapped to this card."
        }
    }

    typealias PayloadLoader = @Sendable (_ tcg: String, _ externalID: String) async throws -> Data

    let name = "collectr-test"
    private let loadPayload: PayloadLoader

    init(loadPayload: @escaping PayloadLoader) {
        self.loadPayload = loadPayload
    }

    init(
        configuration: CollectrPrivateAPIConfiguration,
        mappings: [CollectrProductMapping],
        session: URLSession = .shared
    ) {
        let mappingsByID = mappings.reduce(into: [String: String]()) { result, mapping in
            result[mapping.id] = mapping.collectrProductID
        }
        let client = CollectrPrivatePriceClient(session: session)
        self.init { tcg, externalID in
            let key = CollectrProductMapping.key(tcg: tcg, externalID: externalID)
            guard let productID = mappingsByID[key] else {
                throw ProviderError.mappingNotFound
            }
            return try await client.loadPayload(
                productID: productID,
                configuration: configuration
            )
        }
    }

    func fetchPrice(tcg: String, externalID: String) async throws -> CardPriceQuote? {
        let data = try await loadPayload(tcg, externalID)
        let payload = try JSONDecoder().decode(CollectrTestJSONValue.self, from: data)
        guard let product = payload.collectrProduct,
              let price = product["market_price"]?.positiveDouble else {
            return nil
        }

        let responseCurrency = product["currency"]?.stringValue?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .uppercased()
        let currency = responseCurrency.flatMap { $0.isEmpty ? nil : $0 } ?? "USD"
        return CardPriceQuote(source: name, price: price, currency: currency)
    }
}

private actor CollectrPrivatePriceCache {
    struct Entry: Sendable {
        let quote: CardPriceQuote
        let savedAt: Date
    }

    static let shared = CollectrPrivatePriceCache()
    private var entries: [String: Entry] = [:]
    private let lifetime: TimeInterval = 15 * 60

    func quote(for key: String) -> CardPriceQuote? {
        guard let entry = entries[key], Date().timeIntervalSince(entry.savedAt) < lifetime else {
            entries.removeValue(forKey: key)
            return nil
        }
        return entry.quote
    }

    func save(_ quote: CardPriceQuote, for key: String) {
        entries[key] = Entry(quote: quote, savedAt: Date())
    }

    func removeAll() {
        entries.removeAll()
    }
}

extension APIService {
    func applyingSelectedPricing(to cards: [Card]) async -> [Card] {
        guard PricingSource.selected() == .collectrPrivateTest,
              let configuration = try? CollectrPrivateCredentialStore.load() else {
            return cards
        }
        let mappings = CollectrProductMappingStore().mappings
        guard !mappings.isEmpty else { return cards }

        let provider = CollectrTestPriceProvider(
            configuration: configuration,
            mappings: mappings
        )
        return await applyingCollectrPricing(
            to: cards,
            provider: provider,
            mappings: mappings
        )
    }

    func applyingCollectrPricing<Provider: CardPriceProviding>(
        to cards: [Card],
        provider: Provider,
        mappings: [CollectrProductMapping]
    ) async -> [Card] {
        guard !mappings.isEmpty else { return cards }

        let cardKeys: Set<String> = Set(cards.flatMap { card -> [String] in
            var externalIDs = [card.id]
            if let baseExternalID = card.baseExternalId {
                externalIDs.append(baseExternalID)
            }
            return externalIDs.map {
                CollectrProductMapping.key(tcg: card.tcg, externalID: $0)
            }
        })
        let relevantMappings = mappings.filter { cardKeys.contains($0.id) }
        var pricesByID: [String: Double] = [:]

        for mapping in relevantMappings {
            if let cached = await CollectrPrivatePriceCache.shared.quote(for: mapping.id) {
                pricesByID[mapping.id] = cached.price
                continue
            }
            guard let quote = try? await provider.fetchPrice(
                tcg: mapping.tcg,
                externalID: mapping.externalID
            ) else { continue }
            await CollectrPrivatePriceCache.shared.save(quote, for: mapping.id)
            pricesByID[mapping.id] = quote.price
        }

        return cards.map { card in
            var candidateIDs = [card.id]
            if let baseExternalID = card.baseExternalId {
                candidateIDs.append(baseExternalID)
            }
            let price = candidateIDs.lazy.compactMap { externalID in
                pricesByID[CollectrProductMapping.key(tcg: card.tcg, externalID: externalID)]
            }.first
            return price.map { card.replacingPrice(with: $0) } ?? card
        }
    }

    func clearCollectrPrivatePriceCache() async {
        await CollectrPrivatePriceCache.shared.removeAll()
    }
}

private extension Card {
    func replacingPrice(with price: Double) -> Card {
        Card(
            id: id,
            name: name,
            tcg: tcg,
            setCode: setCode,
            setName: setName,
            rarity: rarity,
            artist: artist,
            imageUrl: imageUrl,
            imageUrlSmall: imageUrlSmall,
            price: price,
            collectorNumber: collectorNumber,
            releasedAt: releasedAt,
            supertype: supertype,
            subtypes: subtypes,
            types: types,
            formatLegality: formatLegality,
            dexEntries: dexEntries,
            region: region,
            setSymbolUrl: setSymbolUrl,
            setLogoUrl: setLogoUrl,
            regulationMark: regulationMark,
            language: language,
            pokemonPrint: pokemonPrint,
            attributes: attributes,
            provenance: provenance,
            legalityPeriods: legalityPeriods,
            evolution: evolution,
            functionalIdentity: functionalIdentity,
            baseExternalId: baseExternalId,
            printingKey: printingKey,
            artworkId: artworkId,
            printingKind: printingKind,
            sanctionedPlayLegal: sanctionedPlayLegal,
            originalPrintingKey: originalPrintingKey
        )
    }
}

private indirect enum CollectrTestJSONValue: Decodable, Sendable {
    case object([String: CollectrTestJSONValue])
    case array([CollectrTestJSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode([String: CollectrTestJSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([CollectrTestJSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported JSON value"
            )
        }
    }

    var objectValue: [String: CollectrTestJSONValue]? {
        guard case .object(let value) = self else { return nil }
        return value
    }

    var stringValue: String? {
        guard case .string(let value) = self else { return nil }
        return value
    }

    var positiveDouble: Double? {
        let value: Double?
        switch self {
        case .number(let number): value = number
        case .string(let string): value = Double(string.trimmingCharacters(in: .whitespacesAndNewlines))
        default: value = nil
        }
        guard let value, value.isFinite, value > 0 else { return nil }
        return value
    }

    var collectrProduct: [String: CollectrTestJSONValue]? {
        guard var product = objectValue else { return nil }
        let wrapperKeys = ["data", "product", "product_details", "productDetails"]
        for _ in 0..<wrapperKeys.count {
            if product["market_price"] != nil { break }
            guard let nested = wrapperKeys.lazy.compactMap({ product[$0]?.objectValue }).first else {
                break
            }
            product = nested
        }
        return product
    }
}
