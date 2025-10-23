import Combine
import Foundation

final class EnvironmentStore: ObservableObject {
    @Published var serverConfiguration: ServerConfiguration
    @Published var credentials: LoginCredentials
    @Published var isAuthenticated: Bool
    @Published var authToken: String?

    private var cancellables = Set<AnyCancellable>()
    private let storage = UserDefaults.standard

    private enum Keys {
        static let server = "tcg.manager.server"
        static let credentials = "tcg.manager.credentials"
        static let authenticated = "tcg.manager.authenticated"
        static let token = "tcg.manager.auth.token"
    }

    init() {
        if let data = storage.data(forKey: Keys.server),
           let decoded = try? JSONDecoder().decode(ServerConfiguration.self, from: data) {
            serverConfiguration = decoded
        } else {
            serverConfiguration = .empty
        }

        if let data = storage.data(forKey: Keys.credentials),
           let decoded = try? JSONDecoder().decode(LoginCredentials.self, from: data) {
            credentials = decoded
        } else {
            credentials = .empty
        }

        isAuthenticated = storage.bool(forKey: Keys.authenticated)
        authToken = storage.string(forKey: Keys.token)

        $serverConfiguration
            .dropFirst()
            .sink { [weak self] configuration in
                guard let self else { return }
                if let data = try? JSONEncoder().encode(configuration) {
                    storage.set(data, forKey: Keys.server)
                }
            }
            .store(in: &cancellables)

        $credentials
            .dropFirst()
            .sink { [weak self] creds in
                guard let self else { return }
                if let data = try? JSONEncoder().encode(creds) {
                    storage.set(data, forKey: Keys.credentials)
                }
            }
            .store(in: &cancellables)

        $isAuthenticated
            .dropFirst()
            .sink { [weak self] flag in
                self?.storage.set(flag, forKey: Keys.authenticated)
                if !flag {
                    self?.storage.removeObject(forKey: Keys.token)
                    self?.authToken = nil
                }
            }
            .store(in: &cancellables)
    }

    func storeToken(_ token: String) {
        authToken = token
        storage.set(token, forKey: Keys.token)
    }

    func resetEverything() {
        serverConfiguration = .empty
        credentials = .empty
        authToken = nil
        isAuthenticated = false
        storage.removeObject(forKey: Keys.server)
        storage.removeObject(forKey: Keys.credentials)
        storage.removeObject(forKey: Keys.token)
        storage.set(false, forKey: Keys.authenticated)
    }
}
