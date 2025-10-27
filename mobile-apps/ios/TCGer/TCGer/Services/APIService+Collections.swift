import Foundation

extension APIService {
    func getCollections(
        config: ServerConfiguration,
        token: String,
        useCache: Bool = false
    ) async throws -> [Collection] {
        if useCache || !NetworkMonitor.shared.isConnected {
            if let cached: [Collection] = try? CacheManager.shared.load(
                [Collection].self,
                forKey: CacheManager.CacheKey.collections
            ) {
                return cached
            }

            if !NetworkMonitor.shared.isConnected {
                throw APIError.networkError(
                    NSError(
                        domain: "TCGer",
                        code: -1,
                        userInfo: [
                            NSLocalizedDescriptionKey: "No internet connection and no cached data available"
                        ]
                    )
                )
            }
        }

        do {
            let (data, response) = try await makeRequest(
                config: config,
                path: "collections",
                token: token
            )

            guard response.statusCode == 200 else {
                if response.statusCode == 401 {
                    throw APIError.unauthorized
                }
                throw APIError.serverError(status: response.statusCode)
            }

            let decoder = JSONDecoder()
            guard let collections = try? decoder.decode([StableCollection].self, from: data).map({ $0.asModel() }) else {
                throw APIError.decodingError
            }

            try? CacheManager.shared.save(collections, forKey: CacheManager.CacheKey.collections)
            CacheManager.shared.updateLastSyncDate()

            return collections
        } catch {
            if let cached: [Collection] = try? CacheManager.shared.load(
                [Collection].self,
                forKey: CacheManager.CacheKey.collections
            ) {
                return cached
            }
            throw error
        }
    }

    func getCollection(
        config: ServerConfiguration,
        token: String,
        id: String
    ) async throws -> Collection {
        let (data, response) = try await makeRequest(
            config: config,
            path: "collections/\(id)",
            token: token
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }

        let decoder = JSONDecoder()
        guard let collection = try? decoder.decode(StableCollection.self, from: data).asModel() else {
            throw APIError.decodingError
        }

        return collection
    }

    struct CreateCollectionRequest: Encodable {
        let name: String
        let description: String?
        let colorHex: String?
    }

    func createCollection(
        config: ServerConfiguration,
        token: String,
        name: String,
        description: String?,
        colorHex: String? = nil
    ) async throws -> Collection {
        let body = CreateCollectionRequest(name: name, description: description, colorHex: colorHex)
        let (data, response) = try await makeRequest(
            config: config,
            path: "collections",
            method: "POST",
            token: token,
            body: body
        )

        guard response.statusCode == 201 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }

        guard let collection = try? JSONDecoder().decode(Collection.self, from: data) else {
            throw APIError.decodingError
        }

