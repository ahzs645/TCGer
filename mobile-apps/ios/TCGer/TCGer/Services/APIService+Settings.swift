import Foundation

extension APIService {
    struct PricingSourceConfiguration: Codable, Sendable {
        let url: String
        let label: String
        let configured: Bool
    }

    struct TestSourceResult: Codable, Sendable {
        let ok: Bool
        let latencyMs: Int
        let error: String?
    }

    private struct TestSourceRequest: Codable, Sendable {
        let source: String
    }

    private struct SourceDefaultsResponse: Codable, Sendable {
        let justtcg: PricingSourceConfiguration
    }

    func getPricingSourceConfiguration(
        config: ServerConfiguration,
        token: String?,
        source: PricingSource
    ) async throws -> PricingSourceConfiguration {
        if source == .collectrPrivateTest {
            let collectrConfiguration = try CollectrPrivateCredentialStore.load()
            let mappingCount = CollectrProductMappingStore().mappings.count
            return PricingSourceConfiguration(
                url: collectrConfiguration?.baseURL ?? CollectrPrivateAPIConfiguration.defaultBaseURL,
                label: "Collectr Private Test",
                configured: collectrConfiguration != nil && mappingCount > 0
            )
        }

        if config.isOnDevice {
            return PricingSourceConfiguration(
                url: "https://api.justtcg.com/v1",
                label: "JustTCG (Personal Key)",
                configured: try JustTCGCredentialStore.loadAPIKey() != nil
            )
        }

        let (data, response) = try await makeRequest(
            config: config,
            path: "settings/source-defaults",
            token: token
        )

        guard response.statusCode == 200 else {
            let serverMessage = parseServerMessage(from: data)
            throw APIError.serverError(status: response.statusCode, message: serverMessage)
        }

        guard let sources = try? JSONDecoder().decode(SourceDefaultsResponse.self, from: data) else {
            throw APIError.decodingError
        }

        return sources.justtcg
    }

    func testPricingSource(
        config: ServerConfiguration,
        token: String?,
        source: PricingSource
    ) async throws -> TestSourceResult {
        if source == .collectrPrivateTest {
            return try await testCollectrPrivateConnection()
        }

        if config.isOnDevice {
            return try await testOnDeviceJustTCGConnection()
        }

        let (data, response) = try await makeRequest(
            config: config,
            path: "settings/test-source",
            method: "POST",
            token: token,
            body: TestSourceRequest(source: source.rawValue)
        )

        guard response.statusCode == 200 else {
            let serverMessage = parseServerMessage(from: data)
            throw APIError.serverError(status: response.statusCode, message: serverMessage)
        }

        guard let result = try? JSONDecoder().decode(TestSourceResult.self, from: data) else {
            throw APIError.decodingError
        }

        return result
    }

    func saveOnDevicePricingAPIKey(_ apiKey: String) throws {
        try JustTCGCredentialStore.save(apiKey: apiKey)
    }

    func removeOnDevicePricingAPIKey() throws {
        try JustTCGCredentialStore.deleteAPIKey()
    }

    func collectrPrivateConfiguration() throws -> CollectrPrivateAPIConfiguration? {
        try CollectrPrivateCredentialStore.load()
    }

    func saveCollectrPrivateConfiguration(_ configuration: CollectrPrivateAPIConfiguration) throws {
        try CollectrPrivateCredentialStore.save(configuration)
    }

    func removeCollectrPrivateConfiguration() throws {
        try CollectrPrivateCredentialStore.delete()
    }

    func collectrProductMappings() -> [CollectrProductMapping] {
        CollectrProductMappingStore().mappings
    }

    func saveCollectrProductMapping(
        tcg: String,
        externalID: String,
        collectrProductID: String
    ) throws {
        try CollectrProductMappingStore().save(
            tcg: tcg,
            externalID: externalID,
            collectrProductID: collectrProductID
        )
    }

    func removeCollectrProductMapping(id: String) throws {
        try CollectrProductMappingStore().remove(id: id)
    }

    private func testCollectrPrivateConnection() async throws -> TestSourceResult {
        guard let collectrConfiguration = try CollectrPrivateCredentialStore.load() else {
            return TestSourceResult(
                ok: false,
                latencyMs: 0,
                error: "No Collectr private test session is saved on this iPhone."
            )
        }
        guard let mapping = CollectrProductMappingStore().mappings.first else {
            return TestSourceResult(
                ok: false,
                latencyMs: 0,
                error: "Add at least one TCGer-to-Collectr product mapping."
            )
        }

        let startedAt = ContinuousClock.now
        let quote = try await CollectrTestPriceProvider(
            configuration: collectrConfiguration,
            mappings: [mapping]
        ).fetchPrice(
            tcg: mapping.tcg,
            externalID: mapping.externalID
        )
        let elapsed = startedAt.duration(to: .now)
        let latencyMs = Int(elapsed.components.seconds * 1_000)
            + Int(elapsed.components.attoseconds / 1_000_000_000_000_000)
        return TestSourceResult(
            ok: quote != nil,
            latencyMs: latencyMs,
            error: quote == nil ? "The live response does not contain a valid market_price." : nil
        )
    }

