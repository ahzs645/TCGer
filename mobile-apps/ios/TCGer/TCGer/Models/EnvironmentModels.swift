import Foundation

struct ServerConfiguration: Codable, Equatable {
    var baseURL: String

    init(baseURL: String) {
        self.baseURL = ServerConfiguration.sanitized(baseURL)
    }

    private enum CodingKeys: String, CodingKey {
        case baseURL
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try container.decode(String.self, forKey: .baseURL)
        self.baseURL = ServerConfiguration.sanitized(raw)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(baseURL, forKey: .baseURL)
    }

    var normalizedURL: URL? {
        guard !baseURL.isEmpty else { return nil }
        return URL(string: baseURL)
    }

    var isValid: Bool {
        normalizedURL != nil
    }

    func endpoint(path: String) -> URL? {
        guard let base = normalizedURL else { return nil }
        return base.appendingPathComponent(path)
    }

    var backendCandidates: [ServerConfiguration] {
        guard var baseComponents = URLComponents(string: baseURL) else { return [self] }

        func appendCandidate(from components: URLComponents, to list: inout [ServerConfiguration]) {
            guard let urlString = components.url?.absoluteString else { return }
            let sanitized = ServerConfiguration.sanitized(urlString)
            if !list.contains(where: { $0.baseURL == sanitized }) {
                list.append(ServerConfiguration(baseURL: sanitized))
            }
        }

        var candidates: [ServerConfiguration] = []
        appendCandidate(from: baseComponents, to: &candidates)

        if baseComponents.port == 3001 {
            var apiComponents = baseComponents
            apiComponents.port = 3000
            appendCandidate(from: apiComponents, to: &candidates)
        }

        if baseComponents.path.isEmpty || baseComponents.path == "/" {
            var apiComponents = baseComponents
            apiComponents.path = "/api"
            appendCandidate(from: apiComponents, to: &candidates)

            if baseComponents.port == 3001 {
                apiComponents.port = 3000
                appendCandidate(from: apiComponents, to: &candidates)
            }
        }

        return candidates
    }

    static func sanitized(_ value: String) -> String {
        var trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }

        if !trimmed.contains("://") {
            trimmed = "http://" + trimmed
        }

        if trimmed.last == "/" {
            trimmed.removeLast()
        }

        return trimmed
    }

    static let empty = ServerConfiguration(baseURL: "")
}

struct LoginCredentials: Codable, Equatable {
    var email: String = ""
    var password: String = ""

    var isComplete: Bool {
        !email.isEmpty && !password.isEmpty
    }

    static let empty = LoginCredentials()
}
