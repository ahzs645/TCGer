import SwiftUI

struct ServerSetupView: View {
    private enum ConnectionMode: String, CaseIterable, Identifiable {
        case onDevice = "This Phone"
        case server = "Server"

        var id: String { rawValue }
    }

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @StateObject private var catalogStore = CatalogStore.shared
    @State private var selectedMode: ConnectionMode = .onDevice
    @State private var localInput: String = ServerConfiguration.defaultLocalBaseURL
    @State private var showingCatalogSetup = false
    @State private var loadSampleData = false

    private var sanitizedLocalInput: String {
        ServerConfiguration.sanitized(localInput)
    }

    private var isValid: Bool {
        switch selectedMode {
        case .onDevice:
            return true
        case .server:
            guard !sanitizedLocalInput.isEmpty else { return false }
            return URL(string: sanitizedLocalInput) != nil
        }
    }

    private var resolvedConfiguration: ServerConfiguration {
        switch selectedMode {
        case .onDevice:
            return .onDevice
        case .server:
            return ServerConfiguration(baseURL: sanitizedLocalInput)
        }
    }

    var body: some View {
        Form {
            if showingCatalogSetup {
                catalogSetup
            } else {
                connectionSetup
            }
        }
        .navigationTitle(showingCatalogSetup ? "Offline Catalogs" : "Get Started")
        .onAppear(perform: populateFromStore)
    }

    @ViewBuilder
    private var connectionSetup: some View {
        Section(header: Text("How do you want to use TCGer?")) {
            Picker("Mode", selection: $selectedMode) {
                ForEach(ConnectionMode.allCases) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)
        }

        if selectedMode == .onDevice {
            Section(
                header: Text("On This Phone"),
                footer: Text("Keep your whole collection on this device. No account, server, or internet connection required — everything is stored locally and stays private to you.")
            ) {
                Label("No account or server needed", systemImage: "iphone")
                    .foregroundColor(.secondary)
                Label("Works fully offline", systemImage: "wifi.slash")
                    .foregroundColor(.secondary)
            }
        } else {
            Section(
                header: Text("Server"),
                footer: Text("Connect to your own TCG Manager server to sync across devices. Examples: http://localhost:3004, http://192.168.1.50:3004, or http://192.168.1.50:3003/api")
            ) {
                TextField("Server URL", text: $localInput)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
            }
        }

        Section {
            Button(action: saveConfiguration) {
                Label(
                    selectedMode == .onDevice ? "Start on This Phone" : "Connect",
                    systemImage: "checkmark.circle.fill"
                )
            }
            .disabled(!isValid)
        }
    }

    @ViewBuilder
    private var catalogSetup: some View {
        Section {
            Text("Add any bundled game catalogs you want for full offline card search and set browsing. Installation is quick and uses no network data.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }

        Section {
            ForEach(TCGGame.catalogGames.filter(environmentStore.isGameEnabled)) { game in
                CatalogInstallRow(game: game, catalogStore: catalogStore)
            }
        } header: {
            Text("Card Catalogs")
        }

        Section {
            Toggle(isOn: $loadSampleData) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Add Sample Collection")
                    Text("Example binders, wishlists, and transactions to explore")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        } header: {
            Text("Sample Data")
        } footer: {
            Text("Leave this off to start with an empty collection. You can add or remove the samples later in Settings.")
        }

        Section {
            Button {
                finishOnDeviceSetup()
            } label: {
                Label("Continue to TCGer", systemImage: "checkmark.circle.fill")
            }

            Button("Skip for Now") {
                finishOnDeviceSetup()
            }

            Button("Back") {
                showingCatalogSetup = false
            }
        }
    }

    private func populateFromStore() {
        let stored = environmentStore.serverConfiguration.baseURL
        if stored == ServerConfiguration.onDeviceBaseURL || stored.isEmpty {
            selectedMode = .onDevice
            localInput = ServerConfiguration.defaultLocalBaseURL
        } else {
            selectedMode = .server
            localInput = stored
        }
    }

    private func saveConfiguration() {
        switch selectedMode {
        case .onDevice:
            showingCatalogSetup = true
        case .server:
            environmentStore.serverConfiguration = resolvedConfiguration
            environmentStore.signOut()
            environmentStore.isServerVerified = false
            environmentStore.appSettings = nil
        }
    }

    private func finishOnDeviceSetup() {
        environmentStore.serverConfiguration = .onDevice
        environmentStore.enableLocalSession(force: true)
        if loadSampleData {
            LocalStore.shared.loadSampleData()
        }
    }
}
