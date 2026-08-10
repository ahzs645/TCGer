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
        )]
        let wishlists = LocalStore.shared.getWishlists()
        return definitions.map { definition in
            let existing = wishlists.first { wishlist in
                wishlist.expansionRules.contains { rule in
                    rule.type == definition.rule.type
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
        _ = try LocalStore.shared.addWishlistRule(
            wishlistId: wishlist.id,
            type: guide.rule.type,
            tcg: guide.tcg,
            query: guide.rule.query,
            setCode: guide.rule.setCode,
            setName: guide.rule.setName,
            includeAllPrintings: guide.rule.includeAllPrintings,
            autoSync: true
        )
        guard let followedGuide = localGuides().first(where: { $0.slug == slug }) else {
            throw APIError.serverError(status: 500, message: "Collection guide follow was not created")
        }
        return FollowCollectionGuideResponse(
            guide: followedGuide,
            wishlistId: wishlist.id,
            created: true
        )
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
