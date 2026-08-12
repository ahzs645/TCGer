import Foundation

extension APIService {

    // MARK: - Request Payloads

    private struct CreateWishlistRequest: Encodable {
        let name: String
        let description: String?
        let colorHex: String?
        let matchAnyPrinting: Bool?
    }

    private struct UpdateWishlistRequest: Encodable {
        let name: String?
        let description: String?
        let colorHex: String?
        let matchAnyPrinting: Bool?
    }

    private struct AddWishlistCardRequest: Encodable {
        let externalId: String
        let baseExternalId: String?
        let printingKey: String?
        let artworkId: String?
        let printingKind: String?
        let sanctionedPlayLegal: Bool?
        let originalPrintingKey: String?
        let tcg: String
        let name: String
        let setCode: String?
        let setName: String?
        let rarity: String?
        let artist: String?
        let imageUrl: String?
        let imageUrlSmall: String?
        let setSymbolUrl: String?
        let setLogoUrl: String?
        let collectorNumber: String?
        let releasedAt: String?
        let regulationMark: String?
        let language: String?
        let supertype: String?
        let formatLegality: PokemonFormatLegality?
        let dexEntries: [PokedexEntry]?
        let region: String?
        let pokemonPrint: PokemonPrintMetadata?
        let attributes: [String: JSONValue]?
        let provenance: JSONValue?
        let legalityPeriods: [JSONValue]?
        let evolution: JSONValue?
        let functionalIdentity: JSONValue?
        let notes: String?
    }

    private struct BatchAddWishlistCardsRequest: Encodable {
        let cards: [AddWishlistCardRequest]
    }

    private struct CreateWishlistRuleRequest: Encodable {
        let type: String
        let tcg: String?
        let query: String?
        let setCode: String?
        let setName: String?
        let includeAllPrintings: Bool
        let autoSync: Bool
    }

    private struct UpdateWishlistRuleRequest: Encodable {
        let autoSync: Bool?
        let includeAllPrintings: Bool?
        let lastSyncedAt: String?
        let lastMatchCount: Int?
    }

    /// Cards per batch request; matches WISHLIST_CARD_BATCH_SIZE on the server.
    static let wishlistCardBatchSize = 100

    private static func wishlistCardRequest(from card: Card) -> AddWishlistCardRequest {
        AddWishlistCardRequest(
            externalId: card.id,
            baseExternalId: card.baseExternalId,
            printingKey: card.printingKey,
            artworkId: card.artworkId,
            printingKind: card.printingKind,
            sanctionedPlayLegal: card.sanctionedPlayLegal,
            originalPrintingKey: card.originalPrintingKey,
            tcg: card.tcg,
            name: card.name,
            setCode: card.setCode,
            setName: card.setName,
            rarity: card.rarity,
            artist: card.artist,
            imageUrl: card.imageUrl,
            imageUrlSmall: card.imageUrlSmall,
            setSymbolUrl: card.setSymbolUrl,
            setLogoUrl: card.setLogoUrl,
            collectorNumber: card.collectorNumber,
            releasedAt: card.releasedAt.map { ISO8601DateFormatter().string(from: $0) },
            regulationMark: card.regulationMark,
            language: card.language,
            supertype: card.supertype,
            formatLegality: card.formatLegality,
            dexEntries: card.dexEntries,
            region: card.region,
            pokemonPrint: card.pokemonPrint,
            attributes: card.attributes,
            provenance: card.provenance,
            legalityPeriods: card.legalityPeriods,
            evolution: card.evolution,
            functionalIdentity: card.functionalIdentity,
            notes: nil
        )
    }

    // MARK: - Wishlists

