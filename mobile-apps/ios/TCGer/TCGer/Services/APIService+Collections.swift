import Foundation

extension APIService {
    struct TagPayload: Codable, Hashable, Sendable {
        let label: String
        let colorHex: String?
    }

    struct CollectionImportOptions: Codable, Sendable {
        let defaultBinderId: String?
        let createMissingBinders: Bool
    }

    struct CollectionImportRequest: Encodable {
        let csv: String
        let options: CollectionImportOptions
    }

    struct CollectionImportIssue: Codable, Hashable, Sendable, Identifiable {
        let row: Int
        let field: String?
        let message: String

        var id: String { "\(row)-\(field ?? "")-\(message)" }
    }

    struct CollectionImportRow: Codable, Hashable, Sendable, Identifiable {
        let row: Int
        let tcg: String
        let externalId: String
        let cardName: String
        let setCode: String?
        let setName: String?
        let rarity: String?
        let binderName: String?
        let quantity: Int
        let condition: String?
        let language: String?
        let notes: String?
        let price: Double?
        let acquisitionPrice: Double?
        let serialNumber: String?
        let acquiredAt: String?
        let isFoil: Bool
        let isSigned: Bool
        let isAltered: Bool
        let tags: [String]

        var id: String { "\(row)-\(tcg)-\(externalId)-\(binderName ?? "")" }
    }

    struct CollectionImportPreview: Codable, Sendable {
        let valid: Bool
        let rows: [CollectionImportRow]
        let issues: [CollectionImportIssue]
        let sourceRows: Int
        let totalCopies: Int
    }

    struct CollectionImportResult: Codable, Sendable {
        let valid: Bool
        let rows: [CollectionImportRow]
        let issues: [CollectionImportIssue]
        let sourceRows: Int
        let totalCopies: Int
        let importedRows: Int
        let importedCopies: Int
        let createdBinders: [String]
    }

    func previewCollectionImport(
        config: ServerConfiguration,
        token: String,
        csv: String,
        options: CollectionImportOptions
    ) async throws -> CollectionImportPreview {
        let (data, response) = try await makeRequest(
            config: config,
            path: "collections/import/preview",
            method: "POST",
            token: token,
            body: CollectionImportRequest(csv: csv, options: options)
        )
        guard response.statusCode == 200 || response.statusCode == 422 else {
            throw APIError.serverError(
                status: response.statusCode,
                message: parseServerMessage(from: data)
            )
        }
        guard let preview = try? JSONDecoder().decode(CollectionImportPreview.self, from: data) else {
            throw APIError.decodingError
        }
        return preview
    }

    func commitCollectionImport(
        config: ServerConfiguration,
        token: String,
        csv: String,
        options: CollectionImportOptions
    ) async throws -> CollectionImportResult {
        let (data, response) = try await makeRequest(
            config: config,
            path: "collections/import/commit",
            method: "POST",
            token: token,
            body: CollectionImportRequest(csv: csv, options: options)
        )
        guard response.statusCode == 201 || response.statusCode == 422 else {
            throw APIError.serverError(
                status: response.statusCode,
                message: parseServerMessage(from: data)
            )
        }
        guard let result = try? JSONDecoder().decode(CollectionImportResult.self, from: data) else {
            throw APIError.decodingError
        }
        return result
    }

