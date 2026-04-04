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
    }

    func getSealedProducts(
        config: ServerConfiguration,
        token: String,
        tcg: String? = nil
    ) async throws -> [SealedProduct] {
        let path = tcg != nil ? "sealed/products?tcg=\(tcg!)" : "sealed/products"
        let (data, response) = try await makeRequest(config: config, path: path, token: token)

        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let products = try? JSONDecoder().decode([SealedProduct].self, from: data) else {
            throw APIError.decodingError
        }
        return products
    }

    func getUserSealedInventory(
        config: ServerConfiguration,
        token: String
    ) async throws -> [SealedInventoryItem] {
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

    func addSealedInventory(
        config: ServerConfiguration,
        token: String,
        productId: String,
        quantity: Int? = nil,
        purchasePrice: Double? = nil,
        purchaseDate: String? = nil,
        notes: String? = nil
    ) async throws -> SealedInventoryItem {
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
        notes: String? = nil
    ) async throws -> SealedInventoryItem {
        let body = UpdateSealedInventoryRequest(
            quantity: quantity,
            purchasePrice: purchasePrice,
            purchaseDate: purchaseDate,
            notes: notes
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
        let (data, response) = try await makeRequest(
            config: config, path: "sealed/inventory/\(itemId)", method: "DELETE", token: token
        )

        guard response.statusCode == 200 || response.statusCode == 204 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
    }
}