        return collection
    }

    struct UpdateCollectionRequest: Encodable {
        let name: String?
        let description: String?
        let colorHex: String?
    }

    func updateCollection(
        config: ServerConfiguration,
        token: String,
        id: String,
        name: String? = nil,
        description: String? = nil,
        colorHex: String? = nil
    ) async throws -> Collection {
        let body = UpdateCollectionRequest(name: name, description: description, colorHex: colorHex)
        let (data, response) = try await makeRequest(
            config: config,
            path: "collections/\(id)",
            method: "PATCH",
            token: token,
            body: body
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }

        guard let collection = try? JSONDecoder().decode(Collection.self, from: data) else {
            throw APIError.decodingError
        }

        return collection
    }

    func deleteCollection(
        config: ServerConfiguration,
        token: String,
        id: String
    ) async throws {
        let (_, response) = try await makeRequest(
            config: config,
            path: "collections/\(id)",
            method: "DELETE",
            token: token
        )

        guard response.statusCode == 204 || response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }
    }

    struct AddCardToBinderRequest: Encodable {
        let cardId: String
        let quantity: Int
        let condition: String?
        let language: String?
        let notes: String?
        let price: Double?
        let acquisitionPrice: Double?
        let cardData: CardData?

        struct CardData: Encodable {
            let name: String
            let tcg: String
            let externalId: String
            let setCode: String?
            let setName: String?
            let rarity: String?
            let imageUrl: String?
            let imageUrlSmall: String?
        }
    }

    struct CardOverride: Encodable {
        let cardId: String
        let cardData: CardData?

        struct CardData: Encodable {
            let name: String
            let tcg: String
            let externalId: String
            let setCode: String?
            let setName: String?
            let rarity: String?
            let imageUrl: String?
            let imageUrlSmall: String?
        }
    }

    struct UpdateCollectionCardRequest: Encodable {
        let quantity: Int?
        let condition: String?
        let language: String?
        let notes: String?
        let cardOverride: CardOverride?
        let targetBinderId: String?
    }

    func addCardToBinder(
        config: ServerConfiguration,
        token: String,
        binderId: String,
        cardId: String,
        quantity: Int = 1,
        condition: String? = nil,
        language: String? = nil,
        notes: String? = nil,
        price: Double? = nil,
        acquisitionPrice: Double? = nil,
        card: Card? = nil
    ) async throws {
        let cardData: AddCardToBinderRequest.CardData?
        if let card {
            cardData = AddCardToBinderRequest.CardData(
                name: card.name,
                tcg: card.tcg,
                externalId: card.id,
                setCode: card.setCode,
                setName: card.setName,
                rarity: card.rarity,
                imageUrl: card.imageUrl,
                imageUrlSmall: card.imageUrlSmall
            )
        } else {
            cardData = nil
        }

        let body = AddCardToBinderRequest(
            cardId: cardId,
            quantity: quantity,
            condition: condition,
            language: language,
            notes: notes,
            price: price,
            acquisitionPrice: acquisitionPrice,
            cardData: cardData
        )

        let path = binderId == "__library__" ? "collections/cards" : "collections/\(binderId)/cards"

        let (_, response) = try await makeRequest(
            config: config,
            path: path,
            method: "POST",
            token: token,
            body: body
        )

        guard response.statusCode == 201 || response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }
    }

    func updateCardInBinder(
        config: ServerConfiguration,
        token: String,
        binderId: String,
        collectionCardId: String,
        quantity: Int? = nil,
        condition: String? = nil,
        language: String? = nil,
        notes: String? = nil,
        newPrint: Card? = nil,
        targetBinderId: String? = nil
    ) async throws -> CollectionCard {
        let cardOverride: CardOverride?
        if let print = newPrint {
            cardOverride = CardOverride(
                cardId: print.id,
                cardData: CardOverride.CardData(
                    name: print.name,
                    tcg: print.tcg,
                    externalId: print.id,
                    setCode: print.setCode,
                    setName: print.setName,
                    rarity: print.rarity,
                    imageUrl: print.imageUrl,
                    imageUrlSmall: print.imageUrlSmall
                )
            )
        } else {
            cardOverride = nil
        }


#if DEBUG
        print("UpdateCardInBinder -> binderId:\(binderId) cardId:\(collectionCardId) quantity:\(String(describing: quantity)) condition:\(condition ?? "nil") language:\(language ?? "nil") notes:\(notes ?? "nil") targetBinder:\(targetBinderId ?? "nil")")
#endif
        let body = UpdateCollectionCardRequest(
            quantity: quantity,
            condition: condition,
            language: language,
            notes: notes,
            cardOverride: cardOverride,
            targetBinderId: targetBinderId
        )

        guard let url = config.endpoint(path: "collections/\(binderId)/cards/\(collectionCardId)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")

        request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let encoder = JSONEncoder()
        request.httpBody = try encoder.encode(body)

        let (data, response) = try await execute(request)

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }

        guard let card = try? JSONDecoder().decode(CollectionCard.self, from: data) else {
            throw APIError.decodingError
        }

        return card
    }

    func deleteCardFromBinder(
        config: ServerConfiguration,
        token: String,
        binderId: String,
        collectionCardId: String
    ) async throws {
        let (_, response) = try await makeRequest(
            config: config,
            path: "collections/\(binderId)/cards/\(collectionCardId)",
            method: "DELETE",
            token: token
        )

        guard response.statusCode == 204 || response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }
    }
}
