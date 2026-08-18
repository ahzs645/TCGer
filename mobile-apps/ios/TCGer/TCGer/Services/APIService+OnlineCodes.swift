import Foundation

extension APIService {
    private struct OnlineCodeInput: Encodable {
        let code: String
        let capturedAt: String?
    }

    private struct CreateOnlineCodesRequest: Encodable {
        let tcg: String
        let codes: [OnlineCodeInput]
        let source: OnlineCodeSource
        let productName: String?
        let notes: String?
    }

    private struct UpdateOnlineCodeStatusRequest: Encodable {
        let status: OnlineCodeStatus
    }

    private struct UpdateOnlineCodeDetailsRequest: Encodable {
        let status: OnlineCodeStatus
        let productName: String?
        let notes: String?

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(status, forKey: .status)
            if let productName {
                try container.encode(productName, forKey: .productName)
            } else {
                try container.encodeNil(forKey: .productName)
            }
            if let notes {
                try container.encode(notes, forKey: .notes)
            } else {
                try container.encodeNil(forKey: .notes)
            }
        }

        private enum CodingKeys: String, CodingKey {
            case status, productName, notes
        }
    }

    func getOnlineCodes(
        config: ServerConfiguration,
        token: String,
        tcg: String? = nil
    ) async throws -> [OnlineCode] {
        if config.isOnDevice { return LocalStore.shared.getOnlineCodes(tcg: tcg) }
        let queryItems = tcg.map { [URLQueryItem(name: "tcg", value: $0)] } ?? []
        let (data, response) = try await makeRequest(
            config: config,
            path: "online-codes",
            queryItems: queryItems,
            token: token
        )
        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(
                status: response.statusCode,
                message: parseServerMessage(from: data)
            )
        }
        guard let result = try? JSONDecoder().decode([OnlineCode].self, from: data) else {
            throw APIError.decodingError
        }
        return result
    }

    func createOnlineCodes(
        config: ServerConfiguration,
        token: String,
        tcg: String,
        codes: [String],
        source: OnlineCodeSource,
        productName: String? = nil,
        notes: String? = nil
    ) async throws -> OnlineCodeBatchResult {
        if config.isOnDevice {
            return try LocalStore.shared.createOnlineCodes(
                tcg: tcg,
                codes: codes,
                source: source,
                productName: productName,
                notes: notes
            )
        }
        let body = CreateOnlineCodesRequest(
            tcg: tcg,
            codes: codes.map { OnlineCodeInput(code: $0, capturedAt: nil) },
            source: source,
            productName: productName,
            notes: notes
        )
        let (data, response) = try await makeRequest(
            config: config,
            path: "online-codes/bulk",
            method: "POST",
            token: token,
            body: body
        )
        guard response.statusCode == 201 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(
                status: response.statusCode,
                message: parseServerMessage(from: data)
            )
        }
        guard let result = try? JSONDecoder().decode(OnlineCodeBatchResult.self, from: data) else {
            throw APIError.decodingError
        }
        return result
    }

    func updateOnlineCodeStatus(
        config: ServerConfiguration,
        token: String,
        id: String,
        status: OnlineCodeStatus
    ) async throws -> OnlineCode {
        if config.isOnDevice {
            return try LocalStore.shared.updateOnlineCode(
                id: id,
                status: status,
                productName: nil,
                notes: nil,
                updateDetails: false
            )
        }
        return try await updateOnlineCodeRequest(
            config: config,
            token: token,
            id: id,
            body: UpdateOnlineCodeStatusRequest(status: status)
        )
    }

    func updateOnlineCodeDetails(
        config: ServerConfiguration,
        token: String,
        id: String,
        status: OnlineCodeStatus,
        productName: String?,
        notes: String?
    ) async throws -> OnlineCode {
        if config.isOnDevice {
            return try LocalStore.shared.updateOnlineCode(
                id: id,
                status: status,
                productName: productName,
                notes: notes,
                updateDetails: true
            )
        }
        return try await updateOnlineCodeRequest(
            config: config,
            token: token,
            id: id,
            body: UpdateOnlineCodeDetailsRequest(
                status: status,
                productName: productName,
                notes: notes
            )
        )
    }

    private func updateOnlineCodeRequest(
        config: ServerConfiguration,
        token: String,
        id: String,
        body: Encodable
    ) async throws -> OnlineCode {
        let (data, response) = try await makeRequest(
            config: config,
            path: "online-codes/\(id)",
            method: "PATCH",
            token: token,
            body: body
        )
        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(
                status: response.statusCode,
                message: parseServerMessage(from: data)
            )
        }
        guard let result = try? JSONDecoder().decode(OnlineCode.self, from: data) else {
            throw APIError.decodingError
        }
        return result
    }

    func deleteOnlineCode(
        config: ServerConfiguration,
        token: String,
        id: String
    ) async throws {
        if config.isOnDevice {
            try LocalStore.shared.deleteOnlineCode(id: id)
            return
        }
        let (data, response) = try await makeRequest(
            config: config,
            path: "online-codes/\(id)",
            method: "DELETE",
            token: token
        )
        guard response.statusCode == 204 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(
                status: response.statusCode,
                message: parseServerMessage(from: data)
            )
        }
    }
}
