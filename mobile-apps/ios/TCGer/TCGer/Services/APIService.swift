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

    private let session: URLSession
    private let encoder: JSONEncoder

    init(session: URLSession = .shared, encoder: JSONEncoder = JSONEncoder()) {
        self.session = session
        self.encoder = encoder
    }

    func makeRequest(
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

        if let token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            request.httpBody = try encoder.encode(AnyEncodable(erasing: body))
        }

        return try await execute(request)
    }

    func execute(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.serverError(status: -1)
            }
            return (data, httpResponse)
        } catch {
            throw APIError.networkError(error)
        }
    }
}

private struct AnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void

    init(erasing value: Encodable) {
        self.encodeClosure = { encoder in
            try value.encode(to: encoder)
        }
    }

    func encode(to encoder: Encoder) throws {
        try encodeClosure(encoder)
    }
}
