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

    enum CollectionImportSourceFormat: String, Codable, CaseIterable, Sendable, Identifiable {
        case auto
        case csv
        case json
        case cardmarketText = "cardmarket-text"

        var id: String { rawValue }

        var label: String {
            switch self {
            case .auto: return "Auto-detect"
            case .csv: return "TCGer CSV"
            case .json: return "JSON"
            case .cardmarketText: return "Cardmarket Yu-Gi-Oh text"
            }
        }
    }

    struct CollectionImportResolution: Codable, Hashable, Sendable {
        let externalId: String
        let baseExternalId: String?
        let printingKey: String?
        let artworkId: String?
        let collectorNumber: String?
        let setCode: String?
        let setName: String?
        let rarity: String?
        let cardName: String?
    }

    struct CollectionImportRequest: Encodable {
        let content: String
        let format: CollectionImportSourceFormat
        let fileName: String?
        let resolutions: [String: CollectionImportResolution]
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
        var format: CollectionImportSourceFormat? = nil
        var failures: [CollectionImportFailure]? = nil
        var ambiguities: [CollectionImportAmbiguity]? = nil
    }

    struct CollectionImportFailure: Codable, Hashable, Sendable, Identifiable {
        let sourceRow: Int
        let code: String
        let message: String
        let original: String?
        let field: String?

        var id: String { "\(sourceRow)-\(code)-\(field ?? "")" }
    }

    struct CollectionImportAmbiguity: Codable, Hashable, Sendable, Identifiable {
        struct Query: Codable, Hashable, Sendable {
            let tcg: String
            let name: String
            let collectorNumber: String?
            let setCode: String?
            let rarity: String?
        }

        let sourceRow: Int
        let code: String
        let message: String
        let query: Query

        var id: Int { sourceRow }
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
        var format: CollectionImportSourceFormat? = nil
        var failures: [CollectionImportFailure]? = nil
        var ambiguities: [CollectionImportAmbiguity]? = nil
    }

    func previewCollectionImport(
        config: ServerConfiguration,
        token: String,
        content: String,
        format: CollectionImportSourceFormat,
        fileName: String?,
        resolutions: [String: CollectionImportResolution],
        options: CollectionImportOptions
    ) async throws -> CollectionImportPreview {
        if config.isOnDevice {
            guard format == .csv || (format == .auto && fileName?.lowercased().hasSuffix(".csv") != false) else {
                throw APIError.serverError(
                    status: 400,
                    message: "On-device imports currently support TCGer CSV only. Connect to a server for JSON and Cardmarket text."
                )
            }
            return LocalStore.shared.previewImport(csv: content, options: options)
        }

        let (data, response) = try await makeRequest(
            config: config,
            path: "collections/import/preview",
            method: "POST",
            token: token,
            body: CollectionImportRequest(
                content: content,
                format: format,
                fileName: fileName,
                resolutions: resolutions,
                options: options
            )
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
        content: String,
        format: CollectionImportSourceFormat,
        fileName: String?,
        resolutions: [String: CollectionImportResolution],
        options: CollectionImportOptions
    ) async throws -> CollectionImportResult {
        if config.isOnDevice {
            guard format == .csv || (format == .auto && fileName?.lowercased().hasSuffix(".csv") != false) else {
                throw APIError.serverError(
                    status: 400,
                    message: "On-device imports currently support TCGer CSV only. Connect to a server for JSON and Cardmarket text."
                )
            }
            let result = LocalStore.shared.commitImport(csv: content, options: options)
            try LocalStore.shared.requireLatestMutationPersisted()
            return result
        }

        let (data, response) = try await makeRequest(
            config: config,
            path: "collections/import/commit",
            method: "POST",
            token: token,
            body: CollectionImportRequest(
                content: content,
                format: format,
                fileName: fileName,
                resolutions: resolutions,
                options: options
            )
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

    func collectionImportTemplate(
        config: ServerConfiguration,
        token: String
    ) async throws -> Data {
        if config.isOnDevice {
            let header = "tcg,external_id,card_name,base_external_id,printing_key,artwork_id,collector_number,set_code,set_name,rarity,binder_name,quantity,condition,language,notes,price,acquisition_price,serial_number,acquired_at,is_foil,finish_code,finish_label,edition,stamp,is_sealed_promo,is_oversized,is_peel_off,is_signed,is_altered,tags\n"
            return Data(header.utf8)
        }
        let (data, response) = try await makeRequest(
            config: config,
            path: "collections/import/template",
            token: token
        )
        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        return data
    }

    struct CollectionMutationAuditEntry: Codable, Hashable, Sendable, Identifiable {
        let id: String
        let operationKind: String
        let actorId: String
        let affectedCopies: Int
        let binderId: String?
        let cardName: String?
        let summary: String
        let sourceAuditId: String?
        let canUndo: Bool
        let createdAt: String
    }

    private struct CollectionMutationHistoryResponse: Decodable {
        let entries: [CollectionMutationAuditEntry]
    }

    private struct UndoCollectionMutationRequest: Encodable {
        let idempotencyKey: String
    }

    func getCollectionMutationHistory(
        config: ServerConfiguration,
        token: String,
        limit: Int = 50
    ) async throws -> [CollectionMutationAuditEntry] {
        guard !config.isOnDevice else { return [] }
        let (data, response) = try await makeRequest(
            config: config,
            path: "collections/history",
            queryItems: [URLQueryItem(name: "limit", value: String(min(100, max(1, limit))))],
            token: token
        )
        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        guard let result = try? JSONDecoder().decode(CollectionMutationHistoryResponse.self, from: data) else {
            throw APIError.decodingError
        }
        return result.entries
    }

    func undoCollectionMutation(
        config: ServerConfiguration,
        token: String,
        auditId: String,
        idempotencyKey: String
    ) async throws -> CollectionMutationAuditEntry {
        guard !config.isOnDevice else {
            throw APIError.serverError(status: 400, message: "Collection history is available in server mode.")
        }
        let (data, response) = try await makeRequest(
            config: config,
            path: "collections/history/\(auditId)/undo",
            method: "POST",
            token: token,
            body: UndoCollectionMutationRequest(idempotencyKey: idempotencyKey)
        )
        guard response.statusCode == 201 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        struct Result: Decodable { let audit: CollectionMutationAuditEntry }
        guard let result = try? JSONDecoder().decode(Result.self, from: data) else {
            throw APIError.decodingError
        }
        return result.audit
    }

    func getCollections(
        config: ServerConfiguration,
        token: String? = nil,
        useCache: Bool = false
    ) async throws -> [Collection] {
        if config.isOnDevice {
            return LocalStore.shared.getCollections()
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
        } catch let error as APIError {
            if case .networkError(let underlyingError) = error,
               !Self.isCancellation(underlyingError),
               let cached: [Collection] = try? CacheManager.shared.load(
                    [Collection].self,
                    forKey: CacheManager.CacheKey.collections
               ) {
                return cached
            }
            throw error
        } catch {
            throw error
        }
    }

    private static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        return (error as? URLError)?.code == .cancelled
    }

    func getCollection(
        config: ServerConfiguration,
        token: String? = nil,
        id: String
    ) async throws -> Collection {
        if config.isOnDevice {
            return try LocalStore.shared.getCollection(id: id)
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

    private struct UpsertBinderPageRequest: Encodable {
        let pageNumber: Int
        let capturedAt: String
        let placements: [BinderPagePlacement]
    }

    func getBinderPages(
        config: ServerConfiguration,
        token: String?,
        binderId: String
    ) async throws -> [SavedBinderPage] {
        if config.isOnDevice {
            return LocalStore.shared.getBinderPages(binderId: binderId)
        }
        let (data, response) = try await makeRequest(
            config: config,
            path: "collections/\(binderId)/pages",
            token: token
        )
        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        guard let pages = try? JSONDecoder().decode([SavedBinderPage].self, from: data) else {
            throw APIError.decodingError
        }
        return pages
    }

    func upsertBinderPage(
        config: ServerConfiguration,
        token: String?,
        binderId: String,
        pageNumber: Int,
        capturedAt: Date,
        placements: [BinderPagePlacement]
    ) async throws -> SavedBinderPage {
        if config.isOnDevice {
            let page = LocalStore.shared.upsertBinderPage(
                binderId: binderId,
                pageNumber: pageNumber,
                capturedAt: capturedAt,
                placements: placements
            )
            try LocalStore.shared.requireLatestMutationPersisted()
            return page
        }
        let body = UpsertBinderPageRequest(
            pageNumber: pageNumber,
            capturedAt: ISO8601DateFormatter().string(from: capturedAt),
            placements: placements
        )
        let (data, response) = try await makeRequest(
            config: config,
            path: "collections/\(binderId)/pages/\(pageNumber)",
            method: "PUT",
            token: token,
            body: body
        )
        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        guard let page = try? JSONDecoder().decode(SavedBinderPage.self, from: data) else {
            throw APIError.decodingError
        }
        return page
    }

    func replaceBinderPageImage(
        config: ServerConfiguration,
        token: String?,
        binderId: String,
        pageNumber: Int,
        imageData: Data
    ) async throws -> SavedBinderPage {
        if config.isOnDevice {
            return try LocalStore.shared.replaceBinderPageImage(
                binderId: binderId,
                pageNumber: pageNumber,
                imageData: imageData
            )
        }
        guard let token else { throw APIError.unauthorized }
        guard let url = config.endpoint(path: "collections/\(binderId)/pages/\(pageNumber)/image") else {
            throw APIError.invalidURL
        }
        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.addValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"image\"; filename=\"binder-page-\(pageNumber).jpg\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body
        let (data, response) = try await execute(request)
        guard response.statusCode == 201 || response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        guard let page = try? JSONDecoder().decode(SavedBinderPage.self, from: data) else {
            throw APIError.decodingError
        }
        return page
    }

    func removeBinderPageImage(
        config: ServerConfiguration,
        token: String?,
        binderId: String,
        pageNumber: Int
    ) async throws {
        if config.isOnDevice {
            LocalStore.shared.removeBinderPageImage(binderId: binderId, pageNumber: pageNumber)
            try LocalStore.shared.requireLatestMutationPersisted()
            return
        }
        let (data, response) = try await makeRequest(
            config: config,
            path: "collections/\(binderId)/pages/\(pageNumber)/image",
            method: "DELETE",
            token: token
        )
        guard response.statusCode == 204 || response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
    }

    struct CreateCollectionRequest: Encodable {
        let name: String
        let description: String?
        let colorHex: String?
        let defaultCondition: String?
        let containerType: String?
        let imageUrl: String?
        let associatedTcg: String?
        let associatedSetCode: String?
        let associatedSetName: String?
    }

    func createCollection(
        config: ServerConfiguration,
        token: String,
        name: String,
        description: String?,
        colorHex: String? = nil,
        defaultCondition: String? = nil,
        containerType: String? = nil,
        imageUrl: String? = nil,
        associatedTcg: String? = nil,
        associatedSetCode: String? = nil,
        associatedSetName: String? = nil
    ) async throws -> Collection {
        if config.isOnDevice {
            let collection = LocalStore.shared.createCollection(
                name: name,
                description: description,
                colorHex: colorHex,
                defaultCondition: defaultCondition,
                containerType: containerType,
                imageUrl: imageUrl,
                associatedTcg: associatedTcg,
                associatedSetCode: associatedSetCode,
                associatedSetName: associatedSetName
            )
            try LocalStore.shared.requireLatestMutationPersisted()
            return collection
        }

        let body = CreateCollectionRequest(
            name: name,
            description: description,
            colorHex: colorHex,
            defaultCondition: defaultCondition,
            containerType: containerType,
            imageUrl: imageUrl,
            associatedTcg: associatedTcg,
            associatedSetCode: associatedSetCode,
            associatedSetName: associatedSetName
        )
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
        // Empty string clears the binder default; nil leaves it unchanged.
        let defaultCondition: String?
        let containerType: String?
        let imageUrl: String?
        let associatedTcg: String?
        let associatedSetCode: String?
        let associatedSetName: String?

        private enum CodingKeys: String, CodingKey {
            case name, description, colorHex, defaultCondition, containerType, imageUrl
            case associatedTcg, associatedSetCode, associatedSetName
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encodeIfPresent(name, forKey: .name)
            try container.encodeIfPresent(description, forKey: .description)
            try container.encodeIfPresent(colorHex, forKey: .colorHex)
            try container.encodeIfPresent(defaultCondition, forKey: .defaultCondition)
            // Binder presentation values are a complete editor snapshot. Encode
            // nil as JSON null so clearing a field reaches the nullable API.
            try container.encode(containerType, forKey: .containerType)
            try container.encode(imageUrl, forKey: .imageUrl)
            try container.encode(associatedTcg, forKey: .associatedTcg)
            try container.encode(associatedSetCode, forKey: .associatedSetCode)
            try container.encode(associatedSetName, forKey: .associatedSetName)
        }
    }

    func updateCollection(
        config: ServerConfiguration,
        token: String,
        id: String,
        name: String? = nil,
        description: String? = nil,
        colorHex: String? = nil,
        defaultCondition: String? = nil,
        containerType: String? = nil,
        imageUrl: String? = nil,
        associatedTcg: String? = nil,
        associatedSetCode: String? = nil,
        associatedSetName: String? = nil
    ) async throws -> Collection {
        if config.isOnDevice {
            return try LocalStore.shared.updateCollection(
                id: id,
                name: name,
                description: description,
                colorHex: colorHex,
                defaultCondition: defaultCondition,
                containerType: containerType,
                imageUrl: imageUrl,
                associatedTcg: associatedTcg,
                associatedSetCode: associatedSetCode,
                associatedSetName: associatedSetName
            )
        }

        let body = UpdateCollectionRequest(
            name: name,
            description: description,
            colorHex: colorHex,
            defaultCondition: defaultCondition,
            containerType: containerType,
            imageUrl: imageUrl,
            associatedTcg: associatedTcg,
            associatedSetCode: associatedSetCode,
            associatedSetName: associatedSetName
        )
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
        if config.isOnDevice {
            try LocalStore.shared.deleteCollection(id: id)
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
        if config.isOnDevice {
            return LocalStore.shared.getTags()
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
        if config.isOnDevice {
            let tag = LocalStore.shared.createTag(label: label, colorHex: colorHex)
            try LocalStore.shared.requireLatestMutationPersisted()
            return tag
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
            let printingKind: String?
            let sanctionedPlayLegal: Bool?
            let originalPrintingKey: String?
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
            let printingKind: String?
            let sanctionedPlayLegal: Bool?
            let originalPrintingKey: String?
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
        if config.isOnDevice {
            try LocalStore.shared.addCardToBinder(
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
            NotificationCenter.default.post(name: .collectionDidChange, object: nil)
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
                printingKind: card.printingKind,
                sanctionedPlayLegal: card.sanctionedPlayLegal,
                originalPrintingKey: card.originalPrintingKey,
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

        try? CacheManager.shared.remove(forKey: CacheManager.CacheKey.collections)
        NotificationCenter.default.post(name: .collectionDidChange, object: nil)
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
        if config.isOnDevice {
            return try LocalStore.shared.updateCardInBinder(
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
                    printingKind: print.printingKind,
                    sanctionedPlayLegal: print.sanctionedPlayLegal,
                    originalPrintingKey: print.originalPrintingKey,
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
        if config.isOnDevice {
            try LocalStore.shared.deleteCardFromBinder(
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
        if config.isOnDevice {
            return LocalStore.shared.exportCollections(format: format)
        }

        let (data, response) = try await makeRequest(
            config: config,
            path: "collections/export",
            queryItems: [URLQueryItem(name: "format", value: format)],
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
        if config.isOnDevice {
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
        if config.isOnDevice {
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

// MARK: - Add-to-binder convenience

/// Everything a screen collects about the copy being added to a binder.
/// Bundled so sheet callbacks and the service helper share one shape instead
/// of every view repeating the endpoint's full argument list.
nonisolated struct BinderCardAddDetails: Sendable {
    var quantity: Int = 1
    var condition: String? = nil
    var language: String? = nil
    var notes: String? = nil
    var isFoil: Bool = false
    var variant: CardCopyVariant = .empty
    var isSigned: Bool = false
    var isAltered: Bool = false
}

extension APIService {
    /// The one service-layer path for "add this card to a binder", used by
    /// search, set browsing, the scanner, and binder-scan review alike.
    func addCardToBinder(
        config: ServerConfiguration,
        token: String?,
        binderId: String,
        card: Card,
        details: BinderCardAddDetails = BinderCardAddDetails()
    ) async throws {
        guard let token else {
            throw APIError.unauthorized
        }

        try await addCardToBinder(
            config: config,
            token: token,
            binderId: binderId,
            cardId: card.id,
            quantity: details.quantity,
            condition: details.condition,
            language: details.language,
            notes: details.notes,
            price: card.price,
            acquisitionPrice: nil,
            isFoil: details.isFoil,
            variant: details.variant,
            isSigned: details.isSigned,
            isAltered: details.isAltered,
            card: card
        )
    }
}
