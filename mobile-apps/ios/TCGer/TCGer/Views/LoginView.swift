import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Binding var isAuthenticating: Bool
    var onAuthenticate: () -> Void
    var onShowSignup: (() -> Void)?

    var body: some View {
        Form {
            Section(header: Text("Credentials"), footer: footerText) {
                TextField("Email", text: Binding(
                    get: { environmentStore.credentials.email },
                    set: { environmentStore.credentials.email = $0 }
                ))
                #if os(iOS) || os(tvOS) || os(visionOS)
                    .keyboardType(.emailAddress)
                    .textContentType(.username)
                    .autocapitalization(.none) // or .textInputAutocapitalization(.never) on iOS 15+
                    .disableAutocorrection(true)
                #endif

                SecureField("Password", text: Binding(
                    get: { environmentStore.credentials.password },
                    set: { environmentStore.credentials.password = $0 }
                ))
                #if os(iOS) || os(tvOS) || os(visionOS)
                    .textContentType(.password)
                #endif
            }

            Section {
                Button(action: onAuthenticate) {
                    if isAuthenticating {
                        ProgressView()
                    } else {
                        Label("Sign In", systemImage: "lock.open")
                    }
                }
                .disabled(!environmentStore.credentials.isComplete || isAuthenticating)

                if let onShowSignup {
                    Button(action: onShowSignup) {
                        Label("Create Account", systemImage: "person.badge.plus")
                    }
                    .disabled(isAuthenticating)
                }

                Button(role: .destructive, action: environmentStore.resetEverything) {
                    Label("Reset Configuration", systemImage: "arrow.uturn.backward")
                }
            }
        }
        .navigationTitle("Sign In")
    }

    private var footerText: some View {
        Text("Credentials are sent securely to your configured server.")
    }
}