    func getWishlists(
        config: ServerConfiguration,
        token: String
    ) async throws -> [Wishlist] {
        if config.isOnDevice { return LocalStore.shared.getWishlists() }
        let (data, response) = try await makeRequest(
            config: config,
            path: "wishlists",
            token: token
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let wishlists = try? JSONDecoder().decode([Wishlist].self, from: data) else {
            throw APIError.decodingError
        }
        return wishlists
    }

    func getWishlist(
        config: ServerConfiguration,
        token: String,
        id: String
    ) async throws -> Wishlist {
        if config.isOnDevice { return try LocalStore.shared.getWishlist(id: id) }
        let (data, response) = try await makeRequest(
            config: config,
            path: "wishlists/\(id)",
            token: token
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let wishlist = try? JSONDecoder().decode(Wishlist.self, from: data) else {
            throw APIError.decodingError
        }
        return wishlist
    }

    func createWishlist(
        config: ServerConfiguration,
        token: String,
        name: String,
        description: String? = nil,
        colorHex: String? = nil,
        matchAnyPrinting: Bool? = nil
    ) async throws -> Wishlist {
        if config.isOnDevice {
            let wishlist = LocalStore.shared.createWishlist(
                name: name,
                description: description,
                colorHex: colorHex,
                matchAnyPrinting: matchAnyPrinting
            )
            try LocalStore.shared.requireLatestMutationPersisted()
            return wishlist
        }
        let body = CreateWishlistRequest(
            name: name,
            description: description,
            colorHex: colorHex,
            matchAnyPrinting: matchAnyPrinting
        )
        let (data, response) = try await makeRequest(
            config: config,
            path: "wishlists",
            method: "POST",
            token: token,
            body: body
        )

        guard response.statusCode == 201 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let wishlist = try? JSONDecoder().decode(Wishlist.self, from: data) else {
            throw APIError.decodingError
        }
        return wishlist
    }

    func updateWishlist(
        config: ServerConfiguration,
        token: String,
        id: String,
        name: String? = nil,
        description: String? = nil,
        colorHex: String? = nil,
        matchAnyPrinting: Bool? = nil
    ) async throws -> Wishlist {
        if config.isOnDevice {
            return try LocalStore.shared.updateWishlist(
                id: id,
                name: name,
                description: description,
                colorHex: colorHex,
                matchAnyPrinting: matchAnyPrinting
            )
        }
        let body = UpdateWishlistRequest(
            name: name,
            description: description,
            colorHex: colorHex,
            matchAnyPrinting: matchAnyPrinting
        )
        let (data, response) = try await makeRequest(
            config: config,
            path: "wishlists/\(id)",
            method: "PATCH",
            token: token,
            body: body
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let wishlist = try? JSONDecoder().decode(Wishlist.self, from: data) else {
            throw APIError.decodingError
        }
        return wishlist
    }

    func deleteWishlist(
        config: ServerConfiguration,
        token: String,
        id: String
    ) async throws {
        if config.isOnDevice {
            LocalStore.shared.deleteWishlist(id: id)
            try LocalStore.shared.requireLatestMutationPersisted()
            return
        }
        let (data, response) = try await makeRequest(
            config: config,
            path: "wishlists/\(id)",
            method: "DELETE",
            token: token
        )

        guard response.statusCode == 200 || response.statusCode == 204 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
    }

    // MARK: - Wishlist Cards

    func addCardToWishlist(
        config: ServerConfiguration,
        token: String,
        wishlistId: String,
        card: Card
    ) async throws -> WishlistCard {
        if config.isOnDevice { return try LocalStore.shared.addCardToWishlist(wishlistId: wishlistId, card: card) }
        let body = Self.wishlistCardRequest(from: card)
        let (data, response) = try await makeRequest(
            config: config,
            path: "wishlists/\(wishlistId)/cards",
            method: "POST",
            token: token,
            body: body
        )

        guard response.statusCode == 201 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let wishlistCard = try? JSONDecoder().decode(WishlistCard.self, from: data) else {
            throw APIError.decodingError
        }
        return wishlistCard
    }

    /// Adds up to `wishlistCardBatchSize` cards in one request. Callers with
    /// more cards should chunk (see `WishlistSyncService`).
    @discardableResult
    func addCardsToWishlist(
        config: ServerConfiguration,
        token: String,
        wishlistId: String,
        cards: [Card]
    ) async throws -> Wishlist {
        if config.isOnDevice {
            return try LocalStore.shared.addCardsToWishlist(wishlistId: wishlistId, cards: cards)
        }
        let body = BatchAddWishlistCardsRequest(cards: cards.map(Self.wishlistCardRequest(from:)))
        let (data, response) = try await makeRequest(
            config: config,
            path: "wishlists/\(wishlistId)/cards/batch",
            method: "POST",
            token: token,
            body: body
        )

        guard response.statusCode == 200 || response.statusCode == 201 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let wishlist = try? JSONDecoder().decode(Wishlist.self, from: data) else {
            throw APIError.decodingError
        }
        return wishlist
    }

    // MARK: - Wishlist Rules

    func addWishlistRule(
        config: ServerConfiguration,
        token: String,
        wishlistId: String,
        type: WishlistRule.RuleType,
        tcg: String? = nil,
        query: String? = nil,
        setCode: String? = nil,
        setName: String? = nil,
        includeAllPrintings: Bool = true,
        autoSync: Bool = true
    ) async throws -> WishlistRule {
        if config.isOnDevice {
            return try LocalStore.shared.addWishlistRule(
                wishlistId: wishlistId,
                type: type,
                tcg: tcg,
                query: query,
                setCode: setCode,
                setName: setName,
                includeAllPrintings: includeAllPrintings,
                autoSync: autoSync
            )
        }
        let body = CreateWishlistRuleRequest(
            type: type.rawValue,
            tcg: tcg,
            query: query,
            setCode: setCode,
            setName: setName,
            includeAllPrintings: includeAllPrintings,
            autoSync: autoSync
        )
        let (data, response) = try await makeRequest(
            config: config,
            path: "wishlists/\(wishlistId)/rules",
            method: "POST",
            token: token,
            body: body
        )

        guard response.statusCode == 200 || response.statusCode == 201 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let rule = try? JSONDecoder().decode(WishlistRule.self, from: data) else {
            throw APIError.decodingError
        }
        return rule
    }

    @discardableResult
    func updateWishlistRule(
        config: ServerConfiguration,
        token: String,
        wishlistId: String,
        ruleId: String,
        autoSync: Bool? = nil,
        includeAllPrintings: Bool? = nil,
        lastSyncedAt: String? = nil,
        lastMatchCount: Int? = nil
    ) async throws -> WishlistRule {
        if config.isOnDevice {
            return try LocalStore.shared.updateWishlistRule(
                wishlistId: wishlistId,
                ruleId: ruleId,
                autoSync: autoSync,
                includeAllPrintings: includeAllPrintings,
                lastSyncedAt: lastSyncedAt,
                lastMatchCount: lastMatchCount
            )
        }
        let body = UpdateWishlistRuleRequest(
            autoSync: autoSync,
            includeAllPrintings: includeAllPrintings,
            lastSyncedAt: lastSyncedAt,
            lastMatchCount: lastMatchCount
        )
        let (data, response) = try await makeRequest(
            config: config,
            path: "wishlists/\(wishlistId)/rules/\(ruleId)",
            method: "PATCH",
            token: token,
            body: body
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let rule = try? JSONDecoder().decode(WishlistRule.self, from: data) else {
            throw APIError.decodingError
        }
        return rule
    }

    func removeWishlistRule(
        config: ServerConfiguration,
        token: String,
        wishlistId: String,
        ruleId: String
    ) async throws {
        if config.isOnDevice {
            LocalStore.shared.removeWishlistRule(wishlistId: wishlistId, ruleId: ruleId)
            try LocalStore.shared.requireLatestMutationPersisted()
            return
        }
        let (data, response) = try await makeRequest(
            config: config,
            path: "wishlists/\(wishlistId)/rules/\(ruleId)",
            method: "DELETE",
            token: token
        )

        guard response.statusCode == 200 || response.statusCode == 204 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
    }

    func removeCardFromWishlist(
        config: ServerConfiguration,
        token: String,
        wishlistId: String,
        cardId: String
    ) async throws {
        if config.isOnDevice {
            LocalStore.shared.removeCardFromWishlist(wishlistId: wishlistId, cardId: cardId)
            try LocalStore.shared.requireLatestMutationPersisted()
            return
        }
        let (data, response) = try await makeRequest(
            config: config,
            path: "wishlists/\(wishlistId)/cards/\(cardId)",
            method: "DELETE",
            token: token
        )

        guard response.statusCode == 200 || response.statusCode == 204 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
    }
}
