import Combine
import SwiftUI

struct RootView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @EnvironmentObject private var wishlistStore: WishlistStore

    @State private var isAuthenticating = false
    @State private var authenticationRequestID: UUID?
    @State private var verificationRequestID: UUID?
    @State private var bootstrapRequestID: UUID?
    @State private var isVerifyingServer = false
    @State private var isBootstrapping = false
    @State private var isCheckingStartupFeatures = false
    @State private var setupRequired: Bool?
    @State private var showingSignup = false
    @State private var errorMessage: String?
    @StateObject private var appLock = DeviceAppLockStore()
    @StateObject private var serverFeatureStore = ServerFeatureRefreshStore()
    @StateObject private var catalogStore = CatalogStore.shared
    @StateObject private var gamePackages = GamePackageStore.shared

    private let apiService = APIService()

    var body: some View {
        Group {
            if shouldPresentMainContent {
                if needsGameInstallation {
                    GameInstallationView(catalogStore: catalogStore).id(environmentStore.widgetSessionID)
                } else {
                    MainContentView().id(environmentStore.widgetSessionID)
                }
            } else {
                NavigationStack {
                    launchContent
                }
            }
        }
        .onChange(of: environmentStore.widgetSessionID) {
            wishlistStore.reset()
            authenticationRequestID = nil
            verificationRequestID = nil
            bootstrapRequestID = nil
            isAuthenticating = false
            isVerifyingServer = false
            isBootstrapping = false
            errorMessage = nil
            showingSignup = false
        }
        .task(id: "\(environmentStore.serverConfiguration.baseURL)|\(environmentStore.isServerVerified)") {
            guard environmentStore.serverConfiguration.isValid, environmentStore.isServerVerified else {
                serverFeatureStore.reset()
                return
            }
            isCheckingStartupFeatures = setupRequired == nil
            defer { isCheckingStartupFeatures = false }
            async let features: Void = refreshServerFeatures()
            await refreshBootstrapState(force: true)
            await features
        }
        .task(id: environmentStore.displayCurrencyCode) {
            await environmentStore.refreshExchangeRate()
        }
        .onReceive(NetworkMonitor.shared.$isConnected.removeDuplicates()) { connected in
            guard connected else { return }
            Task { await refreshServerFeatures(force: true) }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            Task { await refreshServerFeatures(force: true) }
        }
        .safeAreaInset(edge: .top) {
            if serverFeatureStore.errorMessage != nil {
                HStack {
                    Text("Couldn’t check available server features.")
                        .font(.caption)
                    Spacer()
                    Button("Retry") { Task { await refreshServerFeatures(force: true) } }
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
                .background(.regularMaterial)
            }
        }
        .alert(errorMessage == nil ? "Sign-in Storage" : "Oops", isPresented: Binding(
            get: { errorMessage != nil || environmentStore.tokenPersistenceWarning != nil },
            set: { if !$0 {
                if errorMessage != nil { self.errorMessage = nil }
                else { environmentStore.dismissTokenPersistenceWarning() }
            } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? environmentStore.tokenPersistenceWarning ?? "Unknown error")
        }
        .overlay {
            if environmentStore.biometricLockEnabled && appLock.isLocked {
                BiometricLockScreen {
                    Task { await appLock.unlock() }
                }
                .transition(.opacity)
            }
        }
        .task(id: environmentStore.biometricLockEnabled) {
            appLock.configure(enabled: environmentStore.biometricLockEnabled)
            await appLock.unlock()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in
            appLock.shield()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in
            appLock.background()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            appLock.becomeActive()
            Task { await appLock.unlock() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .localStorePersistenceFailed)) { notification in
            guard let failure = notification.userInfo?["failure"] as? LocalStorePersistenceFailure else {
                errorMessage = "Local data could not be saved. The latest local change was reverted."
                return
            }
            errorMessage = "Local data \(failure.operation.userFacingFailurePhrase): \(failure.message)"
        }
    }

    private var shouldPresentMainContent: Bool {
        environmentStore.serverConfiguration.isValid &&
        environmentStore.isServerVerified &&
        setupRequired == false &&
        environmentStore.appSettings != nil &&
        !isBootstrapping && !isCheckingStartupFeatures &&
        (environmentStore.isAuthenticated || !shouldRequireAuthentication)
    }

    private var needsGameInstallation: Bool {
        #if DEBUG && targetEnvironment(simulator)
        if UserDefaults.standard.string(forKey: "tcgerParityTest") == "true" { return false }
        #endif
        return GameInstallationState.needsInstallation(
            enabledGameCount: environmentStore.enabledGames.count,
            installedPackageCount: gamePackages.installed.count
        )
    }

    @ViewBuilder
    private var launchContent: some View {
        if !environmentStore.serverConfiguration.isValid {
            ServerSetupView()
        } else if !environmentStore.isServerVerified {
            ServerVerificationView(
                isChecking: isVerifyingServer,
                currentURL: environmentStore.serverConfiguration.baseURL,
                retryAction: { Task { await verifyServerConnection() } },
                changeServerAction: resetServerSelection
            )
            .task(id: environmentStore.serverConfiguration.baseURL) {
                await verifyServerConnection()
            }
        } else if setupRequired == nil || environmentStore.appSettings == nil || isBootstrapping || isCheckingStartupFeatures {
            ProgressView("Loading app configuration…")
                .progressViewStyle(.circular)
        } else if setupRequired == true {
            InitialSetupView(
                isSubmitting: $isAuthenticating,
                onCreateAdmin: { email, password, username in
                    Task { await createInitialAdmin(email: email, password: password, username: username) }
                },
                onRefreshStatus: { Task { await refreshBootstrapState(force: true) } },
                onChangeServer: resetServerSelection
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
        }
    }

    @MainActor
    private func verifyServerConnection() async {
        guard environmentStore.serverConfiguration.isValid else { return }
        if isVerifyingServer { return }
        let requestID = UUID()
        verificationRequestID = requestID
        let session = environmentStore.sessionIdentity
        isVerifyingServer = true
        defer { if verificationRequestID == requestID { isVerifyingServer = false } }

        let candidates = session.configuration.backendCandidates

        for candidate in candidates {
            let reachable = await apiService.verifyServer(config: candidate)
            guard environmentStore.matches(session), verificationRequestID == requestID, !Task.isCancelled else { return }
            if reachable {
                if candidate.baseURL != environmentStore.serverConfiguration.baseURL {
                    environmentStore.serverConfiguration = candidate
                }
                environmentStore.isServerVerified = true
                setupRequired = nil
                environmentStore.appSettings = nil
                errorMessage = nil
                await refreshServerFeatures()
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
    private func resetServerSelection() {
        serverFeatureStore.reset()
        authenticationRequestID = nil
        verificationRequestID = nil
        bootstrapRequestID = nil
        isAuthenticating = false
        isVerifyingServer = false
        isBootstrapping = false
        setupRequired = nil
        showingSignup = false
        errorMessage = nil
        environmentStore.appSettings = nil
        environmentStore.serverConfiguration = .empty
        environmentStore.signOut()
    }

    @MainActor
    private func refreshServerFeatures(force: Bool = false) async {
        let configuration = environmentStore.serverConfiguration
        guard configuration.isValid, environmentStore.isServerVerified else { return }
        guard let features = await serverFeatureStore.refresh(config: configuration, force: force),
              environmentStore.serverConfiguration.baseURL == configuration.baseURL,
              environmentStore.isServerVerified else { return }
        environmentStore.serverFeatures = features
    }

    @MainActor
    private func authenticate() async {
        guard environmentStore.serverConfiguration.isValid, !isAuthenticating else { return }
        guard environmentStore.isServerVerified else {
            await verifyServerConnection()
            return
        }
        guard environmentStore.credentials.isComplete else { return }
        let session = environmentStore.sessionIdentity
        let credentials = environmentStore.credentials
        let requestID = UUID()
        authenticationRequestID = requestID
        isAuthenticating = true
        defer { if authenticationRequestID == requestID { isAuthenticating = false } }
        do {
            let response = try await apiService.authenticate(config: session.configuration, credentials: credentials)
            guard authenticationRequestID == requestID, !Task.isCancelled else { return }
            await completeAuthentication(response, fallbackUsername: credentials.username, for: session)
        } catch {
            guard environmentStore.matches(session), authenticationRequestID == requestID, !(error is CancellationError) else { return }
            errorMessage = error.localizedDescription
            // A failed attempt has no authority to sign out a replacement session.
        }
    }

    @MainActor
    private func signup(email: String, password: String, username: String) async {
        guard environmentStore.serverConfiguration.isValid, environmentStore.isServerVerified, !isAuthenticating else { return }
        let session = environmentStore.sessionIdentity
        let requestID = UUID()
        authenticationRequestID = requestID
        isAuthenticating = true
        defer { if authenticationRequestID == requestID { isAuthenticating = false } }
        do {
            let response = try await apiService.signup(config: session.configuration, email: email, password: password, username: username)
            guard authenticationRequestID == requestID, !Task.isCancelled else { return }
            await completeAuthentication(response, fallbackUsername: username, for: session)
        } catch {
            guard environmentStore.matches(session), authenticationRequestID == requestID, !(error is CancellationError) else { return }
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func createInitialAdmin(email: String, password: String, username: String) async {
        guard environmentStore.serverConfiguration.isValid, environmentStore.isServerVerified, !isAuthenticating else { return }
        let session = environmentStore.sessionIdentity
        let requestID = UUID()
        authenticationRequestID = requestID
        isAuthenticating = true
        defer { if authenticationRequestID == requestID { isAuthenticating = false } }
        do {
            let response = try await apiService.setupInitialAdmin(config: session.configuration, email: email, password: password, username: username)
            guard authenticationRequestID == requestID, environmentStore.matches(session), !Task.isCancelled else { return }
            setupRequired = false
            await completeAuthentication(response, fallbackUsername: username, for: session)
        } catch {
            guard environmentStore.matches(session), authenticationRequestID == requestID, !(error is CancellationError) else { return }
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func completeAuthentication(_ response: AuthResponse, fallbackUsername: String?, for session: EnvironmentStore.SessionIdentity) async {
        guard !Task.isCancelled,
              environmentStore.completeAuthentication(response, username: fallbackUsername, for: session) else { return }
        showingSignup = false
        let authenticatedSession = environmentStore.sessionIdentity
        await fetchPreferences()
        guard environmentStore.matches(authenticatedSession), !Task.isCancelled else { return }
        await refreshBootstrapState(force: true)
    }

    @MainActor
    private func fetchPreferences() async {
        guard environmentStore.serverConfiguration.isValid,
              let token = environmentStore.authToken else { return }

        let session = environmentStore.sessionIdentity
        do {
            let prefs = try await apiService.getUserPreferences(config: session.configuration, token: token)
            guard environmentStore.matches(session), !Task.isCancelled else { return }
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

        let requestID = UUID()
        bootstrapRequestID = requestID
        isBootstrapping = true
        defer { if bootstrapRequestID == requestID { isBootstrapping = false } }

        let configuration = environmentStore.serverConfiguration
        let sessionID = environmentStore.widgetSessionID
        // These independent reads need not add their network latencies. Keep
        // publication on this actor and reject a replaced server/session.
        async let setupRequest = apiService.checkSetupRequired(config: configuration)
        async let settingsRequest = apiService.getSettings(config: configuration)
        do {
            let setupStatus = try await setupRequest
            guard !Task.isCancelled, sessionID == environmentStore.widgetSessionID,
                  configuration == environmentStore.serverConfiguration else { return }
            setupRequired = setupStatus.setupRequired
        } catch {
            guard !Task.isCancelled, sessionID == environmentStore.widgetSessionID,
                  configuration == environmentStore.serverConfiguration else { return }
            setupRequired = false
            if let apiError = error as? APIService.APIError {
                print("Failed to check setup status: \(apiError.localizedDescription)")
            } else {
                print("Failed to check setup status: \(error.localizedDescription)")
            }
        }

        do {
            let settings = try await settingsRequest
            guard !Task.isCancelled, sessionID == environmentStore.widgetSessionID,
                  configuration == environmentStore.serverConfiguration else { return }
            environmentStore.applyAppSettings(settings)
        } catch {
            guard !Task.isCancelled, sessionID == environmentStore.widgetSessionID,
                  configuration == environmentStore.serverConfiguration else { return }
            if environmentStore.appSettings == nil {
                environmentStore.applyAppSettings(defaultAppSettings())
            }
            if let apiError = error as? APIService.APIError {
                print("Failed to load app settings: \(apiError.localizedDescription)")
            } else {
                print("Failed to load app settings: \(error.localizedDescription)")
            }
        }

        await reconcileServerAccessMode()
    }

    @MainActor
    private func reconcileServerAccessMode() async {
        guard environmentStore.serverConfiguration.isValid, environmentStore.isServerVerified else {
            return
        }

        guard setupRequired == false else {
            showingSignup = false
            environmentStore.signOut()
            return
        }

        if environmentStore.serverConfiguration.isOnDevice {
            return
        }

        let session = environmentStore.sessionIdentity
        if environmentStore.isUsingSingleUserMode {
            if await probeSingleUserSession() {
                return
            }
            guard environmentStore.matches(session), !Task.isCancelled else { return }
            environmentStore.signOut()
        }

        if let token = environmentStore.authToken, !environmentStore.isUsingSingleUserMode {
            let authenticatedSession = environmentStore.sessionIdentity
            do {
                let profile = try await apiService.getUserProfile(
                    config: authenticatedSession.configuration,
                    token: token
                )
                guard environmentStore.matches(authenticatedSession), !Task.isCancelled else { return }
                environmentStore.applyUserProfile(profile)
                environmentStore.isAuthenticated = true
                showingSignup = false
                await fetchPreferences()
                return
            } catch let apiError as APIService.APIError {
                guard environmentStore.matches(authenticatedSession), !Task.isCancelled else { return }
                if case .unauthorized = apiError {
                    environmentStore.signOut()
                } else {
                    print("Failed to validate authenticated session: \(apiError.localizedDescription)")
                    return
                }
            } catch {
                print("Failed to validate authenticated session: \(error.localizedDescription)")
                return
            }
        }

        _ = await probeSingleUserSession()
    }

    @MainActor
    private func probeSingleUserSession() async -> Bool {
        let session = environmentStore.sessionIdentity
        do {
            let profile = try await apiService.getUserProfile(
                config: session.configuration
            )
            guard environmentStore.matches(session), !Task.isCancelled else { return false }
            environmentStore.enableSingleUserSession(profile: profile)
            showingSignup = false
            await fetchPreferences()
            return true
        } catch let apiError as APIService.APIError {
            if case .unauthorized = apiError {
                return false
            }

            print("Failed to probe single-user mode: \(apiError.localizedDescription)")
            return false
        } catch {
            print("Failed to probe single-user mode: \(error.localizedDescription)")
            return false
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

private extension LocalStorePersistenceFailure.Operation {
    var userFacingFailurePhrase: String {
        switch self {
        case .load: "could not be loaded"
        case .save: "could not be saved; the latest local change was reverted"
        case .reset: "could not be reset"
        case .restore: "could not be restored"
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

private struct BiometricLockScreen: View {
    let onUnlock: () -> Void

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.ultraThinMaterial)
                .ignoresSafeArea()

            VStack(spacing: 20) {
                Image(systemName: BiometricAuthManager.biometricType == .faceID ? "faceid" : "touchid")
                    .font(.system(size: 50))
                    .foregroundColor(.accentColor)

                Text("TCGer is Locked")
                    .font(.title2)
                    .fontWeight(.bold)

                Button(action: onUnlock) {
                    Label("Unlock with \(BiometricAuthManager.displayName)", systemImage: "lock.open.fill")
                        .font(.headline)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }
}
