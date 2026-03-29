import Foundation

extension APIService {
    func authenticate(
        config: ServerConfiguration,
        credentials: LoginCredentials
    ) async throws -> AuthResponse {
        if config.isDemoMode {
            return DemoStore.shared.authenticate(username: credentials.username)
        }

        let payload = UsernameLoginPayload(
            username: credentials.username,
            password: credentials.password
        )
        let (data, response) = try await makeRequest(
            config: config,
            path: "auth/sign-in/username",
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
            let serverMessage = parseServerMessage(from: data)
            throw APIError.serverError(status: response.statusCode, message: serverMessage)
        }
    }

    func signup(
        config: ServerConfiguration,
        email: String,
        password: String,
        username: String
    ) async throws -> AuthResponse {
        if config.isDemoMode {
            return DemoStore.shared.authenticate(username: username, email: email)
        }

        let payload = SignupPayload(
            email: email,
            password: password,
            name: username,
            username: username
        )
        return try await executeAuthRequest(config: config, path: "auth/sign-up/email", payload: payload)
    }

    func setupInitialAdmin(
        config: ServerConfiguration,
        email: String,
        password: String,
        username: String
    ) async throws -> AuthResponse {
        if config.isDemoMode {
            return DemoStore.shared.authenticate(username: username, email: email)
        }

        // Step 1: Sign up via Better Auth
        let signupPayload = SignupPayload(
            email: email,
            password: password,
            name: username,
            username: username
        )
        let authResponse = try await executeAuthRequest(
            config: config,
            path: "auth/sign-up/email",
            payload: signupPayload
        )

        // Step 2: Promote to admin via setup endpoint (with bearer token)
        let (_, promoteResponse) = try await makeRequest(
            config: config,
            path: "setup/setup",
            method: "POST",
            token: authResponse.token
        )

        guard (200..<300).contains(promoteResponse.statusCode) else {
            throw APIError.serverError(
                status: promoteResponse.statusCode,
                message: "Account created but admin promotion failed"
            )
        }

        // Return auth response with isAdmin set to true
        let adminUser = User(
            id: authResponse.user.id,
            email: authResponse.user.email,
            name: authResponse.user.name,
            username: authResponse.user.username,
            isAdmin: true,
            showCardNumbers: authResponse.user.showCardNumbers,
            showPricing: authResponse.user.showPricing,
            enabledYugioh: authResponse.user.enabledYugioh,
            enabledMagic: authResponse.user.enabledMagic,
            enabledPokemon: authResponse.user.enabledPokemon,
            defaultGame: authResponse.user.defaultGame
        )
        return AuthResponse(user: adminUser, token: authResponse.token)
    }

    func checkSetupRequired(config: ServerConfiguration) async throws -> SetupCheckResponse {
        if config.isDemoMode {
            return DemoStore.shared.checkSetupRequired()
        }

        let (data, response) = try await makeRequest(
            config: config,
            path: "setup/setup-required"
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
        if config.isDemoMode {
            return true
        }

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

    struct UsernameLoginPayload: Encodable {
        let username: String
        let password: String
    }

    struct SignupPayload: Encodable {
        let email: String
        let password: String
        let name: String
        let username: String
    }
}
