import SwiftUI

struct ServerSetupView: View {
    private enum ConnectionMode: String, CaseIterable, Identifiable {
        case onDevice = "This Phone"
        case server = "Server"

        var id: String { rawValue }
    }

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var selectedMode: ConnectionMode = .onDevice
    @State private var localInput: String = ServerConfiguration.defaultLocalBaseURL

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
            return .demoLocal
        case .server:
            return ServerConfiguration(baseURL: sanitizedLocalInput)
        }
    }

    var body: some View {
        Form {
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
                    footer: Text("Connect to your own TCG Manager server to sync across devices. Examples: http://localhost:3001, http://10.1.15.216:3001, or http://192.168.1.50:31452")
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
        .navigationTitle("Get Started")
        .onAppear(perform: populateFromStore)
    }

    private func populateFromStore() {
        let stored = environmentStore.serverConfiguration.baseURL
        if stored == ServerConfiguration.demoLocalBaseURL || stored.isEmpty {
            selectedMode = .onDevice
            localInput = ServerConfiguration.defaultLocalBaseURL
        } else {
            selectedMode = .server
            localInput = stored
        }
    }

    private func saveConfiguration() {
        environmentStore.serverConfiguration = resolvedConfiguration

        switch selectedMode {
        case .onDevice:
            environmentStore.enableDemoSession(force: true)
        case .server:
            environmentStore.signOut()
            environmentStore.isServerVerified = false
            environmentStore.appSettings = nil
        }
    }
}
