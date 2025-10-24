import SwiftUI

struct RootView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore

    @State private var isAuthenticating = false
    @State private var isVerifyingServer = false
    @State private var errorMessage: String?

    private let apiService = APIService()

    var body: some View {
        NavigationStack {
            Group {
                if !environmentStore.serverConfiguration.isValid {
                    ServerSetupView()
                } else if !environmentStore.isServerVerified {
                    ServerVerificationView(
                        isChecking: isVerifyingServer,
                        currentURL: environmentStore.serverConfiguration.baseURL,
                        retryAction: { Task { await verifyServerConnection() } },
                        changeServerAction: { environmentStore.serverConfiguration = .empty }
                    )
                    .task(id: environmentStore.serverConfiguration.baseURL) {
                        await verifyServerConnection()
                    }
                } else if !environmentStore.isAuthenticated {
                    LoginView(isAuthenticating: $isAuthenticating) {
                        Task { await authenticate() }
                    }
                } else {
                    MainContentView()
                }
            }
        }
        .alert("Oops", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { self.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "Unknown error")
        }
    }

    @MainActor
    private func verifyServerConnection() async {
        guard environmentStore.serverConfiguration.isValid else { return }
        if isVerifyingServer { return }
        isVerifyingServer = true
        defer { isVerifyingServer = false }

        let candidates = environmentStore.serverConfiguration.backendCandidates

        for candidate in candidates {
            let reachable = await apiService.verifyServer(config: candidate)
            if reachable {
                if candidate.baseURL != environmentStore.serverConfiguration.baseURL {
                    environmentStore.serverConfiguration = candidate
                }
                environmentStore.isServerVerified = true
                errorMessage = nil
                return
            }
        }

        environmentStore.isServerVerified = false
        errorMessage = "Unable to reach the server. Try using the backend address (e.g., port 3000 or /api)."
    }

    @MainActor
    private func authenticate() async {
        guard environmentStore.serverConfiguration.isValid else { return }
        guard environmentStore.isServerVerified else {
            await verifyServerConnection()
            return
        }
        guard environmentStore.credentials.isComplete else { return }
        isAuthenticating = true
        defer { isAuthenticating = false }

        do {
            let token = try await apiService.authenticate(
                config: environmentStore.serverConfiguration,
                credentials: environmentStore.credentials
            )
            environmentStore.storeToken(token)
            environmentStore.isAuthenticated = true
            await fetchPreferences()
        } catch {
            if let apiError = error as? APIService.APIError {
                errorMessage = apiError.localizedDescription
            } else {
                errorMessage = error.localizedDescription
            }
            environmentStore.isAuthenticated = false
        }
    }

    @MainActor
    private func fetchPreferences() async {
        guard environmentStore.serverConfiguration.isValid,
              let token = environmentStore.authToken else { return }

        do {
            let prefs = try await apiService.getUserPreferences(
                config: environmentStore.serverConfiguration,
                token: token
            )
            environmentStore.applyUserPreferences(prefs)
        } catch {
            // Non-fatal; preferences fall back to persisted defaults
            if let apiError = error as? APIService.APIError {
                print("Failed to load preferences: \(apiError.localizedDescription)")
            } else {
                print("Failed to load preferences: \(error.localizedDescription)")
            }
        }
    }
}

private struct ServerVerificationView: View {
    var isChecking: Bool
    var currentURL: String
    var retryAction: () -> Void
    var changeServerAction: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            if isChecking {
                ProgressView("Connecting to server…")
                    .progressViewStyle(.circular)
            } else {
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 40))
                    .foregroundColor(.secondary)
                Text("We couldn't reach your server.")
                    .font(.headline)
                Text("Current URL: \(currentURL)")
                    .font(.footnote)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                Text("Check your URL, network connection, or try again.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                HStack {
                    Button("Change URL", role: .cancel, action: changeServerAction)
                    Button("Retry", action: retryAction)
                        .buttonStyle(.borderedProminent)
                }
            }
            Spacer()
        }
        .padding()
    }
}
