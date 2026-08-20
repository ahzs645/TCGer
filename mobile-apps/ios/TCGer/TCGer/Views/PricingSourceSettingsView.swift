import SwiftUI

struct PricingSourceSettingsView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var configuration: APIService.PricingSourceConfiguration?
    @State private var availableOptions: [APIService.PriceSourceOption] = []
    @State private var isLoading = false
    @State private var isTesting = false
    @State private var testResult: APIService.TestSourceResult?
    @State private var errorMessage: String?
    @State private var personalAPIKey = ""
    @State private var showingRemoveKeyConfirmation = false
    @State private var collectrMappings: [CollectrProductMapping] = []
    @State private var collectrBaseURL = CollectrPrivateAPIConfiguration.defaultBaseURL
    @State private var collectrUsername = ""
    @State private var collectrCollectionID = ""
    @State private var collectrLocale = "en"
    @State private var collectrDeviceID = ""
    @State private var collectrSessionToken = ""
    @State private var collectrAuthorization = ""
    @State private var collectrKey = ""
    @State private var collectrTCG = TCGGame.pokemon.rawValue
    @State private var collectrExternalID = ""
    @State private var collectrProductID = ""
    @State private var isSavingCollectrConfiguration = false
    @State private var showingRemoveCollectrConfirmation = false
    @FocusState private var apiKeyFieldFocused: Bool

    private let api = APIService()

    private var isOnDevice: Bool {
        environmentStore.serverConfiguration.isOnDevice
    }

    private var selectedSource: PricingSource {
        environmentStore.pricingSource
    }

    private var selectedOption: APIService.PriceSourceOption? {
        availableOptions.first { $0.id == selectedSource }
    }

    private var gamesWithPricingOptions: [TCGGame] {
        environmentStore.enabledGames.filter { !compatibleOptions(for: $0).isEmpty }
    }

    var body: some View {
        Form {
            sourceSelectionSection
            if !gamesWithPricingOptions.isEmpty {
                gamePrioritySection
            }
            justTCGPreferencesSection
            providerSection
            switch selectedSource {
            case .justTCG:
                if isOnDevice {
                    onDeviceSetupSection
                } else {
                    serverSetupSection
                }
            case .collectrPrivateTest:
                collectrSessionSection
                collectrMappingSection
            default:
                EmptyView()
            }
            if selectedSource == .justTCG || selectedSource == .scryfall
                || (isOnDevice && selectedSource == .automatic)
                || selectedSource == .collectrPrivateTest {
                connectionSection
            }
        }
        .navigationTitle("Pricing Source")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadAvailableSources()
            await loadConfiguration()
        }
        .refreshable {
            await loadAvailableSources()
            await loadConfiguration()
        }
        .onChange(of: environmentStore.pricingSource) {
            configuration = nil
            testResult = nil
            errorMessage = nil
            Task { await loadConfiguration() }
        }
        .alert("Remove JustTCG API Key?", isPresented: $showingRemoveKeyConfirmation) {
            Button("Remove", role: .destructive) {
                removePersonalAPIKey()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Best Available will fall back to free Scryfall pricing after the key is removed.")
        }
        .alert("Remove Collectr Test Session?", isPresented: $showingRemoveCollectrConfirmation) {
            Button("Remove", role: .destructive) {
                removeCollectrConfiguration()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Live Collectr requests will stop. Product mappings will remain available.")
        }
    }

    private var sourceSelectionSection: some View {
        Section {
            Picker("Price Provider", selection: $environmentStore.pricingSource) {
                ForEach(availableOptions) { option in
                    Text(option.label)
                        .tag(option.id)
                }
            }
            .pickerStyle(.navigationLink)
            .accessibilityIdentifier("pricingSourcePicker")
        } header: {
            Text("Active Source")
        } footer: {
            Text("This is the default for games without a preferred source. Existing saved card values are not rewritten automatically.")
        }
    }

    private var gamePrioritySection: some View {
        Section {
            ForEach(gamesWithPricingOptions) { game in
                Picker(selection: preferredSourceBinding(for: game)) {
                    Text("Use Default (\(defaultSourceName(for: game)))")
                        .tag(Optional<PricingSource>.none)
                    ForEach(compatibleOptions(for: game)) { option in
                        Text(option.label)
                            .tag(Optional(option.id))
                    }
                } label: {
                    GameLabel(game: game)
                }
                .pickerStyle(.navigationLink)
                .accessibilityIdentifier("pricingSourcePriority.\(game.rawValue)")
            }
        } header: {
            Text("Game Priorities")
        } footer: {
            Text("A preferred source overrides the default only for that game. Best Available uses the server's compatible provider order.")
        }
    }

    private func compatibleOptions(for game: TCGGame) -> [APIService.PriceSourceOption] {
        availableOptions.filter { option in
            option.games.isEmpty
                || option.games.contains { $0.caseInsensitiveCompare(game.rawValue) == .orderedSame }
        }
    }

    private func preferredSourceBinding(for game: TCGGame) -> Binding<PricingSource?> {
        Binding(
            get: { environmentStore.preferredPricingSource(for: game) },
            set: { environmentStore.setPreferredPricingSource($0, for: game) }
        )
    }

    private func defaultSourceName(for game: TCGGame) -> String {
        selectedSource.supports(tcg: game.rawValue)
            ? selectedSource.displayName
            : PricingSource.automatic.displayName
    }

    private var justTCGPreferencesSection: some View {
        Section {
            Picker("Condition", selection: $environmentStore.justTCGConditionPreference) {
                Text("Match Each Card").tag(JustTCGPricingPreferences.matchCardValue)
                ForEach(JustTCGPricingPreferences.conditions, id: \.self) { condition in
                    Text(condition).tag(condition)
                }
            }
            .pickerStyle(.navigationLink)
            .accessibilityIdentifier("justTCGConditionPreference")

            Picker("Language", selection: $environmentStore.justTCGLanguagePreference) {
                Text("Match Each Card").tag(JustTCGPricingPreferences.matchCardValue)
                ForEach(JustTCGPricingPreferences.languages, id: \.self) { language in
                    Text(language).tag(language)
                }
            }
            .pickerStyle(.navigationLink)
            .accessibilityIdentifier("justTCGLanguagePreference")
        } header: {
            Text("JustTCG Variant Preference")
        } footer: {
            Text("Match Each Card uses the condition and language saved on each copy, falling back to Near Mint and English. JustTCG returns language on variants; TCGer explicitly ranks that field when choosing a quote.")
        }
    }

    private var providerSection: some View {
        Section {
            HStack(spacing: 12) {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .foregroundStyle(.green)
                    .font(.title2)

                VStack(alignment: .leading, spacing: 3) {
                    Text(configuration?.label ?? selectedSource.displayName)
                        .font(.headline)
                    Text(selectedOption?.description ?? "Configured market pricing source")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                if isLoading {
                    ProgressView()
                } else {
                    Label(
                        configuration?.configured == true ? "Configured" : "Needs setup",
                        systemImage: configuration?.configured == true
                            ? "checkmark.circle.fill"
                            : "exclamationmark.triangle.fill"
                    )
                    .font(.caption.bold())
                    .foregroundStyle(configuration?.configured == true ? .green : .orange)
                    .labelStyle(.titleAndIcon)
                    .accessibilityIdentifier("pricingSourceConfigurationStatus")
                }
            }

            if let url = configuration?.url {
                LabeledContent("API") {
                    Text(url)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.trailing)
                }
            }

            if selectedSource == .justTCG {
                Text("Use JustTCG pricing for supported games with condition, language, and printing-aware variant selection. Stable JustTCG or TCGplayer identifiers are saved locally after a card is matched.")
                    .font(.subheadline)

                Link(destination: URL(string: "https://justtcg.com/docs/quickstart")!) {
                    Label("Open JustTCG API Guide", systemImage: "safari")
                }

                Link(destination: URL(string: "https://justtcg.com/docs/api/cards")!) {
                    Label("Card and Price History API", systemImage: "clock.arrow.circlepath")
                }

                Link(destination: URL(string: "https://www.justtcg.com/docs/changelog")!) {
                    Label("Review Commercial-Use Terms", systemImage: "doc.text")
                }

                Link(destination: URL(string: "https://justtcg.com")!) {
                    Label("Create or Manage API Key", systemImage: "key")
                }
            } else if selectedSource == .scryfall {
                Text("Scryfall provides free Magic market references for regular, traditional foil, and etched printings. TCGer caches results for 12 hours and keeps requests below Scryfall's published API limit.")
                    .font(.subheadline)

                Link(destination: URL(string: "https://scryfall.com/docs/api")!) {
                    Label("Open Scryfall API Documentation", systemImage: "safari")
                }
            } else if selectedSource == .automatic {
                Text(isOnDevice
                    ? "Best Available uses your personal JustTCG key when one is saved, then falls back to Scryfall without requiring setup."
                    : "Best Available asks the server for the first compatible configured quote.")
                    .font(.subheadline)
            } else if selectedSource == .collectrPrivateTest {
                Label {
                    Text("Private-build experiment. It makes live requests using session headers you capture from your own Collectr account. TCGer does not derive or embed X-COLLECTR-KEY.")
                        .font(.subheadline)
                } icon: {
                    Image(systemName: "doc.badge.ellipsis")
                        .foregroundStyle(.orange)
                }
            }
        } header: {
            Text("Provider")
        } footer: {
            if selectedSource == .justTCG {
                Text(isOnDevice
                    ? "Phone-only mode uses a personal paid JustTCG key from this iPhone. It never becomes part of your collection export or iCloud preferences."
                    : "TCGer uses the paid JustTCG plan for commercial pricing. The API key stays on your server and is never downloaded to this iPhone.")
            } else if selectedSource == .scryfall {
                Text(isOnDevice
                    ? "No API key is required. Requests identify TCGer and use the app's shared 12-hour on-device quote cache."
                    : "Scryfall access is configured and rate-limited by the TCGer server.")
            } else if selectedSource == .collectrPrivateTest {
                Text("Session values are stored in this iPhone's non-synchronizing Keychain. Only cards with an explicit Collectr product-ID mapping make requests.")
            } else if let selectedOption {
                Text(selectedOption.games.isEmpty
                    ? "This server can use the source for every compatible card."
                    : "Available for: \(selectedOption.games.map(\.capitalized).joined(separator: ", ")).")
            }
        }
    }

    private var onDeviceSetupSection: some View {
        Section {
            Label {
                Text("A server relay remains the safest option. Direct phone access is an advanced fallback for a personal key; do not enter TCGer's shared production key here.")
                    .font(.subheadline)
            } icon: {
                Image(systemName: "exclamationmark.shield.fill")
                    .foregroundStyle(.orange)
            }

            SecureField(
                configuration?.configured == true ? "Enter replacement API key" : "Personal JustTCG API key",
                text: $personalAPIKey
            )
            .textContentType(.password)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .focused($apiKeyFieldFocused)
            .accessibilityIdentifier("personalJustTCGAPIKey")

            Button {
                savePersonalAPIKey()
            } label: {
                Label(
                    configuration?.configured == true ? "Replace API Key" : "Save API Key",
                    systemImage: "key.fill"
                )
            }
            .disabled(personalAPIKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if configuration?.configured == true {
                Label("A personal key is stored in this iPhone's Keychain", systemImage: "checkmark.shield.fill")
                    .font(.caption)
                    .foregroundStyle(.green)

                Button("Remove API Key", role: .destructive) {
                    showingRemoveKeyConfirmation = true
                }
            }
        } header: {
            Text("Phone-Only Setup")
        } footer: {
            Text("The key is stored as a non-synchronizing, device-only Keychain item and is available only while the iPhone is unlocked. A compromised device can still expose client-held credentials, so use a separate personal key that you can revoke.")
        }
    }

    private var serverSetupSection: some View {
        Section {
            setupStep(number: 1, text: "Create a paid JustTCG API key.")
            setupStep(number: 2, text: "Set JUSTTCG_API_KEY in the backend or Convex environment.")
            setupStep(number: 3, text: "Restart or redeploy the server, then return here and test the connection.")

            VStack(alignment: .leading, spacing: 6) {
                Text("Convex")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                Text("npx convex env set JUSTTCG_API_KEY \"your-key\"")
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
            }
            .padding(.vertical, 2)

            VStack(alignment: .leading, spacing: 6) {
                Text("Docker / server")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                Text("JUSTTCG_API_KEY=your-key")
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
            }
            .padding(.vertical, 2)
        } header: {
            Text("Server Setup")
        } footer: {
            Text("Do not paste a shared production key into the app or bundle it in the iOS project. Server-side setup lets TCGer rotate the key and change providers without an App Store release.")
        }
    }

    private var collectrSessionSection: some View {
        Section {
            TextField("API base URL", text: $collectrBaseURL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .accessibilityIdentifier("collectrBaseURL")

            TextField("Collectr username", text: $collectrUsername)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("collectrUsername")

            TextField("Collection ID (optional)", text: $collectrCollectionID)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            TextField("Locale", text: $collectrLocale)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            TextField("X-Device-ID", text: $collectrDeviceID)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            SecureField("X-Session-Token", text: $collectrSessionToken)
                .textContentType(.password)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            SecureField("Authorization header", text: $collectrAuthorization)
                .textContentType(.password)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            SecureField("X-COLLECTR-KEY", text: $collectrKey)
                .textContentType(.password)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("collectrPrivateKey")

            Button {
                saveCollectrConfiguration()
            } label: {
                HStack {
                    Label("Save Private Test Session", systemImage: "key.fill")
                    Spacer()
                    if isSavingCollectrConfiguration { ProgressView() }
                }
            }
            .disabled(
                isSavingCollectrConfiguration
                    || collectrBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || collectrUsername.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || [collectrDeviceID, collectrSessionToken, collectrAuthorization, collectrKey]
                        .allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            )
            .accessibilityIdentifier("saveCollectrPrivateSession")

            if configuration?.configured == true || !collectrSessionToken.isEmpty || !collectrKey.isEmpty {
                Button("Remove Private Test Session", role: .destructive) {
                    showingRemoveCollectrConfirmation = true
                }
            }
        } header: {
            Text("Private Session")
        } footer: {
            Text("Copy the current values from a request made by your own Collectr session. Authorization must include its scheme, such as Bearer. Session data stays in the device-only Keychain and is never exported.")
        }
    }

    private var collectrMappingSection: some View {
        Section {
            Picker("Game", selection: $collectrTCG) {
                ForEach(TCGGame.allCases.filter { $0 != .all }) { game in
                    Text(game.displayName).tag(game.rawValue)
                }
            }

            TextField("TCGer external card ID", text: $collectrExternalID)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("collectrExternalCardID")

            TextField("Collectr product ID", text: $collectrProductID)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("collectrProductID")

            Button {
                saveCollectrMapping()
            } label: {
                Label("Save Product Mapping", systemImage: "link.badge.plus")
            }
            .disabled(
                collectrExternalID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || collectrProductID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            )
            .accessibilityIdentifier("saveCollectrProductMapping")

            if !collectrMappings.isEmpty {
                ForEach(collectrMappings) { mapping in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(mapping.externalID)
                            Text("\(mapping.tcg.capitalized) → \(mapping.collectrProductID)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button(role: .destructive) {
                            removeCollectrMapping(mapping)
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Remove \(mapping.externalID)")
                    }
                }
            }
        } header: {
            Text("Product Mappings")
        } footer: {
            Text("Collectr's product-detail route uses its own product ID. Mapping prevents blind catalog requests and limits live calls to cards you explicitly select. Prices are cached for 15 minutes.")
        }
    }

    private var connectionSection: some View {
        Section {
            Button {
                Task { await testConnection() }
            } label: {
                HStack {
                    Label(
                        connectionTestLabel,
                        systemImage: selectedSource == .collectrPrivateTest ? "checkmark.circle" : "network"
                    )
                    Spacer()
                    if isTesting {
                        ProgressView()
                    }
                }
            }
            .disabled(isTesting || isLoading)
            .accessibilityIdentifier("testPricingSource")

            if let result = testResult {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(result.ok ? "Connection successful" : "Connection failed")
                        if result.ok {
                            Text("\(connectionResponseLabel) response: \(result.latencyMs) ms")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else if let error = result.error {
                            Text(error)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                } icon: {
                    Image(systemName: result.ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(result.ok ? .green : .red)
                }
            }

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        } header: {
            Text("Connection")
        }
    }

    private func setupStep(number: Int, text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(number)")
                .font(.caption.bold())
                .foregroundStyle(.white)
                .frame(width: 22, height: 22)
                .background(Color.accentColor, in: Circle())
            Text(text)
                .font(.subheadline)
        }
    }

    private var connectionTestLabel: String {
        switch selectedSource {
        case .scryfall: return "Test Scryfall Connection"
        case .automatic: return "Test Best Available Source"
        case .justTCG: return "Test JustTCG Connection"
        case .collectrPrivateTest: return "Test Live Collectr Price"
        default: return "Test Server Connection"
        }
    }

    private var connectionResponseLabel: String {
        if selectedSource == .collectrPrivateTest { return "Collectr" }
        if selectedSource == .scryfall { return "Scryfall" }
        if isOnDevice && selectedSource == .automatic { return "Best available" }
        return isOnDevice ? "JustTCG" : "Server"
    }

    private func loadConfiguration() async {
        if selectedSource == .collectrPrivateTest {
            isLoading = true
            errorMessage = nil
            defer { isLoading = false }

            do {
                configuration = try await api.getPricingSourceConfiguration(
                    config: environmentStore.serverConfiguration,
                    token: nil,
                    source: selectedSource
                )
                collectrMappings = api.collectrProductMappings()
                if let saved = try api.collectrPrivateConfiguration() {
                    collectrBaseURL = saved.baseURL
                    collectrUsername = saved.username
                    collectrCollectionID = saved.collectionID
                    collectrLocale = saved.locale
                    collectrDeviceID = saved.deviceID
                    collectrSessionToken = saved.sessionToken
                    collectrAuthorization = saved.authorization
                    collectrKey = saved.collectrKey
                }
            } catch is CancellationError {
                return
            } catch {
                errorMessage = error.localizedDescription
            }
            return
        }

        let token: String?
        if isOnDevice {
            token = nil
        } else {
            guard environmentStore.isCurrentUserAdmin,
                  let serverToken = environmentStore.authToken else {
                errorMessage = "Administrator access is required."
                return
            }
            token = serverToken
        }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            configuration = try await api.getPricingSourceConfiguration(
                config: environmentStore.serverConfiguration,
                token: token,
                source: selectedSource
            )
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func loadAvailableSources() async {
        let token = isOnDevice ? nil : environmentStore.authToken
        do {
            let catalog = try await api.getAvailablePriceSources(
                config: environmentStore.serverConfiguration,
                token: token
            )
            availableOptions = catalog.sources
            if !catalog.sources.contains(where: { $0.id == selectedSource }) {
                environmentStore.pricingSource = catalog.defaultSource
            }
        } catch is CancellationError {
            return
        } catch {
            availableOptions = isOnDevice
                ? [
                    APIService.PriceSourceOption(
                        id: .automatic,
                        label: "Best Available",
                        description: "Use JustTCG when configured, then fall back to Scryfall.",
                        games: TCGGame.allCases.filter { $0 != .all }.map(\.rawValue),
                        requiresServer: false
                    ),
                    APIService.PriceSourceOption(
                        id: .scryfall,
                        label: "Scryfall",
                        description: "Free finish-aware Magic pricing with no API key.",
                        games: ["magic"],
                        requiresServer: false
                    ),
                    APIService.PriceSourceOption(
                        id: .justTCG,
                        label: "JustTCG (Personal Key)",
                        description: "Direct pricing using a personal key stored only on this iPhone.",
                        games: TCGGame.allCases.filter { $0 != .all }.map(\.rawValue),
                        requiresServer: false
                    )
                ]
                : []
            errorMessage = error.localizedDescription
        }
    }

    private func testConnection() async {
        if selectedSource == .collectrPrivateTest {
            isTesting = true
            testResult = nil
            errorMessage = nil
            defer { isTesting = false }

            do {
                testResult = try await api.testPricingSource(
                    config: environmentStore.serverConfiguration,
                    token: nil,
                    source: selectedSource
                )
                await loadConfiguration()
            } catch is CancellationError {
                return
            } catch {
                errorMessage = error.localizedDescription
            }
            return
        }

        let token: String?
        if isOnDevice {
            token = nil
        } else {
            guard let serverToken = environmentStore.authToken else {
                errorMessage = "Administrator access is required."
                return
            }
            token = serverToken
        }

        isTesting = true
        testResult = nil
        errorMessage = nil
        defer { isTesting = false }

        do {
            testResult = try await api.testPricingSource(
                config: environmentStore.serverConfiguration,
                token: token,
                source: selectedSource
            )
            await loadConfiguration()
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func savePersonalAPIKey() {
        do {
            try api.saveOnDevicePricingAPIKey(personalAPIKey)
            personalAPIKey = ""
            apiKeyFieldFocused = false
            testResult = nil
            errorMessage = nil
            HapticManager.notification(.success)
            Task { await loadConfiguration() }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func removePersonalAPIKey() {
        do {
            try api.removeOnDevicePricingAPIKey()
            personalAPIKey = ""
            testResult = nil
            errorMessage = nil
            HapticManager.notification(.success)
            Task { await loadConfiguration() }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveCollectrConfiguration() {
        isSavingCollectrConfiguration = true
        errorMessage = nil
        testResult = nil
        defer { isSavingCollectrConfiguration = false }

        do {
            try api.saveCollectrPrivateConfiguration(
                CollectrPrivateAPIConfiguration(
                    baseURL: collectrBaseURL.trimmingCharacters(in: .whitespacesAndNewlines),
                    username: collectrUsername.trimmingCharacters(in: .whitespacesAndNewlines),
                    collectionID: collectrCollectionID.trimmingCharacters(in: .whitespacesAndNewlines),
                    locale: collectrLocale.trimmingCharacters(in: .whitespacesAndNewlines),
                    deviceID: collectrDeviceID.trimmingCharacters(in: .whitespacesAndNewlines),
                    sessionToken: collectrSessionToken.trimmingCharacters(in: .whitespacesAndNewlines),
                    authorization: collectrAuthorization.trimmingCharacters(in: .whitespacesAndNewlines),
                    collectrKey: collectrKey.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            )
            HapticManager.notification(.success)
            Task {
                await api.clearCollectrPrivatePriceCache()
                await loadConfiguration()
            }
        } catch {
            errorMessage = error.localizedDescription
            HapticManager.notification(.error)
        }
    }

    private func removeCollectrConfiguration() {
        do {
            try api.removeCollectrPrivateConfiguration()
            collectrDeviceID = ""
            collectrSessionToken = ""
            collectrAuthorization = ""
            collectrKey = ""
            testResult = nil
            errorMessage = nil
            Task {
                await api.clearCollectrPrivatePriceCache()
                await loadConfiguration()
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveCollectrMapping() {
        do {
            try api.saveCollectrProductMapping(
                tcg: collectrTCG,
                externalID: collectrExternalID,
                collectrProductID: collectrProductID
            )
            collectrExternalID = ""
            collectrProductID = ""
            collectrMappings = api.collectrProductMappings()
            testResult = nil
            errorMessage = nil
            HapticManager.notification(.success)
            Task {
                await api.clearCollectrPrivatePriceCache()
                await loadConfiguration()
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func removeCollectrMapping(_ mapping: CollectrProductMapping) {
        do {
            try api.removeCollectrProductMapping(id: mapping.id)
            collectrMappings = api.collectrProductMappings()
            testResult = nil
            errorMessage = nil
            Task {
                await api.clearCollectrPrivatePriceCache()
                await loadConfiguration()
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
