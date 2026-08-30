import Foundation

extension APIService {
    func getStorageContainers(config: ServerConfiguration, token: String) async throws -> [StorageContainer] {
        try await libraryOperationsResponse(
            config: config,
            path: "storage/containers",
            token: token,
            as: [StorageContainer].self
        )
    }

    func createStorageContainer(
        config: ServerConfiguration,
        token: String,
        request: CreateStorageContainerRequest
    ) async throws -> StorageContainer {
        try await libraryOperationsResponse(
            config: config,
            path: "storage/containers",
            method: "POST",
            token: token,
            body: request,
            as: StorageContainer.self
        )
    }

    func updateStorageContainer(
        config: ServerConfiguration,
        token: String,
        containerId: String,
        request: UpdateStorageContainerRequest
    ) async throws -> StorageContainer {
        try await libraryOperationsResponse(
            config: config,
            path: "storage/containers/\(containerId)",
            method: "PATCH",
            token: token,
            body: request,
            as: StorageContainer.self
        )
    }

    func createStorageCompartment(
        config: ServerConfiguration,
        token: String,
        containerId: String,
        request: CreateStorageCompartmentRequest
    ) async throws -> StorageCompartment {
        try await libraryOperationsResponse(
            config: config,
            path: "storage/compartments",
            method: "POST",
            token: token,
            body: request,
            as: StorageCompartment.self
        )
    }

    func updateStorageCompartment(
        config: ServerConfiguration,
        token: String,
        compartmentId: String,
        request: UpdateStorageCompartmentRequest
    ) async throws -> StorageCompartment {
        try await libraryOperationsResponse(
            config: config,
            path: "storage/compartments/\(compartmentId)",
            method: "PATCH",
            token: token,
            body: request,
            as: StorageCompartment.self
        )
    }

    func placeCollectionEntry(
        config: ServerConfiguration,
        token: String,
        request: PlaceCollectionEntryRequest
    ) async throws -> StoragePlacement {
        try await libraryOperationsResponse(
            config: config,
            path: "storage/placements",
            method: "POST",
            token: token,
            body: request,
            as: StoragePlacement.self
        )
    }

    func removeStoragePlacement(
        config: ServerConfiguration,
        token: String,
        placementId: String
    ) async throws {
        let (data, response) = try await makeRequest(
            config: config,
            path: "storage/placements/\(placementId)",
            method: "DELETE",
            token: token
        )
        try requireLibraryOperationsSuccess(response: response, data: data)
    }

    func getDeckCheckout(
        config: ServerConfiguration,
        token: String,
        deckId: String
    ) async throws -> DeckCheckoutSession? {
        let (data, response) = try await makeRequest(
            config: config,
            path: "decks/\(deckId)/checkout",
            token: token
        )
        if response.statusCode == 404 { return nil }
        try requireLibraryOperationsSuccess(response: response, data: data)
        return try libraryOperationsDecoder.decode(DeckCheckoutSession.self, from: data)
    }

    func checkoutDeck(
        config: ServerConfiguration,
        token: String,
        deckId: String,
        note: String?
    ) async throws -> DeckCheckoutSession {
        try await libraryOperationsResponse(
            config: config,
            path: "decks/\(deckId)/checkout",
            method: "POST",
            token: token,
            body: DeckCheckoutRequest(note: note),
            as: DeckCheckoutSession.self
        )
    }

    func checkinDeck(
        config: ServerConfiguration,
        token: String,
        deckId: String
    ) async throws -> DeckCheckoutSession {
        try await libraryOperationsResponse(
            config: config,
            path: "decks/\(deckId)/checkin",
            method: "POST",
            token: token,
            as: DeckCheckoutSession.self
        )
    }

    func rapidSetEntry(
        config: ServerConfiguration,
        token: String,
        request: RapidSetEntryRequest
    ) async throws -> RapidSetEntryReceipt {
        try await libraryOperationsResponse(
            config: config,
            path: "collections/rapid-entry",
            method: "POST",
            token: token,
            body: request,
            as: RapidSetEntryReceipt.self
        )
    }

