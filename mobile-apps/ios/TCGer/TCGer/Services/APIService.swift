import Foundation

actor APIService {
    enum APIError: Error, LocalizedError {
        case invalidURL
        case unauthorized
        case serverError(status: Int)
        case decodingError

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
            }
        }
    }

    func authenticate(config: ServerConfiguration, credentials: LoginCredentials) async throws -> String {
        var components = URLComponents()
        components.scheme = config.scheme
        components.host = config.host
        components.port = Int(config.port)
        components.path = "/auth/login"

        guard let url = components.url else {
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
}
