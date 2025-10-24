import Foundation

final class APIService {
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
        token: String,
        useCache: Bool = false
    ) async throws -> [Collection] {
        // Try to load from cache if offline mode or requested
        if useCache || !NetworkMonitor.shared.isConnected {
            if let cached: [Collection] = try? CacheManager.shared.load([Collection].self, forKey: CacheManager.CacheKey.collections) {
                return cached
            }

            // If no cache and offline, throw error
            if !NetworkMonitor.shared.isConnected {
                throw APIError.networkError(NSError(domain: "TCGer", code: -1, userInfo: [NSLocalizedDescriptionKey: "No internet connection and no cached data available"]))
            }
        }

        // Fetch from network
        do {
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

            // Save to cache for offline use
            try? CacheManager.shared.save(collections, forKey: CacheManager.CacheKey.collections)
            CacheManager.shared.updateLastSyncDate()

            return collections
        } catch {
            // On network error, try to return cached data as fallback
            if let cached: [Collection] = try? CacheManager.shared.load([Collection].self, forKey: CacheManager.CacheKey.collections) {
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
        let (data, httpResponse) = try await makeRequest(
            config: config,
            path: "collections/\(id)",
            method: "PATCH",
            token: token,
            body: body
        )

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
        if let card = card {
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

        let (_, httpResponse) = try await makeRequest(
            config: config,
            path: path,
            method: "POST",
            token: token,
            body: body
        )

        guard httpResponse.statusCode == 201 || httpResponse.statusCode == 200 else {
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

    struct UserPreferences: Codable {
        let showCardNumbers: Bool
        let showPricing: Bool
        let enabledYugioh: Bool
        let enabledMagic: Bool
        let enabledPokemon: Bool
    }

    func getUserPreferences(
        config: ServerConfiguration,
        token: String
    ) async throws -> UserPreferences {
        let (data, httpResponse) = try await makeRequest(
            config: config,
            path: "users/me/preferences",
            token: token
        )

        guard httpResponse.statusCode == 200 else {
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: httpResponse.statusCode)
        }

        guard let preferences = try? JSONDecoder().decode(UserPreferences.self, from: data) else {
            throw APIError.decodingError
        }

        return preferences
    }

    struct UpdatePreferencesRequest: Codable {
        let showCardNumbers: Bool?
        let showPricing: Bool?
        let enabledYugioh: Bool?
        let enabledMagic: Bool?
        let enabledPokemon: Bool?
    }

    func updateUserPreferences(
        config: ServerConfiguration,
        token: String,
        showCardNumbers: Bool? = nil,
        showPricing: Bool? = nil,
        enabledYugioh: Bool? = nil,
        enabledMagic: Bool? = nil,
        enabledPokemon: Bool? = nil
    ) async throws -> UserPreferences {
        let body = UpdatePreferencesRequest(
            showCardNumbers: showCardNumbers,
            showPricing: showPricing,
            enabledYugioh: enabledYugioh,
            enabledMagic: enabledMagic,
            enabledPokemon: enabledPokemon
        )

        let (data, httpResponse) = try await makeRequest(
            config: config,
            path: "users/me/preferences",
            method: "PATCH",
            token: token,
            body: body
        )

        guard httpResponse.statusCode == 200 else {
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: httpResponse.statusCode)
        }

        guard let preferences = try? JSONDecoder().decode(UserPreferences.self, from: data) else {
            throw APIError.decodingError
        }

        return preferences
    }

    // MARK: - User Profile API
    struct UserProfile: Codable {
        let id: String
        let email: String
        let username: String?
        let isAdmin: Bool
        let showCardNumbers: Bool
        let showPricing: Bool
        let createdAt: String
    }

    func getUserProfile(
        config: ServerConfiguration,
        token: String
    ) async throws -> UserProfile {
        let (data, httpResponse) = try await makeRequest(
            config: config,
            path: "users/me",
            token: token
        )

        guard httpResponse.statusCode == 200 else {
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: httpResponse.statusCode)
        }

        guard let profile = try? JSONDecoder().decode(UserProfile.self, from: data) else {
            throw APIError.decodingError
        }

        return profile
    }

    struct UpdateProfileRequest: Codable {
        let username: String?
        let email: String?
    }

    struct UpdatedProfile: Codable {
        let id: String
        let email: String
        let username: String?
        let isAdmin: Bool
        let showCardNumbers: Bool
        let showPricing: Bool
    }

    func updateUserProfile(
        config: ServerConfiguration,
        token: String,
        username: String? = nil,
        email: String? = nil
    ) async throws -> UpdatedProfile {
        let body = UpdateProfileRequest(
            username: username,
            email: email
        )

        let (data, httpResponse) = try await makeRequest(
            config: config,
            path: "users/me",
            method: "PATCH",
            token: token,
            body: body
        )

        guard httpResponse.statusCode == 200 else {
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: httpResponse.statusCode)
        }

        guard let profile = try? JSONDecoder().decode(UpdatedProfile.self, from: data) else {
            throw APIError.decodingError
        }

        return profile
    }

    struct ChangePasswordRequest: Codable {
        let currentPassword: String
        let newPassword: String
    }

    struct ChangePasswordResponse: Codable {
        let success: Bool
    }

    func changePassword(
        config: ServerConfiguration,
        token: String,
        currentPassword: String,
        newPassword: String
    ) async throws {
        let body = ChangePasswordRequest(
            currentPassword: currentPassword,
            newPassword: newPassword
        )

        let (_, httpResponse) = try await makeRequest(
            config: config,
            path: "users/me/change-password",
            method: "POST",
            token: token,
            body: body
        )

        guard httpResponse.statusCode == 200 else {
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: httpResponse.statusCode)
        }
    }
}
