import Foundation

extension APIService {
    func authenticate(
        config: ServerConfiguration,
        credentials: LoginCredentials
    ) async throws -> String {
        let payload = LoginPayload(email: credentials.email, password: credentials.password)
        let (data, response) = try await makeRequest(
            config: config,
            path: "auth/login",
            method: "POST",
            body: payload
        )

        switch response.statusCode {
        case 200:
            guard let auth = try? JSONDecoder().decode(AuthTokenResponse.self, from: data) else {
                throw APIError.decodingError
            }
            return auth.token
        case 401:
            throw APIError.unauthorized
        default:
            throw APIError.serverError(status: response.statusCode)
        }
    }

    func verifyServer(config: ServerConfiguration) async -> Bool {
        guard let url = config.endpoint(path: "health") ?? config.normalizedURL else {
            return false
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 10
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.setValue("no-cache", forHTTPHeaderField: "Pragma")

        do {
            let (data, response) = try await execute(request)
            guard (200..<400).contains(response.statusCode) else {
                return false
            }

            guard
                let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let status = (json["status"] as? String)?.lowercased()
            else {
                return false
            }

            return status == "ok" || status == "ready"
        } catch {
            return false
        }
    }
}

private extension APIService {
    struct LoginPayload: Encodable {
        let email: String
        let password: String
    }

    struct AuthTokenResponse: Decodable {
        let token: String
    }
}