    func undoRapidSetEntry(
        config: ServerConfiguration,
        token: String,
        auditId: String
    ) async throws {
        let (data, response) = try await makeRequest(
            config: config,
            path: "collections/history/\(auditId)/undo",
            method: "POST",
            token: token,
            body: UndoCollectionMutationRequest(idempotencyKey: "ios-rapid-undo-\(UUID().uuidString)")
        )
        try requireLibraryOperationsSuccess(response: response, data: data)
    }

    func splitAcquisitionCost(
        config: ServerConfiguration,
        token: String,
        request: AcquisitionCostSplitRequest
    ) async throws -> AcquisitionCostSplitReceipt {
        try await libraryOperationsResponse(
            config: config,
            path: "finance/acquisition-cost-split",
            method: "POST",
            token: token,
            body: request,
            as: AcquisitionCostSplitReceipt.self
        )
    }

    func lookupPSACertification(
        config: ServerConfiguration,
        token: String,
        certificationNumber: String
    ) async throws -> PSACertificationLookup {
        let escaped = certificationNumber.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
            ?? certificationNumber
        return try await libraryOperationsResponse(
            config: config,
            path: "grading/psa/certs/\(escaped)",
            token: token,
            as: PSACertificationLookup.self
        )
    }

    func intakePSACertification(
        config: ServerConfiguration,
        token: String,
        request: PSACertIntakeRequest
    ) async throws -> CollectionCard {
        try await libraryOperationsResponse(
            config: config,
            path: "collections/\(request.binderId)/cards/\(request.entryId)",
            method: "PATCH",
            token: token,
            body: request,
            as: CollectionCard.self
        )
    }

    func updatePrintedIdentity(
        config: ServerConfiguration,
        token: String,
        binderId: String,
        collectionEntryId: String,
        request: PrintedIdentityUpdateRequest
    ) async throws -> CollectionCard {
        try await libraryOperationsResponse(
            config: config,
            path: "collections/\(binderId)/cards/\(collectionEntryId)",
            method: "PATCH",
            token: token,
            body: request,
            as: CollectionCard.self
        )
    }

    func getTrackedPrice(
        config: ServerConfiguration,
        token: String,
        tcg: String,
        externalId: String
    ) async throws -> LibraryTrackedPriceResult {
        let envelope = try await libraryOperationsResponse(
            config: config,
            path: "prices/tracked",
            method: "POST",
            token: token,
            body: TrackedPriceRequest(
                items: [.init(tcg: tcg, externalId: externalId)],
                force: false,
                source: "automatic"
            ),
            as: LibraryTrackedPricesEnvelope.self
        )
        guard let result = envelope.prices.first else { throw APIError.decodingError }
        return result
    }

    private var libraryOperationsDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .useDefaultKeys
        return decoder
    }

    private func libraryOperationsResponse<Response: Decodable>(
        config: ServerConfiguration,
        path: String,
        method: String = "GET",
        token: String,
        body: Encodable? = nil,
        as type: Response.Type
    ) async throws -> Response {
        guard !config.isOnDevice else {
            throw APIError.serverError(
                status: 400,
                message: "Library operations require a connected TCGer server."
            )
        }
        let (data, response) = try await makeRequest(
            config: config,
            path: path,
            method: method,
            token: token,
            body: body
        )
        try requireLibraryOperationsSuccess(response: response, data: data)
        do {
            return try libraryOperationsDecoder.decode(type, from: data)
        } catch {
            throw APIError.decodingError
        }
    }

    private func requireLibraryOperationsSuccess(response: HTTPURLResponse, data: Data) throws {
        guard (200..<300).contains(response.statusCode) else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(
                status: response.statusCode,
                message: parseServerMessage(from: data)
            )
        }
    }
}

private struct DeckCheckoutRequest: Encodable {
    let note: String?
}
