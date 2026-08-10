import Foundation

extension APIService {
    private struct FollowGuideRequest: Encodable {
        let wishlistName: String?
    }

    func getCollectionGuides(
        config: ServerConfiguration,
        token: String
    ) async throws -> [CollectionGuide] {
        if config.isOnDevice {
            return Self.localGuides()
        }
        let (data, response) = try await makeRequest(
            config: config,
            path: "guides",
            token: token
        )
        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        guard let guides = try? JSONDecoder().decode([CollectionGuide].self, from: data) else {
            throw APIError.decodingError
        }
        return guides
    }

    func followCollectionGuide(
        config: ServerConfiguration,
        token: String,
        slug: String,
        wishlistName: String? = nil
    ) async throws -> FollowCollectionGuideResponse {
        if config.isOnDevice {
            return try Self.followLocalGuide(slug: slug, wishlistName: wishlistName)
        }
        let (data, response) = try await makeRequest(
            config: config,
            path: "guides/\(slug.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? slug)/follow",
            method: "POST",
            token: token,
            body: FollowGuideRequest(wishlistName: wishlistName)
        )
        guard response.statusCode == 200 || response.statusCode == 201 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        guard let result = try? JSONDecoder().decode(FollowCollectionGuideResponse.self, from: data) else {
            throw APIError.decodingError
        }
        return result
    }

    private static func localGuides() -> [CollectionGuide] {
        let definitions = [CollectionGuide(
            id: "local-guide-pokemon-clay-art",
            slug: "pokemon-clay-art",
            title: "The Clay Collection",
            description: "A living guide to English Pokémon cards illustrated by Yuka Morii, best known for hand-sculpted clay scenes.",
            tcg: "pokemon",
            category: .artStyle,
            coverImageUrl: "https://assets.tcgdex.net/en/sm/sm6/1/high.webp",
            curatorName: "TCGer",
            tags: ["Clay", "Sculpture", "Photography", "Yuka Morii"],
            version: 1,
            featured: true,
            rule: CollectionGuideRule(
                type: .artist,
                tcg: "pokemon",
                query: "Yuka Morii",
                setCode: nil,
                setName: nil,
                includeAllPrintings: true
            ),
            cardCountHint: 224,
            followed: false,
            wishlistId: nil
        ), CollectionGuide(
            id: "local-guide-every-ditto",
            slug: "every-ditto",
            title: "Every Ditto",
            description: "Every English Pokémon TCG printing named Ditto, kept current as new sets are released.",
            tcg: "pokemon",
            category: .species,
            coverImageUrl: "https://assets.tcgdex.net/en/base/base3/3/high.webp",
            curatorName: "TCGer",
            tags: ["Ditto", "Pokémon", "Species Collection"],
            version: 1,
            featured: true,
            rule: CollectionGuideRule(
                type: .name,
                tcg: "pokemon",
                query: "Ditto",
                setCode: nil,
                setName: nil,
                includeAllPrintings: true
            ),
            cardCountHint: 30,
            followed: false,
            wishlistId: nil
        ), CollectionGuide(
            id: "local-guide-pokemon-crown-zenith-connected-art",
            slug: "pokemon-crown-zenith-connected-art",
            title: "Crown Zenith Connected Art",
            description: "Nine Galarian Gallery cards by Kouki Saitou that assemble into one continuous scene.",
            tcg: "pokemon",
            category: .story,
            coverImageUrl: "https://images.pokemontcg.io/swsh12pt5gg/GG30_hires.png",
            curatorName: "TCGer",
            tags: ["Connected Art", "Panorama", "Crown Zenith", "Kouki Saitou"],
            version: 1,
            featured: true,
            rule: CollectionGuideRule(
                type: .manual,
                tcg: "pokemon",
                query: nil,
                setCode: nil,
                setName: nil,
                includeAllPrintings: false
            ),
            cardCountHint: 9,
            followed: false,
            wishlistId: nil
        )]
        let wishlists = LocalStore.shared.getWishlists()
        return definitions.map { definition in
            let existing = wishlists.first { wishlist in
                if definition.rule.type == .manual {
                    return wishlist.name == definition.title
                        || wishlist.description == "Following the “\(definition.title)” collection guide."
                }
                return wishlist.expansionRules.contains { rule in
                    rule.type.rawValue == definition.rule.type.rawValue
                        && rule.tcg == definition.rule.tcg
                        && rule.query == definition.rule.query
                        && rule.setCode == definition.rule.setCode
                }
            }
            return CollectionGuide(
                id: definition.id,
                slug: definition.slug,
                title: definition.title,
                description: definition.description,
                tcg: definition.tcg,
                category: definition.category,
                coverImageUrl: definition.coverImageUrl,
                curatorName: definition.curatorName,
                tags: definition.tags,
                version: definition.version,
                featured: definition.featured,
                rule: definition.rule,
                cardCountHint: definition.cardCountHint,
                followed: existing != nil,
                wishlistId: existing?.id
            )
        }
    }

