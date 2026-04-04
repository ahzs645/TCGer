import Foundation

extension APIService {

    // MARK: - Request Payloads

    private struct CreateWishlistRequest: Encodable {
        let name: String
        let description: String?
        let colorHex: String?
    }

    private struct UpdateWishlistRequest: Encodable {
        let name: String?
        let description: String?
        let colorHex: String?
    }

    private struct AddWishlistCardRequest: Encodable {
        let externalId: String
        let tcg: String
        let name: String
        let setCode: String?
        let setName: String?
        let rarity: String?
        let imageUrl: String?
        let imageUrlSmall: String?
        let collectorNumber: String?
        let notes: String?
    }

    private struct BatchAddWishlistCardsRequest: Encodable {
        let cards: [AddWishlistCardRequest]
    }

    // MARK: - Wishlists

    func getWishlists(
        config: ServerConfiguration,
        token: String
    ) async throws -> [Wishlist] {
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
        colorHex: String? = nil
    ) async throws -> Wishlist {
        let body = CreateWishlistRequest(name: name, description: description, colorHex: colorHex)
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
        colorHex: String? = nil
    ) async throws -> Wishlist {
        let body = UpdateWishlistRequest(name: name, description: description, colorHex: colorHex)
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
        let body = AddWishlistCardRequest(
            externalId: card.id,
            tcg: card.tcg,
            name: card.name,
            setCode: card.setCode,
            setName: card.setName,
            rarity: card.rarity,
            imageUrl: card.imageUrl,
            imageUrlSmall: card.imageUrlSmall,
            collectorNumber: card.collectorNumber,
            notes: nil
        )
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

    func removeCardFromWishlist(
        config: ServerConfiguration,
        token: String,
        wishlistId: String,
        cardId: String
    ) async throws {
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
