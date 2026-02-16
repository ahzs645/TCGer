import Foundation

extension APIService {
    func authenticate(
        config: ServerConfiguration,
        credentials: LoginCredentials
    ) async throws -> AuthResponse {
        let payload = LoginPayload(email: credentials.email, password: credentials.password)
        let (data, response) = try await makeRequest(
            config: config,
            path: "auth/login",
            method: "POST",
            body: payload
        )

        switch response.statusCode {
        case 200:
            guard let auth = try? JSONDecoder().decode(AuthResponse.self, from: data) else {
                throw APIError.decodingError
            }
            return auth
        case 401:
            throw APIError.unauthorized
        default:
            throw APIError.serverError(status: response.statusCode)
        }
    }

    func signup(
        config: ServerConfiguration,
        email: String,
        password: String,
        username: String?
    ) async throws -> AuthResponse {
        let payload = SignupPayload(email: email, password: password, username: username)
        return try await executeAuthRequest(config: config, path: "auth/signup", payload: payload)
    }

    func setupInitialAdmin(
        config: ServerConfiguration,
        email: String,
        password: String,
        username: String?
    ) async throws -> AuthResponse {
        let payload = SignupPayload(email: email, password: password, username: username)
        return try await executeAuthRequest(config: config, path: "auth/setup", payload: payload)
    }

    func checkSetupRequired(config: ServerConfiguration) async throws -> SetupCheckResponse {
        let (data, response) = try await makeRequest(
            config: config,
            path: "auth/setup-required"
        )

        guard response.statusCode == 200 else {
            throw APIError.serverError(status: response.statusCode)
        }

        guard let setupStatus = try? JSONDecoder().decode(SetupCheckResponse.self, from: data) else {
            throw APIError.decodingError
        }

        return setupStatus
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
    func executeAuthRequest(
        config: ServerConfiguration,
        path: String,
        payload: SignupPayload
    ) async throws -> AuthResponse {
        let (data, response) = try await makeRequest(
            config: config,
            path: path,
            method: "POST",
            body: payload
        )

        switch response.statusCode {
        case 200, 201:
            guard let authResponse = try? JSONDecoder().decode(AuthResponse.self, from: data) else {
                throw APIError.decodingError
            }
            return authResponse
        case 401:
            throw APIError.unauthorized
        default:
            let serverMessage = parseServerMessage(from: data)
            throw APIError.serverError(status: response.statusCode, message: serverMessage)
        }
    }

    struct LoginPayload: Encodable {
        let email: String
        let password: String
    }

    struct SignupPayload: Encodable {
        let email: String
        let password: String
        let username: String?
    }
}
