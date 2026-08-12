import Foundation

extension APIService {
    struct UserProfile: Codable, Sendable {
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
        token: String? = nil
    ) async throws -> UserProfile {
        if config.isOnDevice {
            return LocalStore.shared.getUserProfile()
        }

        let (data, response) = try await makeRequest(
            config: config,
            path: "users/me",
            token: token
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }

        guard let profile = try? JSONDecoder().decode(UserProfile.self, from: data) else {
            throw APIError.decodingError
        }

        return profile
    }

    struct UpdateProfileRequest: Codable, Sendable {
        let username: String?
        let email: String?
    }

    struct UpdatedProfile: Codable, Sendable {
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
        if config.isOnDevice {
            let profile = LocalStore.shared.updateUserProfile(username: username, email: email)
            try LocalStore.shared.requireLatestMutationPersisted()
            return profile
        }

        let body = UpdateProfileRequest(
            username: username,
            email: email
        )

        let (data, response) = try await makeRequest(
            config: config,
            path: "users/me",
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

        guard let profile = try? JSONDecoder().decode(UpdatedProfile.self, from: data) else {
            throw APIError.decodingError
        }

        return profile
    }

    struct ChangePasswordRequest: Codable, Sendable {
        let currentPassword: String
        let newPassword: String
    }

    struct ChangePasswordResponse: Codable, Sendable {
        let success: Bool
    }

    func changePassword(
        config: ServerConfiguration,
        token: String,
        currentPassword: String,
        newPassword: String
    ) async throws {
        if config.isOnDevice {
            LocalStore.shared.changePassword(
                currentPassword: currentPassword,
                newPassword: newPassword
            )
            return
        }

        let body = ChangePasswordRequest(
            currentPassword: currentPassword,
            newPassword: newPassword
        )

        let (_, response) = try await makeRequest(
            config: config,
            path: "users/me/change-password",
            method: "POST",
            token: token,
            body: body
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }
    }

    private struct DeleteAccountRequest: Codable, Sendable {
        let password: String
    }

    func deleteServerAccount(
        config: ServerConfiguration,
        token: String,
        password: String
    ) async throws {
        let body = DeleteAccountRequest(password: password)
        let (data, response) = try await makeRequest(
            config: config,
            path: "users/me",
            method: "DELETE",
            token: token,
            body: body
        )

        guard response.statusCode == 200 || response.statusCode == 202 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(
                status: response.statusCode,
                message: parseServerMessage(from: data)
            )
        }
    }
}
