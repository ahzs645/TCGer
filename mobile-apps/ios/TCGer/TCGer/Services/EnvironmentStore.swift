import Combine
import Foundation
import Security
import SwiftUI
import WidgetKit

enum AppColorScheme: String, CaseIterable, Identifiable {
    case system, light, dark

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

enum AccentColorChoice: String, CaseIterable, Identifiable {
    case blue, green, orange, pink, purple, red, yellow, teal, indigo, mint

    var id: String { rawValue }

    var displayName: String { rawValue.capitalized }

    var color: Color {
        switch self {
        case .blue: return .blue
        case .green: return .green
        case .orange: return .orange
        case .pink: return .pink
        case .purple: return .purple
        case .red: return .red
        case .yellow: return .yellow
        case .teal: return .teal
        case .indigo: return .indigo
        case .mint: return .mint
        }
    }
}

final class EnvironmentStore: ObservableObject {
    @Published var serverConfiguration: ServerConfiguration
    @Published var credentials: LoginCredentials
    @Published var isAuthenticated: Bool
    @Published var authToken: String?
    @Published var isUsingSingleUserMode: Bool
    @Published var currentUser: User?
    @Published var appSettings: AppSettings?
    @Published var serverFeatures: ServerFeatures
    @Published var isServerVerified: Bool
    @Published var enabledYugioh: Bool
    @Published var enabledMagic: Bool
    @Published var enabledPokemon: Bool
    @Published var enabledOnepiece: Bool
    @Published var enabledLorcana: Bool
    @Published var enabledDragonball: Bool
    @Published var showCardNumbers: Bool
    @Published var showPricing: Bool
    @Published var defaultGame: String?
    @Published var offlineModeEnabled: Bool
    @Published var autoSyncEnabled: Bool
    @Published var appColorScheme: AppColorScheme
    @Published var accentColorChoice: AccentColorChoice
    @Published var biometricLockEnabled: Bool
    @Published var smartFolders: [SmartFolder]
    @Published var tabOrder: [AppTab]
    @Published var hiddenTabs: Set<AppTab>
    @Published private(set) var focusedSetOrder: [String]
    @Published private(set) var setCompletionMode: SetCompletionMode
    @Published var setBrowserSort: SetBrowserSort

    private var cancellables = Set<AnyCancellable>()
    private var setPreferencesSyncTask: Task<Void, Never>?
    private let storage = UserDefaults.standard

    private enum Keys {
        static let server = "tcg.manager.server"
        static let credentials = "tcg.manager.credentials"
        static let authenticated = "tcg.manager.authenticated"
        static let token = "tcg.manager.auth.token"
        static let singleUserMode = "tcg.manager.auth.singleUserMode"
        static let verified = "tcg.manager.server.verified"
        static let enabledYugioh = "enabledYugioh"
        static let enabledMagic = "enabledMagic"
        static let enabledPokemon = "enabledPokemon"
        static let enabledOnepiece = "enabledOnepiece"
        static let enabledLorcana = "enabledLorcana"
        static let enabledDragonball = "enabledDragonball"
        static let showCardNumbers = "showCardNumbers"
        static let showPricing = "showPricing"
        static let defaultGame = "defaultGame"
        static let offlineModeEnabled = "offlineModeEnabled"
        static let autoSyncEnabled = "autoSyncEnabled"
        static let appColorScheme = "tcg.appearance.colorScheme"
        static let accentColor = "tcg.appearance.accentColor"
        static let biometricLockEnabled = "tcg.security.biometricLock"
        static let smartFolders = "tcg.smartFolders"
        static let tabOrder = "tcg.tabs.order"
        static let hiddenTabs = "tcg.tabs.hidden"
        static let focusedSetIDs = "tcg.sets.focused"
        static let setCompletionMode = "tcg.sets.completionMode"
        static let setBrowserSort = "tcg.sets.browserSort"
    }

