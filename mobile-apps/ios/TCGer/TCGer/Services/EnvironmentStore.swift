import Combine
import Foundation
import Security

final class EnvironmentStore: ObservableObject {
    @Published var serverConfiguration: ServerConfiguration
    @Published var credentials: LoginCredentials
    @Published var isAuthenticated: Bool
    @Published var authToken: String?
    @Published var currentUser: User?
    @Published var appSettings: AppSettings?
    @Published var isServerVerified: Bool
    @Published var enabledYugioh: Bool
    @Published var enabledMagic: Bool
    @Published var enabledPokemon: Bool
    @Published var showCardNumbers: Bool
    @Published var showPricing: Bool
    @Published var offlineModeEnabled: Bool
    @Published var autoSyncEnabled: Bool

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
        static let showCardNumbers = "showCardNumbers"
        static let showPricing = "showPricing"
        static let offlineModeEnabled = "offlineModeEnabled"
        static let autoSyncEnabled = "autoSyncEnabled"
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
        let legacyToken = storage.string(forKey: Keys.token)
        let keychainToken = KeychainTokenStore.loadToken()
        authToken = keychainToken ?? legacyToken
        if keychainToken == nil, let legacyToken {
            KeychainTokenStore.saveToken(legacyToken)
            storage.removeObject(forKey: Keys.token)
        }
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

        if storage.object(forKey: Keys.showCardNumbers) == nil {
            showCardNumbers = true
        } else {
            showCardNumbers = storage.bool(forKey: Keys.showCardNumbers)
        }

        if storage.object(forKey: Keys.showPricing) == nil {
            showPricing = true
        } else {
            showPricing = storage.bool(forKey: Keys.showPricing)
        }

        // Offline mode defaults to false
        offlineModeEnabled = storage.bool(forKey: Keys.offlineModeEnabled)

        // Auto sync defaults to true
        if storage.object(forKey: Keys.autoSyncEnabled) == nil {
            autoSyncEnabled = true
        } else {
            autoSyncEnabled = storage.bool(forKey: Keys.autoSyncEnabled)
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
                    KeychainTokenStore.deleteToken()
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

        $showCardNumbers
            .dropFirst()
            .sink { [weak self] flag in
                self?.storage.set(flag, forKey: Keys.showCardNumbers)
            }
            .store(in: &cancellables)

        $showPricing
            .dropFirst()
            .sink { [weak self] flag in
                self?.storage.set(flag, forKey: Keys.showPricing)
            }
            .store(in: &cancellables)

        $offlineModeEnabled
            .dropFirst()
            .sink { [weak self] flag in
                self?.storage.set(flag, forKey: Keys.offlineModeEnabled)
            }
            .store(in: &cancellables)

        $autoSyncEnabled
            .dropFirst()
            .sink { [weak self] flag in
                self?.storage.set(flag, forKey: Keys.autoSyncEnabled)
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
        KeychainTokenStore.saveToken(token)
        storage.removeObject(forKey: Keys.token)
    }

    var isCurrentUserAdmin: Bool {
        currentUser?.isAdmin ?? false
    }

    func applyAuthUser(_ user: User) {
        currentUser = user

        if let showCardNumbers = user.showCardNumbers {
            self.showCardNumbers = showCardNumbers
        }
        if let showPricing = user.showPricing {
            self.showPricing = showPricing
        }
        if let enabledYugioh = user.enabledYugioh {
            self.enabledYugioh = enabledYugioh
        }
        if let enabledMagic = user.enabledMagic {
            self.enabledMagic = enabledMagic
        }
        if let enabledPokemon = user.enabledPokemon {
            self.enabledPokemon = enabledPokemon
        }
    }

    func applyUserProfile(_ profile: APIService.UserProfile) {
        currentUser = User(
            id: profile.id,
            email: profile.email,
            username: profile.username,
            isAdmin: profile.isAdmin,
            showCardNumbers: profile.showCardNumbers,
            showPricing: profile.showPricing,
            enabledYugioh: nil,
            enabledMagic: nil,
            enabledPokemon: nil
        )
    }

    func applyAppSettings(_ settings: AppSettings) {
        appSettings = settings
    }

    func signOut() {
        isAuthenticated = false
        authToken = nil
        currentUser = nil
    }

    func resetEverything() {
        serverConfiguration = .empty
        credentials = .empty
        authToken = nil
        isAuthenticated = false
        currentUser = nil
        appSettings = nil
        isServerVerified = false
        enabledYugioh = true
        enabledMagic = true
        enabledPokemon = true
        showCardNumbers = true
        showPricing = true
        offlineModeEnabled = false
        autoSyncEnabled = true
        storage.removeObject(forKey: Keys.server)
        storage.removeObject(forKey: Keys.credentials)
        storage.removeObject(forKey: Keys.token)
        KeychainTokenStore.deleteToken()
        storage.set(false, forKey: Keys.authenticated)
        storage.set(false, forKey: Keys.verified)
        storage.removeObject(forKey: Keys.showCardNumbers)
        storage.removeObject(forKey: Keys.showPricing)
        storage.removeObject(forKey: Keys.offlineModeEnabled)
        storage.removeObject(forKey: Keys.autoSyncEnabled)
    }

    func applyUserPreferences(_ preferences: APIService.UserPreferences) {
        showCardNumbers = preferences.showCardNumbers
        showPricing = preferences.showPricing
        enabledYugioh = preferences.enabledYugioh
        enabledMagic = preferences.enabledMagic
        enabledPokemon = preferences.enabledPokemon
    }
}

private enum KeychainTokenStore {
    private static let service = "com.tcger.auth"
    private static let account = "jwt-token"

    static func saveToken(_ token: String) {
        guard let encoded = token.data(using: .utf8) else {
            return
        }

        deleteToken()

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            kSecValueData as String: encoded
        ]

        SecItemAdd(query as CFDictionary, nil)
    }

    static func loadToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else {
            return nil
        }

        return String(data: data, encoding: .utf8)
    }

    static func deleteToken() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]

        SecItemDelete(query as CFDictionary)
    }
}
