import Foundation

extension APIService {
    func getNotifications(
        config: ServerConfiguration,
        token: String
    ) async throws -> [AppNotification] {
        guard !config.isOnDevice else { return [] }

        let (data, response) = try await makeRequest(
            config: config,
            path: "notifications",
            token: token
        )

        switch response.statusCode {
        case 200:
            do {
                return try JSONDecoder().decode([AppNotification].self, from: data)
            } catch {
                throw APIError.decodingError
            }
        case 401:
            throw APIError.unauthorized
        default:
            throw APIError.serverError(
                status: response.statusCode,
                message: parseServerMessage(from: data)
            )
        }
    }

    func markNotificationRead(
        config: ServerConfiguration,
        token: String,
        notificationID: String
    ) async throws -> AppNotification {
        var pathSegmentCharacters = CharacterSet.urlPathAllowed
        pathSegmentCharacters.remove(charactersIn: "/")
        let encodedID = notificationID.addingPercentEncoding(withAllowedCharacters: pathSegmentCharacters)
            ?? notificationID
        let (data, response) = try await makeRequest(
            config: config,
            path: "notifications/\(encodedID)/read",
            method: "PATCH",
            token: token
        )

        switch response.statusCode {
        case 200:
            do {
                return try JSONDecoder().decode(AppNotification.self, from: data)
            } catch {
                throw APIError.decodingError
            }
        case 401:
            throw APIError.unauthorized
        default:
            throw APIError.serverError(
                status: response.statusCode,
                message: parseServerMessage(from: data)
            )
        }
    }

    func markAllNotificationsRead(
        config: ServerConfiguration,
        token: String
    ) async throws {
        let (data, response) = try await makeRequest(
            config: config,
            path: "notifications/read-all",
            method: "POST",
            token: token
        )

        switch response.statusCode {
        case 200, 204:
            return
        case 401:
            throw APIError.unauthorized
        default:
            throw APIError.serverError(
                status: response.statusCode,
                message: parseServerMessage(from: data)
            )
        }
    }
}
