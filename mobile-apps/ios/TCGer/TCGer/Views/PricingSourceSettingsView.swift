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
    @FocusState private var apiKeyFieldFocused: Bool

    private let api = APIService()

    private var isOnDevice: Bool {
        environmentStore.serverConfiguration.isOnDevice
    }

    var body: some View {
        Form {
            providerSection
            if isOnDevice {
                onDeviceSetupSection
            } else {
                serverSetupSection
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
        .alert("Remove JustTCG API Key?", isPresented: $showingRemoveKeyConfirmation) {
            Button("Remove", role: .destructive) {
                removePersonalAPIKey()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Phone-only pricing will stop until another personal key is saved.")
        }
    }

    private var providerSection: some View {
        Section {
            HStack(spacing: 12) {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .foregroundStyle(.green)
                    .font(.title2)

                VStack(alignment: .leading, spacing: 3) {
                    Text(configuration?.label ?? "JustTCG (Primary Pricing)")
                        .font(.headline)
                    Text("Pokémon, Magic, Yu-Gi-Oh!, and more")
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
                    .accessibilityIdentifier("justTCGConfigurationStatus")
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
        } header: {
            Text("Primary Commercial Provider")
        } footer: {
            Text(isOnDevice
                ? "Phone-only mode uses a personal paid JustTCG key from this iPhone. It never becomes part of your collection export or iCloud preferences."
                : "TCGer uses the paid JustTCG plan for commercial pricing. The API key stays on your server and is never downloaded to this iPhone.")
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

    private var connectionSection: some View {
        Section {
            Button {
                Task { await testConnection() }
            } label: {
                HStack {
                    Label("Test JustTCG Connection", systemImage: "network")
                    Spacer()
                    if isTesting {
                        ProgressView()
                    }
                }
            }
            .disabled(isTesting || isLoading)
            .accessibilityIdentifier("testJustTCGConnection")

            if let result = testResult {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(result.ok ? "Connection successful" : "Connection failed")
                        if result.ok {
                            Text("\(isOnDevice ? "JustTCG" : "Server") response: \(result.latencyMs) ms")
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
                token: token
            )
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func testConnection() async {
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
                token: token
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
}
