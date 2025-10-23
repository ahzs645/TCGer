import SwiftUI

struct ServerSetupView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var scheme: String = "http"
    @State private var host: String = ""
    @State private var port: String = "3000"

    private let schemes = ["http", "https"]

    var body: some View {
        Form {
            Section(header: Text("Server Address"), footer: Text("Enter the base address of your TCG Manager server.")) {
                Picker("Scheme", selection: $scheme) {
                    ForEach(schemes, id: \.self) { scheme in
                        Text(scheme.uppercased()).tag(scheme)
                    }
                }
                TextField("IP address or hostname", text: $host)
                #if os(iOS) || os(tvOS) || os(visionOS)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                #endif
                TextField("Port", text: $port)
                #if os(iOS) || os(tvOS) || os(visionOS)
                    .keyboardType(.numberPad)
                #endif
            }

            Section {
                Button(action: saveConfiguration) {
                    Label("Save and Continue", systemImage: "checkmark.circle.fill")
                }
                .disabled(host.isEmpty || port.isEmpty)
            }
        }
        .navigationTitle("Server Setup")
        .onAppear(perform: populateFromStore)
    }

    private func populateFromStore() {
        let config = environmentStore.serverConfiguration
        if !config.host.isEmpty {
            scheme = config.scheme
            host = config.host
            port = config.port
        }
    }

    private func saveConfiguration() {
        environmentStore.serverConfiguration = ServerConfiguration(scheme: scheme, host: host, port: port)
    }
}
