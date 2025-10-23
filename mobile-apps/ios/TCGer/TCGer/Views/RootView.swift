import SwiftUI

struct RootView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore

    @State private var isAuthenticating = false
    @State private var errorMessage: String?

    private let apiService = APIService()

    var body: some View {
        NavigationStack {
            Group {
                if !environmentStore.serverConfiguration.isValid {
                    ServerSetupView()
                } else if !environmentStore.isAuthenticated {
                    LoginView(isAuthenticating: $isAuthenticating) {
                        Task { await authenticate() }
                    }
                } else {
                    MainContentView()
                }
            }
            .navigationTitle("TCGer")
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
    private func authenticate() async {
        guard environmentStore.serverConfiguration.isValid else { return }
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
        } catch {
            if let apiError = error as? APIService.APIError {
                errorMessage = apiError.localizedDescription
            } else {
                errorMessage = error.localizedDescription
            }
            environmentStore.isAuthenticated = false
        }
    }
}
