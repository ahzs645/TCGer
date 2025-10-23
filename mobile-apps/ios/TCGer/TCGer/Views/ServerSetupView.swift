import SwiftUI

struct ServerSetupView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var input: String = "http://"

    private var sanitizedInput: String {
        ServerConfiguration.sanitized(input)
    }

    private var isValid: Bool {
        guard !sanitizedInput.isEmpty else { return false }
        return URL(string: sanitizedInput) != nil
    }

    var body: some View {
        Form {
            Section(
                header: Text("Server Address"),
                footer: Text("Example: http://localhost:3001 or http://10.1.15.216:3001")
            ) {
                TextField("Server URL", text: $input)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
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
        input = stored.isEmpty ? "http://" : stored
    }

    private func saveConfiguration() {
        environmentStore.serverConfiguration = ServerConfiguration(baseURL: sanitizedInput)
        environmentStore.isAuthenticated = false
        environmentStore.isServerVerified = false
    }
}