    /// Phone-only mode has no account. These stand in for the session the rest
    /// of the app expects, so every screen works without a server or sign-in.
    private enum LocalDefaults {
        static let token = "local-device-token"
        static let userId = "local-user"
        static let email = ""
        static let username = "This Phone"
        static let legacyToken = "demo-token-static"
        static let legacyUserId = "demo-user-001"
    }

    private enum SingleUserDefaults {
        static let token = "single-user-token-static"
    }

    init() {
        if let data = storage.data(forKey: Keys.server),
           let decoded = try? JSONDecoder().decode(ServerConfiguration.self, from: data) {
            // A previously-saved empty config falls back to on-device mode so a
            // fresh launch lands in a working phone-only experience instead of a
            // failed connection to a server that was never set up.
            serverConfiguration = decoded.baseURL.isEmpty ? .onDevice : decoded
        } else {
            serverConfiguration = .onDevice
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
        isUsingSingleUserMode =
            (storage.object(forKey: Keys.singleUserMode) as? Bool)
            ?? ((keychainToken ?? legacyToken) == SingleUserDefaults.token)
        currentUser = nil
        appSettings = nil
        serverFeatures = .allEnabled
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

        enabledOnepiece = storage.bool(forKey: Keys.enabledOnepiece)
        enabledLorcana = storage.bool(forKey: Keys.enabledLorcana)
        enabledDragonball = storage.bool(forKey: Keys.enabledDragonball)

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

        // Default game preference
        defaultGame = storage.string(forKey: Keys.defaultGame)

        // Offline mode defaults to false
        offlineModeEnabled = storage.bool(forKey: Keys.offlineModeEnabled)

        // Auto sync defaults to true
        if storage.object(forKey: Keys.autoSyncEnabled) == nil {
            autoSyncEnabled = true
        } else {
            autoSyncEnabled = storage.bool(forKey: Keys.autoSyncEnabled)
        }

        // Appearance preferences
        if let schemeRaw = storage.string(forKey: Keys.appColorScheme),
           let scheme = AppColorScheme(rawValue: schemeRaw) {
            appColorScheme = scheme
        } else {
            appColorScheme = .system
        }

        if let accentRaw = storage.string(forKey: Keys.accentColor),
           let accent = AccentColorChoice(rawValue: accentRaw) {
            accentColorChoice = accent
        } else {
            accentColorChoice = .blue
        }

        biometricLockEnabled = storage.bool(forKey: Keys.biometricLockEnabled)

        if let smartData = storage.data(forKey: Keys.smartFolders),
           let decoded = try? JSONDecoder().decode([SmartFolder].self, from: smartData) {
            smartFolders = decoded
        } else {
            smartFolders = []
        }

        if let storedOrder = storage.stringArray(forKey: Keys.tabOrder) {
            tabOrder = AppTab.normalizedOrder(from: storedOrder)
        } else {
            tabOrder = AppTab.defaultOrder
        }

        if let storedHidden = storage.stringArray(forKey: Keys.hiddenTabs) {
            hiddenTabs = Set(storedHidden.compactMap(AppTab.init(rawValue:)).filter { !$0.isPinned })
        } else {
            hiddenTabs = []
        }

        focusedSetOrder = FocusedSetOrder.normalized(
            storage.stringArray(forKey: Keys.focusedSetIDs) ?? []
        )
        setCompletionMode = SetCompletionMode(
            rawValue: storage.string(forKey: Keys.setCompletionMode) ?? ""
        ) ?? .standard
        setBrowserSort = SetBrowserSort(
            rawValue: storage.string(forKey: Keys.setBrowserSort) ?? ""
        ) ?? .newest

        if serverConfiguration.isOnDevice {
            enableLocalSession(force: false)
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
                self.serverFeatures = .allEnabled
                Task(priority: .utility) {
                    await CatalogStore.shared.configure(
                        enabledGames: configuration.isOnDevice ? self.enabledGames : []
                    )
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
                    KeychainTokenStore.deleteToken()
                    self?.authToken = nil
                }
            }
            .store(in: &cancellables)

        $isUsingSingleUserMode
            .dropFirst()
            .sink { [weak self] flag in
                self?.storage.set(flag, forKey: Keys.singleUserMode)
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
                CatalogStore.shared.setEnabled(
                    (self?.serverConfiguration.isOnDevice == true) && flag,
                    for: .yugioh
                )
            }
            .store(in: &cancellables)

        $enabledMagic
            .dropFirst()
            .sink { [weak self] flag in
                self?.storage.set(flag, forKey: Keys.enabledMagic)
                CatalogStore.shared.setEnabled(
                    (self?.serverConfiguration.isOnDevice == true) && flag,
                    for: .magic
                )
            }
            .store(in: &cancellables)

        $enabledPokemon
            .dropFirst()
            .sink { [weak self] flag in
                self?.storage.set(flag, forKey: Keys.enabledPokemon)
                CatalogStore.shared.setEnabled(
                    (self?.serverConfiguration.isOnDevice == true) && flag,
                    for: .pokemon
                )
            }
            .store(in: &cancellables)

        $enabledOnepiece
            .dropFirst()
            .sink { [weak self] flag in
                self?.storage.set(flag, forKey: Keys.enabledOnepiece)
                CatalogStore.shared.setEnabled(
                    (self?.serverConfiguration.isOnDevice == true) && flag,
                    for: .onepiece
                )
            }
            .store(in: &cancellables)

        $enabledLorcana
            .dropFirst()
            .sink { [weak self] flag in
                self?.storage.set(flag, forKey: Keys.enabledLorcana)
                CatalogStore.shared.setEnabled(
                    (self?.serverConfiguration.isOnDevice == true) && flag,
                    for: .lorcana
                )
            }
            .store(in: &cancellables)

        $enabledDragonball
            .dropFirst()
            .sink { [weak self] flag in
                self?.storage.set(flag, forKey: Keys.enabledDragonball)
                CatalogStore.shared.setEnabled(
                    (self?.serverConfiguration.isOnDevice == true) && flag,
                    for: .dragonball
                )
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

        $defaultGame
            .dropFirst()
            .sink { [weak self] value in
                if let value {
                    self?.storage.set(value, forKey: Keys.defaultGame)
                } else {
                    self?.storage.removeObject(forKey: Keys.defaultGame)
                }
            }
            .store(in: &cancellables)

        $appColorScheme
            .dropFirst()
            .sink { [weak self] value in
                self?.storage.set(value.rawValue, forKey: Keys.appColorScheme)
            }
            .store(in: &cancellables)

        $accentColorChoice
            .dropFirst()
            .sink { [weak self] value in
                self?.storage.set(value.rawValue, forKey: Keys.accentColor)
            }
            .store(in: &cancellables)

        $biometricLockEnabled
            .dropFirst()
            .sink { [weak self] value in
                self?.storage.set(value, forKey: Keys.biometricLockEnabled)
            }
            .store(in: &cancellables)

        $smartFolders
            .dropFirst()
            .sink { [weak self] value in
                if let data = try? JSONEncoder().encode(value) {
                    self?.storage.set(data, forKey: Keys.smartFolders)
                }
            }
            .store(in: &cancellables)

        $tabOrder
            .dropFirst()
            .sink { [weak self] value in
                self?.storage.set(value.map(\.rawValue), forKey: Keys.tabOrder)
            }
            .store(in: &cancellables)

        $hiddenTabs
            .dropFirst()
            .sink { [weak self] value in
                self?.storage.set(value.map(\.rawValue).sorted(), forKey: Keys.hiddenTabs)
            }
            .store(in: &cancellables)

        $focusedSetOrder
            .dropFirst()
            .sink { [weak self] value in
                self?.storage.set(value, forKey: Keys.focusedSetIDs)
            }
            .store(in: &cancellables)

        $setCompletionMode
            .dropFirst()
            .sink { [weak self] value in
                self?.storage.set(value.rawValue, forKey: Keys.setCompletionMode)
            }
            .store(in: &cancellables)

        $setBrowserSort
            .dropFirst()
            .sink { [weak self] value in
                self?.storage.set(value.rawValue, forKey: Keys.setBrowserSort)
            }
            .store(in: &cancellables)

        Task(priority: .utility) {
            await CatalogStore.shared.configure(
                enabledGames: serverConfiguration.isOnDevice ? enabledGames : []
            )
        }
    }

    var enabledGames: [TCGGame] {
        var games: [TCGGame] = []
        if enabledYugioh { games.append(.yugioh) }
        if enabledMagic { games.append(.magic) }
        if enabledPokemon { games.append(.pokemon) }
        if enabledOnepiece { games.append(.onepiece) }
        if enabledLorcana { games.append(.lorcana) }
        if enabledDragonball { games.append(.dragonball) }
        return games
    }

    // MARK: - Tab Bar

    var availableTabs: [AppTab] {
        tabOrder.filter { $0.isSupported(by: serverFeatures) }
    }

    /// Tabs the user wants in the bar, in their chosen order. Authentication
    /// and access-policy availability are applied separately by `ContentView`.
    var visibleTabs: [AppTab] {
        availableTabs.filter { !hiddenTabs.contains($0) }
    }

    func isTabVisible(_ tab: AppTab) -> Bool {
        !hiddenTabs.contains(tab)
    }

    func setTab(_ tab: AppTab, visible: Bool) {
        guard !tab.isPinned else { return }
        if visible {
            hiddenTabs.remove(tab)
        } else {
            hiddenTabs.insert(tab)
        }
    }

    func moveAvailableTabs(fromOffsets source: IndexSet, toOffset destination: Int) {
        var reordered = availableTabs
        reordered.move(fromOffsets: source, toOffset: destination)
        var iterator = reordered.makeIterator()
        tabOrder = tabOrder.map { tab in
            tab.isSupported(by: serverFeatures) ? (iterator.next() ?? tab) : tab
        }
    }

    func resetTabBar() {
        tabOrder = AppTab.defaultOrder
        hiddenTabs = []
    }

    // MARK: - Focused Sets

    var focusedSetIDs: Set<String> {
        Set(focusedSetOrder)
    }

    func isFocused(on set: TcgSet) -> Bool {
        focusedSetIDs.contains(set.focusID)
    }

    func setFocus(on set: TcgSet, focused: Bool) {
        if focused {
            if !focusedSetIDs.contains(set.focusID) {
                focusedSetOrder.append(set.focusID)
            }
        } else {
            focusedSetOrder.removeAll { $0 == set.focusID }
        }
        queueSetPreferencesSync()
    }

    func toggleFocus(on set: TcgSet) {
        setFocus(on: set, focused: !isFocused(on: set))
    }

    func replaceFocusedSetOrder(_ order: [String]) {
        focusedSetOrder = FocusedSetOrder.normalized(order)
        queueSetPreferencesSync()
    }

    func updateSetCompletionMode(_ mode: SetCompletionMode) {
        guard setCompletionMode != mode else { return }
        setCompletionMode = mode
        queueSetPreferencesSync()
    }

    private func queueSetPreferencesSync() {
        setPreferencesSyncTask?.cancel()
        let order = focusedSetOrder
        let completionMode = setCompletionMode
        let configuration = serverConfiguration
        guard let token = authToken else { return }

        setPreferencesSyncTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            _ = try? await APIService().updateUserPreferences(
                config: configuration,
                token: token,
                focusedSetOrder: order,
                setCompletionMode: completionMode.rawValue
            )
            self?.setPreferencesSyncTask = nil
        }
    }

    func isGameEnabled(_ game: TCGGame) -> Bool {
        switch game {
        case .all: return true
        case .yugioh: return enabledYugioh
        case .magic: return enabledMagic
        case .pokemon: return enabledPokemon
        case .onepiece: return enabledOnepiece
        case .lorcana: return enabledLorcana
        case .dragonball: return enabledDragonball
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
        if let enabledOnepiece = user.enabledOnepiece {
            self.enabledOnepiece = enabledOnepiece
        }
        if let enabledLorcana = user.enabledLorcana {
            self.enabledLorcana = enabledLorcana
        }
        if let enabledDragonball = user.enabledDragonball {
            self.enabledDragonball = enabledDragonball
        }
        defaultGame = user.defaultGame
    }

    func applyUserProfile(_ profile: APIService.UserProfile) {
        currentUser = User(
            id: profile.id,
            email: profile.email,
            name: profile.username,
            username: profile.username,
            isAdmin: profile.isAdmin,
            showCardNumbers: profile.showCardNumbers,
            showPricing: profile.showPricing,
            enabledYugioh: nil,
            enabledMagic: nil,
            enabledPokemon: nil,
            enabledOnepiece: nil,
            enabledLorcana: nil,
            enabledDragonball: nil,
            defaultGame: nil
        )
    }

    func applyAppSettings(_ settings: AppSettings) {
        appSettings = settings
    }

    func signOut() {
        isUsingSingleUserMode = false
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
        serverFeatures = .allEnabled
        isServerVerified = false
        enabledYugioh = true
        enabledMagic = true
        enabledPokemon = true
        enabledOnepiece = false
        enabledLorcana = false
        enabledDragonball = false
        showCardNumbers = true
        showPricing = true
        defaultGame = nil
        offlineModeEnabled = false
        autoSyncEnabled = true
        appColorScheme = .system
        accentColorChoice = .blue
        biometricLockEnabled = false
        smartFolders = []
        tabOrder = AppTab.defaultOrder
        hiddenTabs = []
        focusedSetOrder = []
        setCompletionMode = .standard
        setBrowserSort = .newest
        storage.removeObject(forKey: Keys.tabOrder)
        storage.removeObject(forKey: Keys.hiddenTabs)
        storage.removeObject(forKey: Keys.focusedSetIDs)
        storage.removeObject(forKey: Keys.setCompletionMode)
        storage.removeObject(forKey: Keys.setBrowserSort)
        storage.removeObject(forKey: Keys.server)
        storage.removeObject(forKey: Keys.credentials)
        storage.removeObject(forKey: Keys.token)
        storage.removeObject(forKey: Keys.singleUserMode)
        KeychainTokenStore.deleteToken()
        storage.set(false, forKey: Keys.authenticated)
        storage.set(false, forKey: Keys.verified)
        storage.removeObject(forKey: Keys.showCardNumbers)
        storage.removeObject(forKey: Keys.showPricing)
        storage.removeObject(forKey: Keys.defaultGame)
        storage.removeObject(forKey: Keys.offlineModeEnabled)
        storage.removeObject(forKey: Keys.autoSyncEnabled)
        storage.removeObject(forKey: Keys.appColorScheme)
        storage.removeObject(forKey: Keys.accentColor)
        storage.removeObject(forKey: Keys.biometricLockEnabled)
        storage.removeObject(forKey: Keys.smartFolders)
    }

    func applyUserPreferences(_ preferences: APIService.UserPreferences) {
        showCardNumbers = preferences.showCardNumbers
        showPricing = preferences.showPricing
        enabledYugioh = preferences.enabledYugioh
        enabledMagic = preferences.enabledMagic
        enabledPokemon = preferences.enabledPokemon
        enabledOnepiece = preferences.enabledOnepiece
        enabledLorcana = preferences.enabledLorcana
        enabledDragonball = preferences.enabledDragonball
        defaultGame = preferences.defaultGame
        focusedSetOrder = FocusedSetOrder.normalized(preferences.focusedSetOrder)
        setCompletionMode = SetCompletionMode(rawValue: preferences.setCompletionMode) ?? .standard
    }

    // MARK: - Widget Data

    static let appGroupSuite = "group.firstform.TCGer.shared"

    func updateWidgetData(collections: [Collection]) {
        guard let shared = UserDefaults(suiteName: Self.appGroupSuite) else { return }

        let totalBinders = collections.filter { !$0.isUnsortedBinder }.count
        let uniqueCards = collections.reduce(0) { $0 + $1.cards.count }
        let totalCopies = collections.reduce(0) { sum, col in
            sum + col.cards.reduce(0) { $0 + $1.quantity }
        }

        shared.set(totalBinders, forKey: "widget.totalBinders")
        shared.set(uniqueCards, forKey: "widget.uniqueCards")
        shared.set(totalCopies, forKey: "widget.totalCopies")
        shared.set(Date().timeIntervalSince1970, forKey: "widget.lastUpdated")

        // Recent cards (last 5 from each collection)
        let recentCards: [[String: String]] = collections
            .flatMap(\.cards)
            .prefix(5)
            .map { card in
                var dict: [String: String] = ["name": card.name, "tcg": card.tcg]
                if let setName = card.setName { dict["setName"] = setName }
                if let img = card.imageUrlSmall ?? card.imageUrl { dict["imageUrl"] = img }
                return dict
            }
        if let encoded = try? JSONSerialization.data(withJSONObject: recentCards) {
            shared.set(encoded, forKey: "widget.recentCards")
        }

        WidgetCenter.shared.reloadAllTimelines()
    }

    func enableLocalSession(force: Bool) {
        guard serverConfiguration.isOnDevice else { return }

        isUsingSingleUserMode = false
        serverFeatures = .allEnabled

        // Installs configured before phone-only mode was split from demo mode
        // still hold the old marker token; swap it for the local one.
        if force || authToken == nil || authToken == LocalDefaults.legacyToken {
            storeToken(LocalDefaults.token)
        }

        if force || currentUser == nil || currentUser?.id == LocalDefaults.legacyUserId {
            currentUser = User(
                id: LocalDefaults.userId,
                email: LocalDefaults.email,
                name: LocalDefaults.username,
                username: LocalDefaults.username,
                isAdmin: false,
                showCardNumbers: showCardNumbers,
                showPricing: showPricing,
                enabledYugioh: enabledYugioh,
                enabledMagic: enabledMagic,
                enabledPokemon: enabledPokemon,
                enabledOnepiece: enabledOnepiece,
                enabledLorcana: enabledLorcana,
                enabledDragonball: enabledDragonball,
                defaultGame: defaultGame
            )
        }

        if force || appSettings == nil || appSettings?.appName == "TCGer Demo" {
            appSettings = AppSettings(
                id: 0,
                publicDashboard: true,
                publicCollections: true,
                requireAuth: false,
                appName: "TCGer",
                updatedAt: ISO8601DateFormatter().string(from: Date())
            )
        }

        if force || !isAuthenticated {
            isAuthenticated = true
            storage.set(true, forKey: Keys.authenticated)
        }

        isServerVerified = true
        storage.set(true, forKey: Keys.verified)
    }

    func enableSingleUserSession(profile: APIService.UserProfile) {
        credentials = LoginCredentials(
            username: profile.username ?? credentials.username,
            password: ""
        )
        currentUser = User(
            id: profile.id,
            email: profile.email,
            name: profile.username,
            username: profile.username,
            isAdmin: profile.isAdmin,
            showCardNumbers: profile.showCardNumbers,
            showPricing: profile.showPricing,
            enabledYugioh: enabledYugioh,
            enabledMagic: enabledMagic,
            enabledPokemon: enabledPokemon,
            enabledOnepiece: enabledOnepiece,
            enabledLorcana: enabledLorcana,
            enabledDragonball: enabledDragonball,
            defaultGame: defaultGame
        )
        isUsingSingleUserMode = true
        storeToken(SingleUserDefaults.token)
        isAuthenticated = true
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