    private static func followLocalGuide(
        slug: String,
        wishlistName: String?
    ) throws -> FollowCollectionGuideResponse {
        guard let guide = localGuides().first(where: { $0.slug == slug }) else {
            throw APIError.serverError(status: 404, message: "Collection guide not found")
        }
        if let wishlistId = guide.wishlistId {
            return FollowCollectionGuideResponse(guide: guide, wishlistId: wishlistId, created: false)
        }
        let wishlist = LocalStore.shared.createWishlist(
            name: wishlistName?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? guide.title,
            description: "Following the “\(guide.title)” collection guide.",
            colorHex: "B86F47",
            matchAnyPrinting: false
        )
        if guide.rule.type == .manual {
            _ = try LocalStore.shared.addCardsToWishlist(
                wishlistId: wishlist.id,
                cards: localConnectedArtItems().map(\.card)
            )
        } else if let ruleType = WishlistRule.RuleType(rawValue: guide.rule.type.rawValue) {
            _ = try LocalStore.shared.addWishlistRule(
                wishlistId: wishlist.id,
                type: ruleType,
                tcg: guide.tcg,
                query: guide.rule.query,
                setCode: guide.rule.setCode,
                setName: guide.rule.setName,
                includeAllPrintings: guide.rule.includeAllPrintings,
                autoSync: true
            )
        }
        guard let followedGuide = localGuides().first(where: { $0.slug == slug }) else {
            throw APIError.serverError(status: 500, message: "Collection guide follow was not created")
        }
        return FollowCollectionGuideResponse(
            guide: followedGuide,
            wishlistId: wishlist.id,
            created: true
        )
    }

    func getCollectionGuideItems(
        config: ServerConfiguration,
        token: String,
        slug: String
    ) async throws -> [CollectionGuideItem] {
        if config.isOnDevice {
            return slug == "pokemon-crown-zenith-connected-art" ? Self.localConnectedArtItems() : []
        }
        let encodedSlug = slug.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? slug
        let (data, response) = try await makeRequest(
            config: config,
            path: "guides/\(encodedSlug)/items",
            token: token
        )
        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        guard let items = try? JSONDecoder().decode([CollectionGuideItem].self, from: data) else {
            throw APIError.decodingError
        }
        return items
    }

    func searchCollectionGuideCards(
        config: ServerConfiguration,
        token: String,
        query: String = "",
        game: TCGGame = .all,
        category: CollectionGuideCategory? = nil,
        ownership: String = "all",
        guideSlug: String? = nil,
        limit: Int = 1000
    ) async throws -> GuideCardSearchResponse {
        if config.isOnDevice {
            return try await searchLocalGuideCards(
                config: config,
                token: token,
                query: query,
                game: game,
                category: category,
                ownership: ownership,
                guideSlug: guideSlug,
                limit: limit
            )
        }
        var queryItems = [
            URLQueryItem(name: "query", value: query),
            URLQueryItem(name: "ownership", value: ownership),
            URLQueryItem(name: "limit", value: String(limit))
        ]
        if game != .all { queryItems.append(URLQueryItem(name: "tcg", value: game.rawValue)) }
        if let category { queryItems.append(URLQueryItem(name: "category", value: category.rawValue)) }
        if let guideSlug { queryItems.append(URLQueryItem(name: "guide", value: guideSlug)) }
        let (data, response) = try await makeRequest(
            config: config,
            path: "guides/cards",
            queryItems: queryItems,
            token: token
        )
        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        guard let result = try? JSONDecoder.tcgCardDecoder.decode(GuideCardSearchResponse.self, from: data) else {
            throw APIError.decodingError
        }
        return result
    }