    func getCollections(
        config: ServerConfiguration,
        token: String? = nil,
        useCache: Bool = false
    ) async throws -> [Collection] {
        if config.isDemoMode {
            return DemoStore.shared.getCollections()
        }

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

            var imageURLs: [String] = []
            for collection in collections {
                for card in collection.cards {
                    if let small = card.imageUrlSmall {
                        imageURLs.append(small)
                    }
                    if let large = card.imageUrl, large != card.imageUrlSmall {
                        imageURLs.append(large)
                    }
                }
            }
            ImageCache.shared.prefetch(urlStrings: imageURLs)

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
        token: String? = nil,
        id: String
    ) async throws -> Collection {
        if config.isDemoMode {
            return try DemoStore.shared.getCollection(id: id)
        }

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
        if config.isDemoMode {
            return DemoStore.shared.createCollection(
                name: name,
                description: description,
                colorHex: colorHex
            )
        }

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
        if config.isDemoMode {
            return try DemoStore.shared.updateCollection(
                id: id,
                name: name,
                description: description,
                colorHex: colorHex
            )
        }

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
        if config.isDemoMode {
            try DemoStore.shared.deleteCollection(id: id)
            return
        }

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

    func getTags(
        config: ServerConfiguration,
        token: String
    ) async throws -> [CollectionCardTag] {
        if config.isDemoMode {
            return DemoStore.shared.getTags()
        }

        let (data, response) = try await makeRequest(
            config: config,
            path: "collections/tags",
            token: token
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }

        guard let tags = try? JSONDecoder().decode([CollectionCardTag].self, from: data) else {
            throw APIError.decodingError
        }

        return tags
    }

    func createTag(
        config: ServerConfiguration,
        token: String,
        label: String,
        colorHex: String? = nil
    ) async throws -> CollectionCardTag {
        if config.isDemoMode {
            return DemoStore.shared.createTag(label: label, colorHex: colorHex)
        }

        let payload = TagPayload(label: label, colorHex: colorHex)
        let (data, response) = try await makeRequest(
            config: config,
            path: "collections/tags",
            method: "POST",
            token: token,
            body: payload
        )

        guard response.statusCode == 201 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            let serverMessage = parseServerMessage(from: data)
            throw APIError.serverError(status: response.statusCode, message: serverMessage)
        }

        guard let tag = try? JSONDecoder().decode(CollectionCardTag.self, from: data) else {
            throw APIError.decodingError
        }

        return tag
    }

    struct AddCardToBinderRequest: Encodable {
        let cardId: String
        let quantity: Int
        let condition: String?
        let language: String?
        let notes: String?
        let price: Double?
        let acquisitionPrice: Double?
        let isFoil: Bool?
        let finishCode: String?
        let finishLabel: String?
        let edition: String?
        let stamp: String?
        let isSealedPromo: Bool?
        let isOversized: Bool?
        let isPeelOff: Bool?
        let isSigned: Bool?
        let isAltered: Bool?
        let tags: [String]?
        let newTags: [TagPayload]?
        let cardData: CardData?

        struct CardData: Encodable {
            let name: String
            let tcg: String
            let externalId: String
            let baseExternalId: String?
            let printingKey: String?
            let artworkId: String?
            let setCode: String?
            let setName: String?
            let rarity: String?
            let imageUrl: String?
            let imageUrlSmall: String?
            let collectorNumber: String?
            let releasedAt: String?
            let setSymbolUrl: String?
            let setLogoUrl: String?
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
        }
    }

    struct CardOverride: Encodable {
        let cardId: String
        let cardData: CardData?

        struct CardData: Encodable {
            let name: String
            let tcg: String
            let externalId: String
            let baseExternalId: String?
            let printingKey: String?
            let artworkId: String?
            let setCode: String?
            let setName: String?
            let rarity: String?
            let imageUrl: String?
            let imageUrlSmall: String?
            let collectorNumber: String?
            let releasedAt: String?
            let setSymbolUrl: String?
            let setLogoUrl: String?
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
        }
    }

    struct UpdateCollectionCardRequest: Encodable {
        let quantity: Int?
        let condition: String?
        let language: String?
        let notes: String?
        let isFoil: Bool?
        let variant: CardCopyVariant?
        let isSigned: Bool?
        let isAltered: Bool?
        let gradingCompany: String?
        let gradingScore: String?
        let certNumber: String?
        let storageLocation: String?
        let includeOwnedCopyDetails: Bool
        let tags: [String]?
        let newTags: [TagPayload]?
        let cardOverride: CardOverride?
        let targetBinderId: String?

