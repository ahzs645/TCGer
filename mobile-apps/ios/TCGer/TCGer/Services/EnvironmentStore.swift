import Combine
import Foundation

final class EnvironmentStore: ObservableObject {
    @Published var serverConfiguration: ServerConfiguration
    @Published var credentials: LoginCredentials
    @Published var isAuthenticated: Bool
    @Published var authToken: String?
    @Published var isServerVerified: Bool
    @Published var enabledYugioh: Bool
    @Published var enabledMagic: Bool
    @Published var enabledPokemon: Bool

    private var cancellables = Set<AnyCancellable>()
    private let storage = UserDefaults.standard

    private enum Keys {
        static let server = "tcg.manager.server"
        static let credentials = "tcg.manager.credentials"
        static let authenticated = "tcg.manager.authenticated"
        static let token = "tcg.manager.auth.token"
        static let verified = "tcg.manager.server.verified"
        static let enabledYugioh = "enabledYugioh"
        static let enabledMagic = "enabledMagic"
        static let enabledPokemon = "enabledPokemon"
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
        isServerVerified = storage.bool(forKey: Keys.verified)

        // Load enabled games, defaulting to true if not set
        if storage.object(forKey: Keys.enabledYugioh) == nil {
            enabledYugioh = true
        } else {
            enabledYugioh = storage.bool(forKey: Keys.enabledYugioh)
        }

        if storage.object(forKey: Keys.enabledMagic) == nil {
            enabledMagic = true
        } else {
            enabledMagic = storage.bool(forKey: Keys.enabledMagic)
        }

        if storage.object(forKey: Keys.enabledPokemon) == nil {
            enabledPokemon = true
        } else {
            enabledPokemon = storage.bool(forKey: Keys.enabledPokemon)
        }

        $serverConfiguration
            .dropFirst()
            .sink { [weak self] configuration in
                guard let self else { return }
                if let data = try? JSONEncoder().encode(configuration) {
                    storage.set(data, forKey: Keys.server)
                }
                storage.set(false, forKey: Keys.verified)
                self.isServerVerified = false
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

        $isServerVerified
            .dropFirst()
            .sink { [weak self] flag in
                self?.storage.set(flag, forKey: Keys.verified)
            }
            .store(in: &cancellables)

        $enabledYugioh
            .dropFirst()
            .sink { [weak self] flag in
                self?.storage.set(flag, forKey: Keys.enabledYugioh)
            }
            .store(in: &cancellables)

        $enabledMagic
            .dropFirst()
            .sink { [weak self] flag in
                self?.storage.set(flag, forKey: Keys.enabledMagic)
            }
            .store(in: &cancellables)

        $enabledPokemon
            .dropFirst()
            .sink { [weak self] flag in
                self?.storage.set(flag, forKey: Keys.enabledPokemon)
            }
            .store(in: &cancellables)
    }

    var enabledGames: [TCGGame] {
        var games: [TCGGame] = []
        if enabledYugioh { games.append(.yugioh) }
        if enabledMagic { games.append(.magic) }
        if enabledPokemon { games.append(.pokemon) }
        return games
    }

    func isGameEnabled(_ game: TCGGame) -> Bool {
        switch game {
        case .all: return true
        case .yugioh: return enabledYugioh
        case .magic: return enabledMagic
        case .pokemon: return enabledPokemon
        }
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
        isServerVerified = false
        storage.removeObject(forKey: Keys.server)
        storage.removeObject(forKey: Keys.credentials)
        storage.removeObject(forKey: Keys.token)
        storage.set(false, forKey: Keys.authenticated)
        storage.set(false, forKey: Keys.verified)
    }
}
