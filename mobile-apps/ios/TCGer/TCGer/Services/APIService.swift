import Foundation

actor APIService {
    enum APIError: Error, LocalizedError {
        case invalidURL
        case unauthorized
        case serverError(status: Int)
        case decodingError
        case networkError(Error)

        var errorDescription: String? {
            switch self {
            case .invalidURL:
                return "The server address appears to be invalid."
            case .unauthorized:
                return "The server rejected your credentials."
            case .serverError(let status):
                return "Server responded with status code \(status)."
            case .decodingError:
                return "Unexpected response from the server."
            case .networkError(let error):
                return "Network error: \(error.localizedDescription)"
            }
        }
    }

    private func makeRequest(
        config: ServerConfiguration,
        path: String,
        method: String = "GET",
        token: String? = nil,
        body: Encodable? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        guard let url = config.endpoint(path: path) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")

        if let token = token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body = body {
            request.httpBody = try JSONEncoder().encode(body)
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.serverError(status: -1)
            }
            return (data, httpResponse)
        } catch {
            throw APIError.networkError(error)
        }
    }

    func authenticate(config: ServerConfiguration, credentials: LoginCredentials) async throws -> String {
        guard let url = config.endpoint(path: "auth/login") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode([
            "email": credentials.email,
            "password": credentials.password
        ])

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError(status: -1)
        }

        switch httpResponse.statusCode {
        case 200:
            struct AuthResponse: Decodable { let token: String }
            guard let auth = try? JSONDecoder().decode(AuthResponse.self, from: data) else {
                throw APIError.decodingError
            }
            return auth.token
        case 401:
            throw APIError.unauthorized
        default:
            throw APIError.serverError(status: httpResponse.statusCode)
        }
    }

    func verifyServer(config: ServerConfiguration) async -> Bool {
        guard let url = config.endpoint(path: "health") ?? config.normalizedURL else {
            return false
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 10

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else { return false }
            return (200..<400).contains(httpResponse.statusCode)
        } catch {
            return false
        }
    }

    // MARK: - Cards API
    func searchCards(
        config: ServerConfiguration,
        token: String,
        query: String,
        game: TCGGame = .all
    ) async throws -> CardSearchResponse {
        var path = "cards/search?query=\(query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query)"
        if game != .all {
            path += "&tcg=\(game.rawValue)"
        }

        let (data, httpResponse) = try await makeRequest(config: config, path: path, token: token)

        guard httpResponse.statusCode == 200 else {
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: httpResponse.statusCode)
        }

        guard let response = try? JSONDecoder().decode(CardSearchResponse.self, from: data) else {
            throw APIError.decodingError
        }

        return response
    }

    // MARK: - Collections API
    func getCollections(
        config: ServerConfiguration,
        token: String
    ) async throws -> [Collection] {
        let (data, httpResponse) = try await makeRequest(config: config, path: "collections", token: token)

        guard httpResponse.statusCode == 200 else {
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: httpResponse.statusCode)
        }

        guard let collections = try? JSONDecoder().decode([Collection].self, from: data) else {
            throw APIError.decodingError
        }

        return collections
    }

    func getCollection(
        config: ServerConfiguration,
        token: String,
        id: String
    ) async throws -> Collection {
        let (data, httpResponse) = try await makeRequest(config: config, path: "collections/\(id)", token: token)

        guard httpResponse.statusCode == 200 else {
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: httpResponse.statusCode)
        }

        guard let collection = try? JSONDecoder().decode(Collection.self, from: data) else {
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
        let (data, httpResponse) = try await makeRequest(
            config: config,
            path: "collections",
            method: "POST",
            token: token,
            body: body
        )

        guard httpResponse.statusCode == 201 else {
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: httpResponse.statusCode)
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
        let (_, httpResponse) = try await makeRequest(
            config: config,
            path: "collections/\(id)",
            method: "DELETE",
            token: token
        )

        guard httpResponse.statusCode == 204 || httpResponse.statusCode == 200 else {
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: httpResponse.statusCode)
        }
    }

    // MARK: - Settings API
    func getSettings(config: ServerConfiguration) async throws -> AppSettings {
        let (data, httpResponse) = try await makeRequest(config: config, path: "settings")

        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError(status: httpResponse.statusCode)
        }

        guard let settings = try? JSONDecoder().decode(AppSettings.self, from: data) else {
            throw APIError.decodingError
        }

        return settings
    }
}