    private func testOnDeviceJustTCGConnection() async throws -> TestSourceResult {
        guard let apiKey = try JustTCGCredentialStore.loadAPIKey() else {
            return TestSourceResult(
                ok: false,
                latencyMs: 0,
                error: "No personal JustTCG API key is stored on this iPhone."
            )
        }
        guard let url = URL(string: "https://api.justtcg.com/v1/games") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")

        let startedAt = ContinuousClock.now
        let (data, response) = try await execute(request)
        let elapsed = startedAt.duration(to: .now)
        let latencyMs = Int(elapsed.components.seconds * 1_000)
            + Int(elapsed.components.attoseconds / 1_000_000_000_000_000)

        return TestSourceResult(
            ok: response.statusCode >= 200 && response.statusCode < 300,
            latencyMs: latencyMs,
            error: response.statusCode >= 200 && response.statusCode < 300
                ? nil
                : (parseServerMessage(from: data) ?? "JustTCG returned HTTP \(response.statusCode).")
        )
    }

    func getSettings(config: ServerConfiguration) async throws -> AppSettings {
        if config.isOnDevice {
            return LocalStore.shared.getSettings()
        }

        let (data, response) = try await makeRequest(config: config, path: "settings")

        guard response.statusCode == 200 else {
            throw APIError.serverError(status: response.statusCode)
        }

        guard let settings = try? JSONDecoder().decode(AppSettings.self, from: data) else {
            throw APIError.decodingError
        }

        return settings
    }

    struct UpdateSettingsRequest: Codable, Sendable {
        let publicDashboard: Bool?
        let publicCollections: Bool?
        let requireAuth: Bool?
        let appName: String?
    }

    func updateSettings(
        config: ServerConfiguration,
        token: String,
        publicDashboard: Bool? = nil,
        publicCollections: Bool? = nil,
        requireAuth: Bool? = nil,
        appName: String? = nil
    ) async throws -> AppSettings {
        if config.isOnDevice {
            return LocalStore.shared.updateSettings(
                publicDashboard: publicDashboard,
                publicCollections: publicCollections,
                requireAuth: requireAuth,
                appName: appName
            )
        }

        let body = UpdateSettingsRequest(
            publicDashboard: publicDashboard,
            publicCollections: publicCollections,
            requireAuth: requireAuth,
            appName: appName
        )

        let (data, response) = try await makeRequest(
            config: config,
            path: "settings",
            method: "PATCH",
            token: token,
            body: body
        )

        guard response.statusCode == 200 else {
            let serverMessage = parseServerMessage(from: data)
            throw APIError.serverError(status: response.statusCode, message: serverMessage)
        }

        guard let settings = try? JSONDecoder().decode(AppSettings.self, from: data) else {
            throw APIError.decodingError
        }

        return settings
    }

    struct UserPreferences: Codable, Sendable {
        let showCardNumbers: Bool
        let showPricing: Bool
        let enabledYugioh: Bool
        let enabledMagic: Bool
        let enabledPokemon: Bool
        let enabledOnepiece: Bool
        let enabledLorcana: Bool
        let enabledDragonball: Bool
        let defaultGame: String?
        let focusedSetOrder: [String]
        let setCompletionMode: String

        private enum CodingKeys: String, CodingKey {
            case showCardNumbers
            case showPricing
            case enabledYugioh
            case enabledMagic
            case enabledPokemon
            case enabledOnepiece
            case enabledLorcana
            case enabledDragonball
            case defaultGame
            case focusedSetOrder
            case setCompletionMode
        }

        init(
            showCardNumbers: Bool,
            showPricing: Bool,
            enabledYugioh: Bool,
            enabledMagic: Bool,
            enabledPokemon: Bool,
            enabledOnepiece: Bool,
            enabledLorcana: Bool,
            enabledDragonball: Bool,
            defaultGame: String?,
            focusedSetOrder: [String] = [],
            setCompletionMode: String = SetCompletionMode.standard.rawValue
        ) {
            self.showCardNumbers = showCardNumbers
            self.showPricing = showPricing
            self.enabledYugioh = enabledYugioh
            self.enabledMagic = enabledMagic
            self.enabledPokemon = enabledPokemon
            self.enabledOnepiece = enabledOnepiece
            self.enabledLorcana = enabledLorcana
            self.enabledDragonball = enabledDragonball
            self.defaultGame = defaultGame
            self.focusedSetOrder = FocusedSetOrder.normalized(focusedSetOrder)
            self.setCompletionMode = SetCompletionMode(rawValue: setCompletionMode)?.rawValue
                ?? SetCompletionMode.standard.rawValue
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            showCardNumbers = try container.decode(Bool.self, forKey: .showCardNumbers)
            showPricing = try container.decode(Bool.self, forKey: .showPricing)
            enabledYugioh = try container.decode(Bool.self, forKey: .enabledYugioh)
            enabledMagic = try container.decode(Bool.self, forKey: .enabledMagic)
            enabledPokemon = try container.decode(Bool.self, forKey: .enabledPokemon)
            enabledOnepiece = try container.decodeIfPresent(Bool.self, forKey: .enabledOnepiece) ?? false
            enabledLorcana = try container.decodeIfPresent(Bool.self, forKey: .enabledLorcana) ?? false
            enabledDragonball = try container.decodeIfPresent(Bool.self, forKey: .enabledDragonball) ?? false
            defaultGame = try container.decodeIfPresent(String.self, forKey: .defaultGame)
            focusedSetOrder = FocusedSetOrder.normalized(
                try container.decodeIfPresent([String].self, forKey: .focusedSetOrder) ?? []
            )
            setCompletionMode = try container.decodeIfPresent(String.self, forKey: .setCompletionMode)
                ?? SetCompletionMode.standard.rawValue
        }
    }

