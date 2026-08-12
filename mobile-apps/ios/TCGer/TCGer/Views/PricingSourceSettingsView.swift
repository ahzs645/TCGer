import SwiftUI

struct PricingSourceSettingsView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var configuration: APIService.PricingSourceConfiguration?
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

    var body: some View {
        Form {
            sourceSelectionSection
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
            }
            connectionSection
        }
        .navigationTitle("Pricing Source")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadConfiguration()
        }
        .refreshable {
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
            Text("Phone-only pricing will stop until another personal key is saved.")
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
                ForEach(PricingSource.allCases) { source in
                    VStack(alignment: .leading) {
                        Text(source.displayName)
                        Text(source.shortDescription)
                    }
                    .tag(source)
                }
            }
            .pickerStyle(.navigationLink)
            .accessibilityIdentifier("pricingSourcePicker")
        } header: {
            Text("Active Source")
        } footer: {
            Text("The selected source is saved on this device and is used when card results are loaded. Existing saved card values are not rewritten automatically.")
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
                    Text(selectedSource == .justTCG
                        ? "Pokémon, Magic, Yu-Gi-Oh!, and more"
                        : "Live prices from explicitly mapped Collectr products")
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
                Text("Use JustTCG paid as the primary commercial provider. It covers Pokémon, Magic, Yu-Gi-Oh!, and other games, with condition and printing variants plus price history. Its paid commercial terms allow TCGer to display, cache, derive valuations, and combine prices with other lawful sources.")
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
            } else {
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
            } else {
                Text("Session values are stored in this iPhone's non-synchronizing Keychain. Only cards with an explicit Collectr product-ID mapping make requests.")
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
                        selectedSource == .justTCG
                            ? "Test JustTCG Connection"
                            : "Test Live Collectr Price",
                        systemImage: selectedSource == .justTCG ? "network" : "checkmark.circle"
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
                            Text("\(selectedSource == .collectrPrivateTest ? "Collectr" : (isOnDevice ? "JustTCG" : "Server")) response: \(result.latencyMs) ms")
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
