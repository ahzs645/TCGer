import Foundation

extension APIService {

    private struct AddSealedInventoryRequest: Encodable {
        let productId: String
        let quantity: Int?
        let purchasePrice: Double?
        let purchaseDate: String?
        let notes: String?
    }

    private struct UpdateSealedInventoryRequest: Encodable {
        let quantity: Int?
        let purchasePrice: Double?
        let purchaseDate: String?
        let notes: String?
        let clearPurchasePrice: Bool
        let clearPurchaseDate: Bool
        let clearNotes: Bool

        private enum CodingKeys: String, CodingKey {
            case quantity
            case purchasePrice
            case purchaseDate
            case notes
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encodeIfPresent(quantity, forKey: .quantity)

            if clearPurchasePrice {
                try container.encodeNil(forKey: .purchasePrice)
            } else {
                try container.encodeIfPresent(purchasePrice, forKey: .purchasePrice)
            }

            if clearPurchaseDate {
                try container.encodeNil(forKey: .purchaseDate)
            } else {
                try container.encodeIfPresent(purchaseDate, forKey: .purchaseDate)
            }

            if clearNotes {
                try container.encodeNil(forKey: .notes)
            } else {
                try container.encodeIfPresent(notes, forKey: .notes)
            }
        }
    }

    private struct CreateSealedOpeningRequest: Encodable {
        let openedQuantity: Int
        let collectionIds: [String]
        let openedAt: String?
        let notes: String?
    }

    private struct RecordOpenedCardSaleRequest: Encodable {
        let proceeds: Double
        let soldAt: String?
    }

    func getSealedProducts(
        config: ServerConfiguration,
        token: String,
        tcg: String? = nil
    ) async throws -> [SealedProduct] {
        if config.isOnDevice {
            let all = LocalStore.shared.getSealedProducts()
            if let tcg { return all.filter { $0.tcg == tcg } }
            return all
        }
        let queryItems = tcg.map { [URLQueryItem(name: "tcg", value: $0)] } ?? []
        let (data, response) = try await makeRequest(
            config: config,
            path: "sealed/products",
            queryItems: queryItems,
            token: token
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let products = try? JSONDecoder().decode([SealedProduct].self, from: data) else {
            throw APIError.decodingError
        }
        return products
    }

    func getSealedProductDetails(
        config: ServerConfiguration,
        token: String,
        productId: String
    ) async throws -> SealedProduct {
        if config.isOnDevice {
            guard let product = LocalStore.shared.getSealedProducts().first(where: { $0.id == productId }) else {
                throw APIError.serverError(status: 404, message: "Sealed product not found.")
            }
            return product
        }
        let (data, response) = try await makeRequest(
            config: config,
            path: "sealed/products/\(productId)",
            token: token
        )
        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        guard let product = try? JSONDecoder().decode(SealedProduct.self, from: data) else {
            throw APIError.decodingError
        }
        return product
    }

    func getSealedProduct(
        config: ServerConfiguration,
        token: String,
        barcode: String
    ) async throws -> SealedProduct {
        let normalized = barcode.filter(\.isNumber)
        guard (8...14).contains(normalized.count) else {
            throw APIError.serverError(status: 400, message: "Barcode must contain 8 to 14 digits.")
        }
        if config.isOnDevice {
            let equivalents = Set([
                normalized,
                normalized.count == 12 ? "0\(normalized)" : normalized,
                normalized.count == 13 && normalized.hasPrefix("0")
                    ? String(normalized.dropFirst())
                    : normalized
            ])
            guard let product = LocalStore.shared.getSealedProducts().first(where: {
                guard let upc = $0.upc else { return false }
                return equivalents.contains(upc.filter(\.isNumber))
            }) else {
                throw APIError.serverError(status: 404, message: "No sealed product matches this barcode.")
            }
            return product
        }

        let (data, response) = try await makeRequest(
            config: config,
            path: "sealed/products/barcode/\(normalized)",
            token: token
        )
        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(
                status: response.statusCode,
                message: parseServerMessage(from: data)
            )
        }
        guard let product = try? JSONDecoder().decode(SealedProduct.self, from: data) else {
            throw APIError.decodingError
        }
        return product
    }

    func getUserSealedInventory(
        config: ServerConfiguration,
        token: String
    ) async throws -> [SealedInventoryItem] {
        if config.isOnDevice { return LocalStore.shared.getSealedInventory() }
        let (data, response) = try await makeRequest(config: config, path: "sealed/inventory", token: token)

        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let items = try? JSONDecoder().decode([SealedInventoryItem].self, from: data) else {
            throw APIError.decodingError
        }
        return items
    }

