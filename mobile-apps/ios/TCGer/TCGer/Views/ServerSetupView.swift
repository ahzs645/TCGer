import SwiftUI

struct ServerSetupView: View {
    private enum ConnectionMode: String, CaseIterable, Identifiable {
        case local = "Local"
        case demo = "Demo"

        var id: String { rawValue }
    }

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var selectedMode: ConnectionMode = .local
    @State private var localInput: String = ServerConfiguration.defaultLocalBaseURL

    private var sanitizedLocalInput: String {
        ServerConfiguration.sanitized(localInput)
    }

    private var isValid: Bool {
        switch selectedMode {
        case .local:
            guard !sanitizedLocalInput.isEmpty else { return false }
            return URL(string: sanitizedLocalInput) != nil
        case .demo:
            return true
        }
    }

    private var resolvedConfiguration: ServerConfiguration {
        switch selectedMode {
        case .local:
            return ServerConfiguration(baseURL: sanitizedLocalInput)
        case .demo:
            return .demoLocal
        }
    }

    var body: some View {
        Form {
            Section(header: Text("Connection Mode")) {
                Picker("Mode", selection: $selectedMode) {
                    ForEach(ConnectionMode.allCases) { mode in
                        Text(mode.rawValue).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
            }

            if selectedMode == .local {
                Section(
                    header: Text("Local Server"),
                    footer: Text("Examples: http://localhost:3001 or http://10.1.15.216:3001")
                ) {
                    TextField("Local API URL", text: $localInput)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                }
            } else {
                Section(
                    header: Text("Demo Environment"),
                    footer: Text("Uses an in-app fake dataset and mocked API responses. Great for previews and testing UI flows.")
                ) {
                    Label("No network connection required", systemImage: "sparkles")
                        .foregroundColor(.secondary)
                }
            }

            Section {
                Button(action: saveConfiguration) {
                    Label("Save and Continue", systemImage: "checkmark.circle.fill")
                }
                .disabled(!isValid)
            }
        }
        .navigationTitle("Server Setup")
        .onAppear(perform: populateFromStore)
    }

    private func populateFromStore() {
        let stored = environmentStore.serverConfiguration.baseURL
        if stored == ServerConfiguration.demoLocalBaseURL {
            selectedMode = .demo
            localInput = ServerConfiguration.defaultLocalBaseURL
        } else {
            selectedMode = .local
            localInput = stored.isEmpty ? ServerConfiguration.defaultLocalBaseURL : stored
        }
    }

    private func saveConfiguration() {
        environmentStore.serverConfiguration = resolvedConfiguration

        switch selectedMode {
        case .local:
            environmentStore.signOut()
            environmentStore.isServerVerified = false
            environmentStore.appSettings = nil
        case .demo:
            environmentStore.enableDemoSession(force: true)
        }
    }
}