        enum CodingKeys: String, CodingKey {
            case quantity, condition, language, notes, isFoil
            case finishCode, finishLabel, edition, stamp
            case isSealedPromo, isOversized, isPeelOff
            case isSigned, isAltered, gradingCompany, gradingScore, certNumber, storageLocation
            case tags, newTags, cardOverride, targetBinderId
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encodeIfPresent(quantity, forKey: .quantity)
            try container.encodeIfPresent(condition, forKey: .condition)
            try container.encodeIfPresent(language, forKey: .language)
            try container.encodeIfPresent(notes, forKey: .notes)
            try container.encodeIfPresent(isFoil, forKey: .isFoil)
            if let variant {
                if let value = variant.finishCode { try container.encode(value, forKey: .finishCode) }
                else { try container.encodeNil(forKey: .finishCode) }
                if let value = variant.finishLabel { try container.encode(value, forKey: .finishLabel) }
                else { try container.encodeNil(forKey: .finishLabel) }
                if let value = variant.edition { try container.encode(value, forKey: .edition) }
                else { try container.encodeNil(forKey: .edition) }
                if let value = variant.stamp { try container.encode(value, forKey: .stamp) }
                else { try container.encodeNil(forKey: .stamp) }
                try container.encode(variant.isSealedPromo, forKey: .isSealedPromo)
                try container.encode(variant.isOversized, forKey: .isOversized)
                try container.encode(variant.isPeelOff, forKey: .isPeelOff)
            }
            try container.encodeIfPresent(isSigned, forKey: .isSigned)
            try container.encodeIfPresent(isAltered, forKey: .isAltered)
            if includeOwnedCopyDetails {
                if let gradingCompany { try container.encode(gradingCompany, forKey: .gradingCompany) }
                else { try container.encodeNil(forKey: .gradingCompany) }
                if let gradingScore { try container.encode(gradingScore, forKey: .gradingScore) }
                else { try container.encodeNil(forKey: .gradingScore) }
                if let certNumber { try container.encode(certNumber, forKey: .certNumber) }
                else { try container.encodeNil(forKey: .certNumber) }
                if let storageLocation { try container.encode(storageLocation, forKey: .storageLocation) }
                else { try container.encodeNil(forKey: .storageLocation) }
            }
            try container.encodeIfPresent(tags, forKey: .tags)
            try container.encodeIfPresent(newTags, forKey: .newTags)
            try container.encodeIfPresent(cardOverride, forKey: .cardOverride)
            try container.encodeIfPresent(targetBinderId, forKey: .targetBinderId)
        }
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
        isFoil: Bool? = nil,
        variant: CardCopyVariant = .empty,
        isSigned: Bool? = nil,
        isAltered: Bool? = nil,
        tags: [String]? = nil,
        newTags: [TagPayload]? = nil,
        card: Card? = nil
    ) async throws {
        if config.isDemoMode {
            try DemoStore.shared.addCardToBinder(
                binderId: binderId,
                cardId: cardId,
                quantity: quantity,
                condition: condition,
                language: language,
                notes: notes,
                price: price,
                acquisitionPrice: acquisitionPrice,
                variant: variant,
                isSigned: isSigned,
                isAltered: isAltered,
                tagIds: tags,
                newTags: newTags,
                card: card
            )
            return
        }

        let cardData: AddCardToBinderRequest.CardData?
        if let card {
            cardData = AddCardToBinderRequest.CardData(
                name: card.name,
                tcg: card.tcg,
                externalId: card.id,
                baseExternalId: card.baseExternalId,
                printingKey: card.printingKey,
                artworkId: card.artworkId,
                setCode: card.setCode,
                setName: card.setName,
                rarity: card.rarity,
                imageUrl: card.imageUrl,
                imageUrlSmall: card.imageUrlSmall,
                collectorNumber: card.collectorNumber,
                releasedAt: card.releasedAt.map { ISO8601DateFormatter().string(from: $0) },
                setSymbolUrl: card.setSymbolUrl,
                setLogoUrl: card.setLogoUrl,
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
                functionalIdentity: card.functionalIdentity
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
            isFoil: isFoil ?? variant.isFoil,
            finishCode: variant.finishCode,
            finishLabel: variant.finishLabel,
            edition: variant.edition,
            stamp: variant.stamp,
            isSealedPromo: variant.isSealedPromo,
            isOversized: variant.isOversized,
            isPeelOff: variant.isPeelOff,
            isSigned: isSigned,
            isAltered: isAltered,
            tags: tags,
            newTags: newTags,
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
        isFoil: Bool? = nil,
        variant: CardCopyVariant? = nil,
        isSigned: Bool? = nil,
        isAltered: Bool? = nil,
        gradingCompany: String? = nil,
        gradingScore: String? = nil,
        certNumber: String? = nil,
        storageLocation: String? = nil,
        includeOwnedCopyDetails: Bool = false,
        tags: [String]? = nil,
        newTags: [TagPayload]? = nil,
        newPrint: Card? = nil,
        targetBinderId: String? = nil
    ) async throws -> CollectionCard {
        if config.isDemoMode {
            return try DemoStore.shared.updateCardInBinder(
                binderId: binderId,
                collectionCardOrCopyId: collectionCardId,
                quantity: quantity,
                condition: condition,
                language: language,
                notes: notes,
                variant: variant,
                isSigned: isSigned,
                isAltered: isAltered,
                gradingCompany: gradingCompany,
                gradingScore: gradingScore,
                certNumber: certNumber,
                storageLocation: storageLocation,
                includeOwnedCopyDetails: includeOwnedCopyDetails,
                tagIds: tags,
                newTags: newTags,
                newPrint: newPrint,
                targetBinderId: targetBinderId
            )
        }

        let cardOverride: CardOverride?
        if let print = newPrint {
            cardOverride = CardOverride(
                cardId: print.id,
                cardData: CardOverride.CardData(
                    name: print.name,
                    tcg: print.tcg,
                    externalId: print.id,
                    baseExternalId: print.baseExternalId,
                    printingKey: print.printingKey,
                    artworkId: print.artworkId,
                    setCode: print.setCode,
                    setName: print.setName,
                    rarity: print.rarity,
                    imageUrl: print.imageUrl,
                    imageUrlSmall: print.imageUrlSmall,
                    collectorNumber: print.collectorNumber,
                    releasedAt: print.releasedAt.map { ISO8601DateFormatter().string(from: $0) },
                    setSymbolUrl: print.setSymbolUrl,
                    setLogoUrl: print.setLogoUrl,
                    regulationMark: print.regulationMark,
                    language: print.language,
                    supertype: print.supertype,
                    formatLegality: print.formatLegality,
                    dexEntries: print.dexEntries,
                    region: print.region,
                    pokemonPrint: print.pokemonPrint,
                    attributes: print.attributes,
                    provenance: print.provenance,
                    legalityPeriods: print.legalityPeriods,
                    evolution: print.evolution,
                    functionalIdentity: print.functionalIdentity
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
            isFoil: isFoil ?? variant?.isFoil,
            variant: variant,
            isSigned: isSigned,
            isAltered: isAltered,
            gradingCompany: gradingCompany,
            gradingScore: gradingScore,
            certNumber: certNumber,
            storageLocation: storageLocation,
            includeOwnedCopyDetails: includeOwnedCopyDetails,
            tags: tags,
            newTags: newTags,
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

        if response.statusCode == 401 {
            throw APIError.unauthorized
        }

        guard response.statusCode == 200 else {
            let serverMessage = parseServerMessage(from: data)
#if DEBUG
            if let serverMessage {
                print("updateCardInBinder failed with status \(response.statusCode): \(serverMessage)")
            }
#endif
            throw APIError.serverError(status: response.statusCode, message: serverMessage)
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
        if config.isDemoMode {
            try DemoStore.shared.deleteCardFromBinder(
                binderId: binderId,
                collectionCardOrCopyId: collectionCardId
            )
            return
        }

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

    // MARK: - Export

    func exportCollection(
        config: ServerConfiguration,
        token: String,
        format: String = "json"
    ) async throws -> Data {
        if config.isDemoMode {
            return DemoStore.shared.exportCollections(format: format)
        }

        let (data, response) = try await makeRequest(
            config: config,
            path: "collections/export?format=\(format)",
            token: token
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }

        return data
    }

    // MARK: - Image Upload

    func uploadImage(
        config: ServerConfiguration,
        token: String,
        binderId: String,
        collectionId: String,
        imageData: Data,
        filename: String = "photo.jpg"
    ) async throws -> [String] {
        if config.isDemoMode {
            // Local mode has no image store; report no remote images rather than
            // failing the whole add/edit flow.
            return []
        }

        guard let url = config.endpoint(path: "collections/\(binderId)/cards/\(collectionId)/images") else {
            throw APIError.invalidURL
        }

        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.addValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"images\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let (data, response) = try await execute(request)

        guard response.statusCode == 201 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }

        struct ImageUploadResponse: Codable {
            let imageUrls: [String]
        }

        guard let result = try? JSONDecoder().decode(ImageUploadResponse.self, from: data) else {
            throw APIError.decodingError
        }

        return result.imageUrls
    }

    func deleteImage(
        config: ServerConfiguration,
        token: String,
        binderId: String,
        collectionId: String,
        imageIndex: Int
    ) async throws {
        if config.isDemoMode {
            return
        }

        let (_, response) = try await makeRequest(
            config: config,
            path: "collections/\(binderId)/cards/\(collectionId)/images/\(imageIndex)",
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