    func getUserPreferences(
        config: ServerConfiguration,
        token: String
    ) async throws -> UserPreferences {
        if config.isOnDevice {
            return LocalStore.shared.getUserPreferences()
        }

        let (data, response) = try await makeRequest(
            config: config,
            path: "users/me/preferences",
            token: token
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }

        guard let preferences = try? JSONDecoder().decode(UserPreferences.self, from: data) else {
            throw APIError.decodingError
        }

        return preferences
    }

    struct UpdatePreferencesRequest: Encodable, Sendable {
        let showCardNumbers: Bool?
        let showPricing: Bool?
        let enabledYugioh: Bool?
        let enabledMagic: Bool?
        let enabledPokemon: Bool?
        let enabledOnepiece: Bool?
        let enabledLorcana: Bool?
        let enabledDragonball: Bool?
        let defaultGame: String??
        let focusedSetOrder: [String]?
        let setCompletionMode: String?

        private enum CodingKeys: String, CodingKey {
            case showCardNumbers
            case showPricing
            case enabledYugioh
            case enabledMagic
            case enabledPokemon
            case enabledOnepiece
            case enabledLorcana
            case enabledDragonball
            case defaultGame
            case focusedSetOrder
            case setCompletionMode
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encodeIfPresent(showCardNumbers, forKey: .showCardNumbers)
            try container.encodeIfPresent(showPricing, forKey: .showPricing)
            try container.encodeIfPresent(enabledYugioh, forKey: .enabledYugioh)
            try container.encodeIfPresent(enabledMagic, forKey: .enabledMagic)
            try container.encodeIfPresent(enabledPokemon, forKey: .enabledPokemon)
            try container.encodeIfPresent(enabledOnepiece, forKey: .enabledOnepiece)
            try container.encodeIfPresent(enabledLorcana, forKey: .enabledLorcana)
            try container.encodeIfPresent(enabledDragonball, forKey: .enabledDragonball)
            switch defaultGame {
            case .none:
                break
            case .some(.none):
                try container.encodeNil(forKey: .defaultGame)
            case .some(.some(let value)):
                try container.encode(value, forKey: .defaultGame)
            }
            try container.encodeIfPresent(focusedSetOrder, forKey: .focusedSetOrder)
            try container.encodeIfPresent(setCompletionMode, forKey: .setCompletionMode)
        }
    }

    func updateUserPreferences(
        config: ServerConfiguration,
        token: String,
        showCardNumbers: Bool? = nil,
        showPricing: Bool? = nil,
        enabledYugioh: Bool? = nil,
        enabledMagic: Bool? = nil,
        enabledPokemon: Bool? = nil,
        enabledOnepiece: Bool? = nil,
        enabledLorcana: Bool? = nil,
        enabledDragonball: Bool? = nil,
        defaultGame: String?? = nil,
        focusedSetOrder: [String]? = nil,
        setCompletionMode: String? = nil
    ) async throws -> UserPreferences {
        if config.isOnDevice {
            return LocalStore.shared.updateUserPreferences(
                showCardNumbers: showCardNumbers,
                showPricing: showPricing,
                enabledYugioh: enabledYugioh,
                enabledMagic: enabledMagic,
                enabledPokemon: enabledPokemon,
                enabledOnepiece: enabledOnepiece,
                enabledLorcana: enabledLorcana,
                enabledDragonball: enabledDragonball,
                defaultGame: defaultGame,
                focusedSetOrder: focusedSetOrder,
                setCompletionMode: setCompletionMode
            )
        }

        let body = UpdatePreferencesRequest(
            showCardNumbers: showCardNumbers,
            showPricing: showPricing,
            enabledYugioh: enabledYugioh,
            enabledMagic: enabledMagic,
            enabledPokemon: enabledPokemon,
            enabledOnepiece: enabledOnepiece,
            enabledLorcana: enabledLorcana,
            enabledDragonball: enabledDragonball,
            defaultGame: defaultGame,
            focusedSetOrder: focusedSetOrder,
            setCompletionMode: setCompletionMode
        )

        let (data, response) = try await makeRequest(
            config: config,
            path: "users/me/preferences",
            method: "PATCH",
            token: token,
            body: body
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }

        guard let preferences = try? JSONDecoder().decode(UserPreferences.self, from: data) else {
            throw APIError.decodingError
        }

        return preferences
    }
}
