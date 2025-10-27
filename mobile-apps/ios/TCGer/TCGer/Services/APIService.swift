import Foundation

final class APIService {
    enum APIError: Error, LocalizedError {
        case invalidURL
        case unauthorized
        case serverError(status: Int, message: String? = nil)
        case decodingError
        case networkError(Error)

        var errorDescription: String? {
            switch self {
            case .invalidURL:
                return "The server address appears to be invalid."
            case .unauthorized:
                return "The server rejected your credentials."
            case .serverError(let status, let message):
                if let message, !message.isEmpty {
                    return "Server error (\(status)): \(message)"
                }
                return "Server responded with status code \(status)."
            case .decodingError:
                return "Unexpected response from the server."
            case .networkError(let error):
                return "Network error: \(error.localizedDescription)"
            }
        }
    }

    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
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
            let encoder = JSONEncoder()
            request.httpBody = try encoder.encode(AnyEncodable(erasing: body))
        }

        return try await execute(request)
    }

    func execute(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.serverError(status: -1, message: nil)
            }
            return (data, httpResponse)
        } catch {
            throw APIError.networkError(error)
        }
    }

    func parseServerMessage(from data: Data) -> String? {
        guard !data.isEmpty else { return nil }

        if let json = try? JSONSerialization.jsonObject(with: data, options: []),
           let dict = json as? [String: Any] {
            if let message = dict["message"] as? String, !message.isEmpty {
                return message
            }
            if let error = dict["error"] as? String, !error.isEmpty {
                return error
            }
        }

        let fallback = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return fallback?.isEmpty == false ? fallback : nil
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
