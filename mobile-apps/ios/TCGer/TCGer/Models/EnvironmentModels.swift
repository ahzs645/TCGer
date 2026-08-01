import Foundation

struct ServerConfiguration: Codable, Equatable, Sendable {
    var baseURL: String

    static let defaultLocalBaseURL = "http://localhost:3004"

    /// Sentinel base URL for phone-only mode, where every request is served by
    /// `LocalStore` instead of a backend. The `demo://` scheme is kept for
    /// compatibility with installs configured before the mode was renamed — it
    /// no longer implies demo/sample content.
    static let onDeviceBaseURL = "demo://local"

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

    /// True when the app runs entirely on this phone with no backend server.
    var isOnDevice: Bool {
        baseURL == ServerConfiguration.onDeviceBaseURL
    }

    var isValid: Bool {
        normalizedURL != nil
    }

    func endpoint(path: String, queryItems: [URLQueryItem] = []) -> URL? {
        guard let base = normalizedURL,
              var components = URLComponents(url: base, resolvingAgainstBaseURL: false),
              let pathComponents = URLComponents(string: path) else {
            return nil
        }

        let basePath = components.percentEncodedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let endpointPath = pathComponents.percentEncodedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.percentEncodedPath = [basePath, endpointPath]
            .filter { !$0.isEmpty }
            .joined(separator: "/")
        if !components.percentEncodedPath.isEmpty {
            components.percentEncodedPath = "/" + components.percentEncodedPath
        }

        let combinedQueryItems = (components.queryItems ?? [])
            + (pathComponents.queryItems ?? [])
            + queryItems
        if !combinedQueryItems.isEmpty {
            components.queryItems = combinedQueryItems
            // URLComponents leaves these two query-value delimiters unescaped.
            // Escape them so form-style server parsers cannot reinterpret values.
            components.percentEncodedQuery = components.percentEncodedQuery?
                .replacingOccurrences(of: "+", with: "%2B")
                .replacingOccurrences(of: "?", with: "%3F")
        }

        return components.url
    }

    var backendCandidates: [ServerConfiguration] {
        guard let baseComponents = URLComponents(string: baseURL) else { return [self] }

        func appendCandidate(from components: URLComponents, to list: inout [ServerConfiguration]) {
            guard let urlString = components.url?.absoluteString else { return }
            let sanitized = ServerConfiguration.sanitized(urlString)
            if !list.contains(where: { $0.baseURL == sanitized }) {
                list.append(ServerConfiguration(baseURL: sanitized))
            }
        }

        var candidates: [ServerConfiguration] = []
        appendCandidate(from: baseComponents, to: &candidates)

        if baseComponents.path.isEmpty || baseComponents.path == "/" {
            var gatewayComponents = baseComponents
            if baseComponents.port == 3004 {
                gatewayComponents.port = 3003
            }
            gatewayComponents.path = "/api"
            appendCandidate(from: gatewayComponents, to: &candidates)
        } else if baseComponents.port == 3003 && baseComponents.path == "/api" {
            var directComponents = baseComponents
            directComponents.port = 3004
            directComponents.path = ""
            appendCandidate(from: directComponents, to: &candidates)
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
    static let localDefault = ServerConfiguration(baseURL: defaultLocalBaseURL)
    static let onDevice = ServerConfiguration(baseURL: onDeviceBaseURL)
}

struct LoginCredentials: Codable, Equatable, Sendable {
    var username: String = ""
    var password: String = ""

    var isComplete: Bool {
        !username.isEmpty && !password.isEmpty
    }

    static let empty = LoginCredentials()
}
