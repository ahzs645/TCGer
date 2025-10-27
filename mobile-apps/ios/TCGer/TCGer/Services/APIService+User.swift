import Foundation

extension APIService {
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
}
