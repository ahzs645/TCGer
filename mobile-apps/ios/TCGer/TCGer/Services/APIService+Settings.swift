import Foundation

extension APIService {
    func getSettings(config: ServerConfiguration) async throws -> AppSettings {
        let (data, response) = try await makeRequest(config: config, path: "settings")

        guard response.statusCode == 200 else {
            throw APIError.serverError(status: response.statusCode)
        }

        guard let settings = try? JSONDecoder().decode(AppSettings.self, from: data) else {
            throw APIError.decodingError
        }

        return settings
    }

    struct UpdateSettingsRequest: Codable {
        let publicDashboard: Bool?
        let publicCollections: Bool?
        let requireAuth: Bool?
        let appName: String?
    }

    func updateSettings(
        config: ServerConfiguration,
        token: String,
        publicDashboard: Bool? = nil,
        publicCollections: Bool? = nil,
        requireAuth: Bool? = nil,
        appName: String? = nil
    ) async throws -> AppSettings {
        let body = UpdateSettingsRequest(
            publicDashboard: publicDashboard,
            publicCollections: publicCollections,
            requireAuth: requireAuth,
            appName: appName
        )

        let (data, response) = try await makeRequest(
            config: config,
            path: "settings",
            method: "PATCH",
            token: token,
            body: body
        )

        guard response.statusCode == 200 else {
            let serverMessage = parseServerMessage(from: data)
            throw APIError.serverError(status: response.statusCode, message: serverMessage)
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
        let (data, response) = try await makeRequest(
            config: config,
            path: "users/me/preferences",
            token: token
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
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

        let (data, response) = try await makeRequest(
            config: config,
            path: "users/me/preferences",
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

        guard let preferences = try? JSONDecoder().decode(UserPreferences.self, from: data) else {
            throw APIError.decodingError
        }

        return preferences
    }
}
