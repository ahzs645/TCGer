import SwiftUI

struct RootView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore

    @State private var isAuthenticating = false
    @State private var isVerifyingServer = false
    @State private var isBootstrapping = false
    @State private var setupRequired: Bool?
    @State private var showingSignup = false
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
                } else if setupRequired == nil || environmentStore.appSettings == nil || isBootstrapping {
                    ProgressView("Loading app configuration…")
                        .progressViewStyle(.circular)
                } else if setupRequired == true {
                    InitialSetupView(
                        isSubmitting: $isAuthenticating,
                        onCreateAdmin: { email, password, username in
                            Task { await createInitialAdmin(email: email, password: password, username: username) }
                        },
                        onRefreshStatus: { Task { await refreshBootstrapState(force: true) } }
                    )
                } else if !environmentStore.isAuthenticated && shouldRequireAuthentication {
                    if showingSignup {
                        SignupView(
                            isSubmitting: $isAuthenticating,
                            onSignup: { email, password, username in
                                Task { await signup(email: email, password: password, username: username) }
                            },
                            onCancel: {
                                showingSignup = false
                            }
                        )
                    } else {
                        LoginView(isAuthenticating: $isAuthenticating) {
                            Task { await authenticate() }
                        } onShowSignup: {
                            showingSignup = true
                        }
                    }
                } else {
                    MainContentView()
                }
            }
        }
        .task(id: "\(environmentStore.serverConfiguration.baseURL)|\(environmentStore.isServerVerified)") {
            guard environmentStore.serverConfiguration.isValid, environmentStore.isServerVerified else { return }
            await refreshBootstrapState(force: true)
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
                setupRequired = nil
                environmentStore.appSettings = nil
                errorMessage = nil
                await refreshBootstrapState(force: true)
                return
            }
        }

        environmentStore.isServerVerified = false
        setupRequired = nil
        environmentStore.appSettings = nil
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
            let response = try await apiService.authenticate(
                config: environmentStore.serverConfiguration,
                credentials: environmentStore.credentials
            )
            await completeAuthentication(response, fallbackEmail: environmentStore.credentials.email)
        } catch {
            if let apiError = error as? APIService.APIError {
                errorMessage = apiError.localizedDescription
            } else {
                errorMessage = error.localizedDescription
            }
            environmentStore.signOut()
        }
    }

    @MainActor
    private func signup(email: String, password: String, username: String?) async {
        guard environmentStore.serverConfiguration.isValid, environmentStore.isServerVerified else { return }

        isAuthenticating = true
        defer { isAuthenticating = false }

        do {
            let response = try await apiService.signup(
                config: environmentStore.serverConfiguration,
                email: email,
                password: password,
                username: username
            )
            await completeAuthentication(response, fallbackEmail: email)
            showingSignup = false
        } catch {
            if let apiError = error as? APIService.APIError {
                errorMessage = apiError.localizedDescription
            } else {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func createInitialAdmin(email: String, password: String, username: String?) async {
        guard environmentStore.serverConfiguration.isValid, environmentStore.isServerVerified else { return }

        isAuthenticating = true
        defer { isAuthenticating = false }

        do {
            let response = try await apiService.setupInitialAdmin(
                config: environmentStore.serverConfiguration,
                email: email,
                password: password,
                username: username
            )
            setupRequired = false
            await completeAuthentication(response, fallbackEmail: email)
        } catch {
            if let apiError = error as? APIService.APIError {
                errorMessage = apiError.localizedDescription
            } else {
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func completeAuthentication(_ response: AuthResponse, fallbackEmail: String?) async {
        environmentStore.credentials = LoginCredentials(
            email: fallbackEmail ?? response.user.email,
            password: ""
        )
        environmentStore.applyAuthUser(response.user)
        environmentStore.storeToken(response.token)
        environmentStore.isAuthenticated = true
        await fetchPreferences()
        await refreshBootstrapState(force: true)
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

    @MainActor
    private func refreshBootstrapState(force: Bool = false) async {
        guard environmentStore.serverConfiguration.isValid, environmentStore.isServerVerified else { return }
        if isBootstrapping { return }
        if !force, setupRequired != nil, environmentStore.appSettings != nil {
            return
        }

        isBootstrapping = true
        defer { isBootstrapping = false }

        do {
            let setupStatus = try await apiService.checkSetupRequired(config: environmentStore.serverConfiguration)
            setupRequired = setupStatus.setupRequired
        } catch {
            setupRequired = false
            if let apiError = error as? APIService.APIError {
                print("Failed to check setup status: \(apiError.localizedDescription)")
            } else {
                print("Failed to check setup status: \(error.localizedDescription)")
            }
        }

        do {
            let settings = try await apiService.getSettings(config: environmentStore.serverConfiguration)
            environmentStore.applyAppSettings(settings)
        } catch {
            if environmentStore.appSettings == nil {
                environmentStore.applyAppSettings(defaultAppSettings())
            }
            if let apiError = error as? APIService.APIError {
                print("Failed to load app settings: \(apiError.localizedDescription)")
            } else {
                print("Failed to load app settings: \(error.localizedDescription)")
            }
        }
    }

    private var shouldRequireAuthentication: Bool {
        guard let settings = environmentStore.appSettings else {
            return true
        }

        if settings.requireAuth {
            return true
        }

        return !(settings.publicDashboard || settings.publicCollections)
    }

    private func defaultAppSettings() -> AppSettings {
        AppSettings(
            id: 1,
            publicDashboard: false,
            publicCollections: false,
            requireAuth: true,
            appName: "TCG Manager",
            updatedAt: ISO8601DateFormatter().string(from: Date())
        )
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