    func getSealedOpeningLedgers(
        config: ServerConfiguration,
        token: String
    ) async throws -> [SealedOpeningLedger] {
        if config.isOnDevice { return [] }
        let (data, response) = try await makeRequest(
            config: config,
            path: "sealed/openings",
            token: token
        )
        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(
                status: response.statusCode,
                message: parseServerMessage(from: data)
            )
        }
        guard let ledgers = try? JSONDecoder().decode([SealedOpeningLedger].self, from: data) else {
            throw APIError.decodingError
        }
        return ledgers
    }

    func createSealedOpening(
        config: ServerConfiguration,
        token: String,
        inventoryId: String,
        openedQuantity: Int,
        collectionIds: [String] = [],
        openedAt: String? = nil,
        notes: String? = nil
    ) async throws -> SealedOpeningRecord {
        guard !config.isOnDevice else {
            throw APIError.serverError(
                status: 501,
                message: "Sealed opening ledgers require a connected TCGer server."
            )
        }
        let body = CreateSealedOpeningRequest(
            openedQuantity: openedQuantity,
            collectionIds: collectionIds,
            openedAt: openedAt,
            notes: notes
        )
        let (data, response) = try await makeRequest(
            config: config,
            path: "sealed/inventory/\(inventoryId)/open",
            method: "POST",
            token: token,
            body: body
        )
        guard response.statusCode == 201 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        guard let opening = try? JSONDecoder().decode(SealedOpeningRecord.self, from: data) else {
            throw APIError.decodingError
        }
        return opening
    }

    func recordOpenedCardSale(
        config: ServerConfiguration,
        token: String,
        cardId: String,
        proceeds: Double,
        soldAt: String? = nil
    ) async throws -> SealedOpenedCardRecord {
        guard !config.isOnDevice else {
            throw APIError.serverError(
                status: 501,
                message: "Opened-card sales require a connected TCGer server."
            )
        }
        let body = RecordOpenedCardSaleRequest(proceeds: proceeds, soldAt: soldAt)
        let (data, response) = try await makeRequest(
            config: config,
            path: "sealed/openings/cards/\(cardId)/sale",
            method: "PATCH",
            token: token,
            body: body
        )
        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        guard let card = try? JSONDecoder().decode(SealedOpenedCardRecord.self, from: data) else {
            throw APIError.decodingError
        }
        return card
    }

    func addSealedInventory(
        config: ServerConfiguration,
        token: String,
        productId: String,
        quantity: Int? = nil,
        purchasePrice: Double? = nil,
        purchaseDate: String? = nil,
        notes: String? = nil
    ) async throws -> SealedInventoryItem {
        if config.isOnDevice {
            guard let item = LocalStore.shared.addSealedInventory(productId: productId, quantity: quantity ?? 1, purchasePrice: purchasePrice) else {
                throw APIError.serverError(status: 404, message: "Product not found")
            }
            try LocalStore.shared.requireLatestMutationPersisted()
            return item
        }
        let body = AddSealedInventoryRequest(
            productId: productId,
            quantity: quantity,
            purchasePrice: purchasePrice,
            purchaseDate: purchaseDate,
            notes: notes
        )
        let (data, response) = try await makeRequest(
            config: config, path: "sealed/inventory", method: "POST", token: token, body: body
        )

        guard response.statusCode == 201 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let item = try? JSONDecoder().decode(SealedInventoryItem.self, from: data) else {
            throw APIError.decodingError
        }
        return item
    }

    func updateSealedInventory(
        config: ServerConfiguration,
        token: String,
        itemId: String,
        quantity: Int? = nil,
        purchasePrice: Double? = nil,
        purchaseDate: String? = nil,
        notes: String? = nil,
        clearPurchasePrice: Bool = false,
        clearPurchaseDate: Bool = false,
        clearNotes: Bool = false
    ) async throws -> SealedInventoryItem {
        if config.isOnDevice {
            return try LocalStore.shared.updateSealedInventory(
                itemId: itemId,
                quantity: quantity,
                purchasePrice: purchasePrice,
                purchaseDate: purchaseDate,
                notes: notes,
                clearPurchasePrice: clearPurchasePrice,
                clearPurchaseDate: clearPurchaseDate,
                clearNotes: clearNotes
            )
        }
        let body = UpdateSealedInventoryRequest(
            quantity: quantity,
            purchasePrice: purchasePrice,
            purchaseDate: purchaseDate,
            notes: notes,
            clearPurchasePrice: clearPurchasePrice,
            clearPurchaseDate: clearPurchaseDate,
            clearNotes: clearNotes
        )
        let (data, response) = try await makeRequest(
            config: config, path: "sealed/inventory/\(itemId)", method: "PATCH", token: token, body: body
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let item = try? JSONDecoder().decode(SealedInventoryItem.self, from: data) else {
            throw APIError.decodingError
        }
        return item
    }

    func deleteSealedInventory(
        config: ServerConfiguration,
        token: String,
        itemId: String
    ) async throws {
        if config.isOnDevice {
            LocalStore.shared.deleteSealedInventory(itemId: itemId)
            try LocalStore.shared.requireLatestMutationPersisted()
            return
        }
        let (data, response) = try await makeRequest(
            config: config, path: "sealed/inventory/\(itemId)", method: "DELETE", token: token
        )

        guard response.statusCode == 200 || response.statusCode == 204 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
    }
}
