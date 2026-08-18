import Foundation

struct ServerFeatures: Decodable, Equatable, Sendable {
    let decks: Bool
    let finance: Bool
    let sealed: Bool
    let analytics: Bool
    let trades: Bool
    let onlineCodes: Bool
    let prices: Bool
    let notifications: Bool
    let alerts: Bool
    let shops: Bool
    let automations: Bool
    let shipments: Bool
    let `public`: Bool

    static let allEnabled = ServerFeatures()

    init(
        decks: Bool = true,
        finance: Bool = true,
        sealed: Bool = true,
        analytics: Bool = true,
        trades: Bool = true,
        onlineCodes: Bool = true,
        prices: Bool = true,
        notifications: Bool = true,
        alerts: Bool = true,
        shops: Bool = true,
        automations: Bool = true,
        shipments: Bool = true,
        publicFeature: Bool = true
    ) {
        self.decks = decks
        self.finance = finance
        self.sealed = sealed
        self.analytics = analytics
        self.trades = trades
        self.onlineCodes = onlineCodes
        self.prices = prices
        self.notifications = notifications
        self.alerts = alerts
        self.shops = shops
        self.automations = automations
        self.shipments = shipments
        self.`public` = publicFeature
    }

    private enum CodingKeys: String, CodingKey {
        case decks, finance, sealed, analytics, trades, onlineCodes, prices
        case notifications, alerts, shops, automations, shipments
        case publicFeature = "public"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        decks = try container.decodeIfPresent(Bool.self, forKey: .decks) ?? true
        finance = try container.decodeIfPresent(Bool.self, forKey: .finance) ?? true
        sealed = try container.decodeIfPresent(Bool.self, forKey: .sealed) ?? true
        analytics = try container.decodeIfPresent(Bool.self, forKey: .analytics) ?? true
        trades = try container.decodeIfPresent(Bool.self, forKey: .trades) ?? true
        onlineCodes = try container.decodeIfPresent(Bool.self, forKey: .onlineCodes) ?? false
        prices = try container.decodeIfPresent(Bool.self, forKey: .prices) ?? true
        notifications = try container.decodeIfPresent(Bool.self, forKey: .notifications) ?? true
        alerts = try container.decodeIfPresent(Bool.self, forKey: .alerts) ?? true
        shops = try container.decodeIfPresent(Bool.self, forKey: .shops) ?? true
        automations = try container.decodeIfPresent(Bool.self, forKey: .automations) ?? true
        shipments = try container.decodeIfPresent(Bool.self, forKey: .shipments) ?? true
        self.`public` = try container.decodeIfPresent(Bool.self, forKey: .publicFeature) ?? true
    }
}

struct HealthResponse: Decodable, Sendable {
    let status: String
    let env: String?
    let mode: String?
    let features: ServerFeatures

    private enum CodingKeys: String, CodingKey {
        case status, env, mode, features
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        status = try container.decode(String.self, forKey: .status)
        env = try container.decodeIfPresent(String.self, forKey: .env)
        mode = try container.decodeIfPresent(String.self, forKey: .mode)
        features = try container.decodeIfPresent(ServerFeatures.self, forKey: .features) ?? .allEnabled
    }
}

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

    var withoutPassword: LoginCredentials {
        LoginCredentials(username: username, password: "")
    }

    static let empty = LoginCredentials()
}