    private func searchLocalGuideCards(
        config: ServerConfiguration,
        token: String,
        query: String,
        game: TCGGame,
        category: CollectionGuideCategory?,
        ownership: String,
        guideSlug: String?,
        limit: Int
    ) async throws -> GuideCardSearchResponse {
        let guides = Self.localGuides().filter { guide in
            (game == .all || guide.tcg == game.rawValue)
                && (category == nil || guide.category == category)
                && (guideSlug == nil || guide.slug == guideSlug)
        }
        let ownedQuantities = LocalStore.shared.getCollections().reduce(into: [String: Int]()) { result, collection in
            for card in collection.cards {
                result["\(card.tcg):\(card.externalId ?? card.cardId)", default: 0] += card.quantity
            }
        }
        var merged: [String: GuideCardSearchResult] = [:]
        for guide in guides {
            let cards: [(Card, CollectionGuideItem?)]
            switch guide.rule.type {
            case .manual:
                cards = Self.localConnectedArtItems().map { ($0.card, $0) }
            case .artist:
                cards = try await searchCardsByArtist(
                    config: config,
                    token: token,
                    artist: guide.rule.query ?? "",
                    game: TCGGame(rawValue: guide.tcg) ?? .pokemon
                ).map { ($0, nil) }
            case .name:
                cards = try await searchAllCards(
                    config: config,
                    token: token,
                    query: guide.rule.query ?? "",
                    game: TCGGame(rawValue: guide.tcg) ?? .all,
                    includeAllPrintings: guide.rule.includeAllPrintings,
                    limit: limit
                ).map { ($0, nil) }
            case .set:
                cards = try await getSetCards(
                    config: config,
                    token: token,
                    tcg: guide.tcg,
                    setCode: guide.rule.setCode ?? ""
                ).map { ($0, nil) }
            }
            for (position, pair) in cards.enumerated() {
                let (card, item) = pair
                let membership = GuideCardMembership(
                    guideId: guide.id,
                    slug: guide.slug,
                    title: guide.title,
                    category: guide.category,
                    tags: guide.tags,
                    groupKey: item?.groupKey,
                    groupLabel: item?.groupLabel,
                    groupOrder: item?.groupOrder,
                    position: item?.position ?? position
                )
                let haystack = ([card.name, card.setName, card.artist, guide.title, item?.groupLabel]
                    + guide.tags.map(Optional.some))
                    .compactMap { $0 }
                    .joined(separator: " ")
                if !query.isEmpty && !haystack.localizedCaseInsensitiveContains(query) { continue }
                let key = "\(card.tcg):\(card.id)"
                let quantity = ownedQuantities[key] ?? 0
                if ownership == "owned" && quantity == 0 { continue }
                if ownership == "missing" && quantity > 0 { continue }
                if var existing = merged[key] {
                    existing = GuideCardSearchResult(
                        card: existing.card,
                        owned: existing.owned,
                        ownedQuantity: existing.ownedQuantity,
                        matchedGuides: existing.matchedGuides + [membership]
                    )
                    merged[key] = existing
                } else {
                    merged[key] = GuideCardSearchResult(
                        card: card,
                        owned: quantity > 0,
                        ownedQuantity: quantity,
                        matchedGuides: [membership]
                    )
                }
            }
        }
        let results = Array(merged.values).sorted {
            ($0.matchedGuides.first?.title ?? "") < ($1.matchedGuides.first?.title ?? "")
        }
        return GuideCardSearchResponse(
            results: Array(results.prefix(limit)),
            total: results.count,
            failedGuideSlugs: []
        )
    }

    private static func localConnectedArtItems() -> [CollectionGuideItem] {
        let cards = [
            ("GG26", "Riolu"), ("GG27", "Swablu"), ("GG28", "Duskull"),
            ("GG29", "Bidoof"), ("GG30", "Pikachu"), ("GG31", "Turtwig"),
            ("GG32", "Paras"), ("GG33", "Poochyena"), ("GG34", "Mareep")
        ]
        return cards.enumerated().map { position, value in
            let (collectorNumber, name) = value
            return CollectionGuideItem(
                id: "local-connected-\(collectorNumber)",
                guideId: "local-guide-pokemon-crown-zenith-connected-art",
                tcg: "pokemon",
                externalId: "swsh12.5gg-\(collectorNumber)",
                name: name,
                setCode: "swsh12.5gg",
                setName: "Crown Zenith Galarian Gallery",
                collectorNumber: collectorNumber,
                rarity: "Rare",
                artist: "Kouki Saitou",
                variant: nil,
                imageUrl: "https://images.pokemontcg.io/swsh12pt5gg/\(collectorNumber)_hires.png",
                imageUrlSmall: "https://images.pokemontcg.io/swsh12pt5gg/\(collectorNumber).png",
                groupKey: "crown-zenith-nine-card-scene",
                groupLabel: "Crown Zenith nine-card scene",
                groupOrder: 0,
                position: position,
                note: nil,
                provenanceUrl: "https://bulbapedia.bulbagarden.net/wiki/Bidoof_(Crown_Zenith_111)"
            )
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
