//
//  SettingsView.swift
//  TCGer
//

import SwiftUI

struct SettingsView: View {
    let parentProvidesNavigation: Bool

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @AppStorage("cardScannerShowTestingTools") private var showScannerTestingTools = false
    @AppStorage("developerToolsUnlocked") private var developerToolsUnlocked = false
    @AppStorage(ScannerDevModeStore.enabledDefaultsKey) private var scannerDevModeRecordingEnabled = false
    @AppStorage(ScannerDevModeStore.cropRescueEnabledDefaultsKey) private var scannerCropRescueEnabled = false
    @AppStorage(ScannerPerfOptions.ocrEnabledDefaultsKey) private var scannerOCREnabled = true
    @StateObject private var networkMonitor = NetworkMonitor.shared
    @StateObject private var catalogStore = CatalogStore.shared
    @StateObject private var scannerAssets = ScannerAssetStore.shared
    @StateObject private var offlinePackDownloads = PackOfflineDownloadManager.shared
    @StateObject private var gamePackages = GamePackageStore.shared
    @State private var serverStatus: ServerStatusState = .checking
    @State private var showingResetAlert = false
    @State private var isApplyingRemotePreferences = false
    @State private var showingProfile = false
    @State private var showingDeleteServerAccount = false
    @State private var showingClearCacheAlert = false
    @State private var cacheSize: String = "Calculating..."
    @State private var lastSyncDate: Date?
    @State private var isSyncing = false
    @State private var isLoadingAppSettings = false
    @State private var isUpdatingAppSettings = false
    @State private var appSettingsError: String?
    @State private var isExporting = false
    @State private var showingExportSheet = false
    @State private var exportData: Data?
    @State private var exportFilename: String?
    @State private var gameDisableBlock: GameDisableBlock?
    @State private var gameDisableCheckError: String?
    @State private var gamesBeingUpdated: Set<TCGGame> = []
    @State private var pendingCatalogInstall: TCGGame?
    @State private var catalogInstallError: String?
    @State private var sampleDataLoaded = false
    @State private var localBackupURLs: [URL] = []
    @State private var localDataMessage: String?
    @State private var showingRemoveSampleAlert = false
    @State private var showingEraseLocalDataAlert = false
    @State private var showingHideDeveloperToolsAlert = false
    @State private var versionTapCount = 0

    init(parentProvidesNavigation: Bool = false) {
        self.parentProvidesNavigation = parentProvidesNavigation
    }

    /// True when running fully on-device with no backend server.
    private var isLocalMode: Bool {
        environmentStore.serverConfiguration.isOnDevice
    }

    /// Developer tools stay hidden in every build until the About → Version
    /// row is tapped `versionTapsToUnlock` times. Keeping debug builds on the
    /// same path makes it possible to verify the customer-facing Settings UI.
    private var showDeveloperTools: Bool {
        developerToolsUnlocked
    }

    private static let versionTapsToUnlock = 7
    private static let privacyPolicyURL = URL(string: "https://tcger.ahmadjalil.com/privacy/")!
    private static let supportURL = URL(string: "https://tcger.ahmadjalil.com/support/")!

    /// Marketing version + build from the bundle, so the About row reflects the
    /// installed binary instead of a hardcoded string.
    private var appVersionString: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        guard let build = info?["CFBundleVersion"] as? String, build != short else {
            return short
        }
        return "\(short) (\(build))"
    }

    private func registerVersionTap() {
        guard !developerToolsUnlocked else { return }
        versionTapCount += 1

        if versionTapCount >= Self.versionTapsToUnlock {
            versionTapCount = 0
            developerToolsUnlocked = true
            HapticManager.notification(.success)
        } else if versionTapCount >= Self.versionTapsToUnlock - 3 {
            HapticManager.selection()
        }
    }

    private func hideDeveloperTools() {
        developerToolsUnlocked = false
        showScannerTestingTools = false
        scannerDevModeRecordingEnabled = false
        scannerCropRescueEnabled = false
        versionTapCount = 0
        HapticManager.notification(.success)
    }

    /// Phone-only mode has no account, so preferences are always editable;
    /// against a server they need a session.
    private var canEditPreferences: Bool {
        isLocalMode || environmentStore.isAuthenticated
    }

    var body: some View {
        Group {
            if parentProvidesNavigation {
                settingsContent
            } else {
                NavigationStack {
                    settingsContent
                }
            }
        }
    }

    private var settingsContent: some View {
        List {
                // Account Section — a server concept; phone-only mode has no
                // account, profile, or sign-in state to show.
                if !isLocalMode {
                    Section {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(displayEmail)
                                    .font(.headline)
                                if environmentStore.isAuthenticated {
                                    Text("Signed in")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                } else {
                                    Text("Guest access")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                            Spacer()
                            Image(systemName: "person.circle.fill")
                                .font(.title)
                                .foregroundColor(.accentColor)
                        }
                        .padding(.vertical, 4)

                        if environmentStore.isAuthenticated {
                            Button(action: { showingProfile = true }) {
                                HStack {
                                    Image(systemName: "person.text.rectangle")
                                        .foregroundColor(.accentColor)
                                    Text("View Profile")
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }

                            if environmentStore.isCurrentUserAdmin {
                                Label("Administrator", systemImage: "checkmark.shield.fill")
                                    .font(.caption)
                                    .foregroundColor(.blue)
                            }

                            if !environmentStore.isUsingSingleUserMode {
                                Button("Delete Server Account", role: .destructive) {
                                    showingDeleteServerAccount = true
                                }
                            }
                        }
                    } header: {
                        Text("Account")
                    }
                }

                // Appearance Section
                Section {
                    Picker("Theme", selection: $environmentStore.appColorScheme) {
                        ForEach(AppColorScheme.allCases) { scheme in
                            Text(scheme.displayName).tag(scheme)
                        }
                    }
                    .pickerStyle(.segmented)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Accent Color")
                            .font(.subheadline)
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 5), spacing: 12) {
                            ForEach(AccentColorChoice.allCases) { accent in
                                Button {
                                    environmentStore.accentColorChoice = accent
                                } label: {
                                    Circle()
                                        .fill(accent.color)
                                        .frame(width: 36, height: 36)
                                        .overlay(
                                            Circle()
                                                .strokeBorder(Color.primary, lineWidth: environmentStore.accentColorChoice == accent ? 2.5 : 0)
                                        )
                                        .overlay(
                                            Group {
                                                if environmentStore.accentColorChoice == accent {
                                                    Image(systemName: "checkmark")
                                                        .font(.caption.bold())
                                                        .foregroundColor(.white)
                                                }
                                            }
                                        )
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(accent.displayName)
                                .accessibilityAddTraits(
                                    environmentStore.accentColorChoice == accent ? .isSelected : []
                                )
                            }
                        }
                    }
                    .padding(.vertical, 4)

                    NavigationLink {
                        TabBarCustomizationView()
                            .environmentObject(environmentStore)
                    } label: {
                        HStack {
                            Image(systemName: "square.grid.2x2")
                                .foregroundColor(.accentColor)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Customize Tab Bar")
                                Text(tabBarSummary)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                } header: {
                    Text("Appearance & Layout")
                }

                // Connection Section
                Section {
                    HStack {
                        Text("Mode")
                        Spacer()
                        Text(isLocalMode ? "On this phone" : "Server")
                            .foregroundColor(.secondary)
                    }
                    if !isLocalMode {
                        HStack {
                            Text("Base URL")
                            Spacer()
                            Text(environmentStore.serverConfiguration.baseURL.isEmpty ? "Not set" : environmentStore.serverConfiguration.baseURL)
                                .foregroundColor(.secondary)
                                .multilineTextAlignment(.trailing)
                                .lineLimit(1)
                        }
                    }
                    Button(isLocalMode ? "Connect to a Server" : "Reconfigure Connection") {
                        environmentStore.serverConfiguration = .empty
                        environmentStore.signOut()
                    }
                } header: {
                    Text("Connection")
                } footer: {
                    Text(isLocalMode
                        ? "Your collection lives entirely on this phone. Connect to a TCG Manager server if you want to sync across devices."
                        : "Change your TCG Manager server connection, or switch to keeping everything on this phone.")
                }

                // TCG Modules Section
                Section {
                    ForEach(TCGGame.allCases.filter { $0 != .all }) { game in
                        TCGModuleToggleRow(
                            game: game,
                            isOn: environmentStore.isGameEnabled(game),
                            isEnabled: canEditPreferences,
                            isUpdating: gamesBeingUpdated.contains(game)
                        ) { isOn in
                            guard !gamesBeingUpdated.contains(game) else { return }
                            gamesBeingUpdated.insert(game)
                            Task {
                                await handleGameToggle(
                                    game: game,
                                    isOn: isOn
                                )
                                gamesBeingUpdated.remove(game)
                            }
                        }

                        if TCGGame.catalogGames.contains(game) {
                            catalogInstallProgress(for: game)
                        }
                    }
                } header: {
                    Text("Games")
                } footer: {
                    Text("Enable or disable specific TCG games in search and analytics. A game can't be turned off while you still have its cards in a collection or wishlist.")
                }

                if isLocalMode {
                    Section {
                        Toggle(isOn: $environmentStore.sealedProductsEnabled) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Sealed Products")
                                Text("Download searchable boxes, packs, decks, and other sealed products")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        ForEach(TCGGame.catalogGames) { game in
                            CatalogInstallRow(
                                game: game,
                                catalogStore: catalogStore,
                                includeSealedProducts: environmentStore.sealedProductsEnabled
                            )
                        }
                    } header: {
                        Text("Offline Catalogs")
                    } footer: {
                        Text(environmentStore.sealedProductsEnabled
                            ? "Each game downloads separately. Turning off Sealed Products removes its optional product catalogs but keeps your sealed inventory."
                            : "Only card catalogs are downloaded. Each game stays separate, and removing one never removes your saved cards.")
                    }
                }

                Section {
                    Toggle(isOn: $scannerOCREnabled) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Use OCR for Difficult Scans")
                            Text("Read card titles and collector numbers only when visual matching is uncertain")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    ForEach(ScannerAssetStore.downloadableGames) { game in
                        ScannerAssetInstallRow(game: game, store: scannerAssets)
                    }
                } header: {
                    Text("Offline Scanner Models")
                } footer: {
                    Text("OCR is enabled by default and runs only on difficult intentional captures. Turning it off can make scans faster, but may reduce card and exact-print accuracy. Scanner models run entirely on this phone.")
                }

                CommunityGameLibrariesSection(store: gamePackages)

                // Display Preferences Section
                Section {
                    Toggle(isOn: $environmentStore.showCardNumbers) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Show Card Numbers")
                            Text("Display set codes with card names")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    .disabled(!canEditPreferences)
                    .onChange(of: environmentStore.showCardNumbers) {
                        Task { await updatePreferences(showCardNumbers: environmentStore.showCardNumbers) }
                    }

                    Toggle(isOn: $environmentStore.showPricing) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Show Pricing")
                            Text("Display estimated card values")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    .disabled(!canEditPreferences)
                    .onChange(of: environmentStore.showPricing) {
                        Task { await updatePreferences(showPricing: environmentStore.showPricing) }
                    }

                    NavigationLink {
                        CurrencySettingsView()
                            .environmentObject(environmentStore)
                    } label: {
                        LabeledContent("Display Currency", value: environmentStore.displayCurrencyCode)
                    }

                    if environmentStore.shouldShowGamePicker {
                        Picker("Default Game", selection: Binding(
                            get: { environmentStore.defaultGame ?? "" },
                            set: { value in
                                environmentStore.defaultGame = value.isEmpty ? nil : value
                                Task {
                                    await updatePreferences(
                                        defaultGame: .some(value.isEmpty ? nil : value)
                                    )
                                }
                            }
                        )) {
                            Text("None").tag("")
                            ForEach(TCGGame.allCases.filter { $0 != .all }) { game in
                                Text(game.displayName).tag(game.rawValue)
                            }
                        }
                        .disabled(!canEditPreferences)
                    }
                } header: {
                    Text("Card Display")
                }

                if isLocalMode || (environmentStore.isAuthenticated && environmentStore.isCurrentUserAdmin) {
                    Section {
                        NavigationLink {
                            PricingSourceSettingsView()
                                .environmentObject(environmentStore)
                        } label: {
                            HStack {
                                Image(systemName: "chart.line.uptrend.xyaxis")
                                    .foregroundColor(.green)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("Pricing Source")
                                    Text(environmentStore.gamePricingSources.isEmpty
                                        ? environmentStore.pricingSource.displayName
                                        : "Custom priorities for \(environmentStore.gamePricingSources.count) game\(environmentStore.gamePricingSources.count == 1 ? "" : "s")")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    } header: {
                        Text("Pricing")
                    } footer: {
                        Text(isLocalMode
                            ? "Phone-only mode shows only providers that can run safely on this iPhone."
                            : "Only pricing providers configured and advertised by this server appear here.")
                    }
                }

                // Security Section
                if BiometricAuthManager.isAvailable {
                    Section {
                        Toggle(isOn: $environmentStore.biometricLockEnabled) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Require \(BiometricAuthManager.displayName)")
                                Text("Lock the app when backgrounded")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                    } header: {
                        Text("Security")
                    }
                }

                // Admin Access Policy governs who may reach a shared server, so
                // it is meaningless when everything lives on this phone.
                if !isLocalMode && environmentStore.isAuthenticated && environmentStore.isCurrentUserAdmin {
                    Section {
                        if isLoadingAppSettings {
                            HStack {
                                Spacer()
                                ProgressView()
                                Spacer()
                            }
                        } else if environmentStore.appSettings != nil {
                            Toggle(isOn: Binding(
                                get: { environmentStore.appSettings?.publicDashboard ?? false },
                                set: { value in
                                    Task { await updateAppSettings(publicDashboard: value) }
                                }
                            )) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Public Dashboard")
                                    Text("Allow dashboard access without signing in")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                            .disabled(isUpdatingAppSettings)

                            Toggle(isOn: Binding(
                                get: { environmentStore.appSettings?.publicCollections ?? false },
                                set: { value in
                                    Task { await updateAppSettings(publicCollections: value) }
                                }
                            )) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Public Collections")
                                    Text("Allow collection browsing without signing in")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                            .disabled(isUpdatingAppSettings)

                            Toggle(isOn: Binding(
                                get: { environmentStore.appSettings?.requireAuth ?? false },
                                set: { value in
                                    Task { await updateAppSettings(requireAuth: value) }
                                }
                            )) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Require Authentication")
                                    Text("Force sign-in before using app features")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                            .disabled(isUpdatingAppSettings)
                        } else {
                            Text("Unable to load admin settings.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }

                        if let appSettingsError {
                            Text(appSettingsError)
                                .font(.caption)
                                .foregroundColor(.red)
                        }
                    } header: {
                        Text("Server Access")
                    } footer: {
                        Text("These settings mirror web access policy options.")
                    }
                }

                // Finance Section
                if canEditPreferences && environmentStore.serverFeatures.finance {
                    Section {
                        NavigationLink {
                            TransactionsView()
                                .environmentObject(environmentStore)
                        } label: {
                            HStack {
                                Image(systemName: "dollarsign.circle")
                                    .foregroundColor(.green)
                                Text("Transaction History")
                            }
                        }
                    } header: {
                        Text("Finance")
                    }
                }

                // Sample Data Section — opt-in demo content, kept separate from
                // the real collection stored on this phone.
                if isLocalMode {
                    Section {
                        if sampleDataLoaded {
                            Button("Remove Sample Data", role: .destructive) {
                                showingRemoveSampleAlert = true
                            }
                        } else {
                            Button {
                                LocalStore.shared.loadSampleData()
                                environmentStore.loadSampleSmartFolders()
                                sampleDataLoaded = LocalStore.shared.isSampleDataLoaded
                            } label: {
                                Label("Load Sample Data", systemImage: "sparkles")
                            }
                        }
                    } header: {
                        Text("Sample Data")
                    } footer: {
                        Text(sampleDataLoaded
                            ? "Sample binders, wishlists, sealed items, Code Vault entries, and transactions are loaded. Removing them leaves everything you added untouched."
                            : "Adds example binders, wishlists, sealed items, Code Vault entries, and transactions so you can try the app out. Your own data is never affected.")
                    }
                }

                OfflinePackDownloadsSection(manager: offlinePackDownloads)

                // Data & Sync Section
                Section {
                    if !isLocalMode {
                        Button(action: { Task { await refreshServerStatus() } }) {
                            HStack {
                                Text("Connection Status")
                                Spacer()
                                if serverStatus == .checking {
                                    ProgressView()
                                        .progressViewStyle(.circular)
                                        .scaleEffect(0.8)
                                } else {
                                    HStack(spacing: 6) {
                                        Circle()
                                            .fill(serverStatus.color)
                                            .frame(width: 8, height: 8)
                                        Text(serverStatus.label)
                                            .foregroundColor(.secondary)
                                            .font(.caption)
                                    }
                                }
                            }
                        }
                        .buttonStyle(.plain)

                        Toggle(isOn: $environmentStore.offlineModeEnabled) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Offline Mode")
                                Text("Cache data for offline viewing")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                        .disabled(!canEditPreferences)

                        if let lastSync = lastSyncDate {
                            HStack {
                                Text("Last Synced")
                                Spacer()
                                Text(lastSync, style: .relative)
                                    .foregroundColor(.secondary)
                            }
                        }

                        // Sync Now Button
                        Button(action: { Task { await syncNow() } }) {
                            HStack {
                                Text(isSyncing ? "Syncing..." : "Sync Now")
                                Spacer()
                                if isSyncing {
                                    ProgressView()
                                        .scaleEffect(0.8)
                                } else {
                                    Image(systemName: "arrow.clockwise")
                                        .foregroundColor(.accentColor)
                                }
                            }
                        }
                        .disabled(!environmentStore.isAuthenticated || serverStatus != .online || isSyncing)
                    } else {
                        HStack {
                            Text("Storage")
                            Spacer()
                            Text("On this phone")
                                .foregroundColor(.secondary)
                                .font(.caption)
                        }
                    }

                    // Cache Info
                    HStack {
                        Text("Offline Cache")
                        Spacer()
                        Text(cacheSize)
                            .foregroundColor(.secondary)
                    }

                    // Clear Cache Button
                    Button("Clear Offline Cache", role: .destructive) {
                        showingClearCacheAlert = true
                    }
                } header: {
                    Text("Data & Storage")
                } footer: {
                    Text(isLocalMode
                        ? "Your collection is stored locally on this phone. Clearing this cache removes downloaded artwork and offline pack sets, but not your collection."
                        : "Offline mode downloads your collections for viewing without internet. Clear cache to remove downloaded artwork and offline pack sets.")
                }

                // Export Section
                if canEditPreferences {
                    Section {
                        Button(action: { Task { await exportCollection(format: "json") } }) {
                            HStack {
                                Image(systemName: "square.and.arrow.up")
                                    .foregroundColor(.accentColor)
                                Text("Export as JSON")
                                Spacer()
                                if isExporting {
                                    ProgressView()
                                        .scaleEffect(0.8)
                                }
                            }
                        }
                        .disabled(isExporting)

                        Button(action: { Task { await exportCollection(format: "csv") } }) {
                            HStack {
                                Image(systemName: "tablecells")
                                    .foregroundColor(.accentColor)
                                Text("Export as CSV")
                                Spacer()
                                if isExporting {
                                    ProgressView()
                                        .scaleEffect(0.8)
                                }
                            }
                        }
                        .disabled(isExporting)

                        if environmentStore.serverFeatures.onlineCodes {
                            Button(action: { Task { await exportCodeVault() } }) {
                                HStack {
                                    Image(systemName: "key.viewfinder")
                                        .foregroundColor(.accentColor)
                                    Text("Export Code Vault")
                                    Spacer()
                                    if isExporting {
                                        ProgressView()
                                            .scaleEffect(0.8)
                                    }
                                }
                            }
                            .disabled(isExporting)
                        }
                    } header: {
                        Text("Export")
                    } footer: {
                        Text("Share collection files or a plain-text copy of your Code Vault.")
                    }
                }

                if isLocalMode {
                    Section {
                        NavigationLink {
                            LocalDataBackupView {
                                sampleDataLoaded = LocalStore.shared.isSampleDataLoaded
                                refreshLocalBackups()
                            }
                        } label: {
                            HStack {
                                Label("Backup & Restore", systemImage: "externaldrive")
                                Spacer()
                                Text("\(localBackupURLs.count) local")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    } header: {
                        Text("All Local Data")
                    } footer: {
                        Text("Export or import a complete portable backup, including your collection, binders, wishlists, Code Vault, sealed items, and transactions.")
                    }
                }

                // Actions Section
                Section {
                    if !isLocalMode {
                        Button("Sign Out", role: .destructive) {
                            environmentStore.signOut()
                        }
                        .disabled(!environmentStore.isAuthenticated)
                    }

                    Button("Reset All Settings", role: .destructive) {
                        showingResetAlert = true
                    }

                    if isLocalMode {
                        Button("Erase All Cards & Binders", role: .destructive) {
                            showingEraseLocalDataAlert = true
                        }
                    }
                } header: {
                    Text("Reset & Erase")
                } footer: {
                    if isLocalMode {
                        Text("Reset All Settings only clears preferences. Erasing removes every card, binder, wishlist, and transaction stored on this phone.")
                    }
                }

                // About stays immediately before Developer Tools so unlocking
                // adds content below the Version row instead of moving it.
                Section {
                    Link(destination: Self.privacyPolicyURL) {
                        Label("Privacy Policy", systemImage: "hand.raised")
                    }

                    Link(destination: Self.supportURL) {
                        Label("Support", systemImage: "questionmark.circle")
                    }

                    Button(action: registerVersionTap) {
                        HStack {
                            Text("Version")
                            Spacer()
                            Text(appVersionString)
                                .foregroundColor(.secondary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Version")
                    .accessibilityValue(appVersionString)
                    .accessibilityHint("Reveals developer tools after seven activations")
                } header: {
                    Text("About")
                }

                // Hidden in every build until the About → Version row is
                // tapped seven times.
                if showDeveloperTools {
                    Section {
                        NavigationLink {
                            ScannerDebugView()
                                .environmentObject(environmentStore)
                        } label: {
                            HStack {
                                Image(systemName: "ladybug")
                                    .foregroundColor(.purple)
                                Text("Live Scanner Debug")
                            }
                        }

                        Toggle(isOn: $showScannerTestingTools) {
                            Label("Scanner Testing Tools", systemImage: "wrench.and.screwdriver")
                        }

                        // Tester-facing recording of every scan for model
                        // retraining. Same section as the debug screen's copy,
                        // surfaced here so a tester never has to enter Live
                        // Scanner Debug to enable, review, or export.
                        ScannerDevModeSection(presentation: .settingsRows)

                        Button(role: .destructive) {
                            showingHideDeveloperToolsAlert = true
                        } label: {
                            Label("Hide Developer Tools", systemImage: "eye.slash")
                        }
                    } header: {
                        Text("Developer Tools")
                    }
                }
        }
        .navigationTitle("Settings")
            .task {
                sampleDataLoaded = LocalStore.shared.isSampleDataLoaded
                refreshLocalBackups()
                await refreshProfileIfNeeded()
                await refreshPreferencesIfNeeded()
                await refreshAppSettingsIfNeeded()
                updateCacheInfo()
                await refreshServerStatus()
            }
            .alert("Reset Configuration?", isPresented: $showingResetAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Reset", role: .destructive) {
                    environmentStore.resetEverything()
                }
            } message: {
                Text(isLocalMode
                    ? "This clears your app preferences and returns you to setup. Cards and binders stored on this phone are kept."
                    : "This will remove your server address, login credentials, and authentication token.")
            }
            .alert("Remove Sample Data?", isPresented: $showingRemoveSampleAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Remove", role: .destructive) {
                    LocalStore.shared.removeSampleData()
                    environmentStore.removeSampleSmartFolders()
                    sampleDataLoaded = LocalStore.shared.isSampleDataLoaded
                }
            } message: {
                Text("Removes the example binders, wishlists, sealed items, and transactions. Cards you added yourself stay where they are.")
            }
            .alert("Erase Everything on This Phone?", isPresented: $showingEraseLocalDataAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Erase", role: .destructive) {
                    LocalStore.shared.resetLocalData()
                    sampleDataLoaded = LocalStore.shared.isSampleDataLoaded
                    refreshLocalBackups()
                }
            } message: {
                Text("Every card, binder, wishlist, sealed item, and transaction stored on this phone is deleted. TCGer keeps a bounded local recovery point so you can restore the previous state from Settings.")
            }
            .alert(
                "Local Data",
                isPresented: Binding(
                    get: { localDataMessage != nil },
                    set: { if !$0 { localDataMessage = nil } }
                )
            ) {
                Button("OK", role: .cancel) { localDataMessage = nil }
            } message: {
                Text(localDataMessage ?? "")
            }
            .alert("Clear Cache?", isPresented: $showingClearCacheAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Clear", role: .destructive) {
                    clearCache()
                }
            } message: {
                Text("This removes cached artwork and downloaded offline pack sets. Your collection is not deleted.")
            }
            .alert("Hide Developer Tools?", isPresented: $showingHideDeveloperToolsAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Hide Tools", role: .destructive) {
                    hideDeveloperTools()
                }
            } message: {
                Text("Scanner testing tools, Adjust Card Corners, and dev-mode recording will be turned off. Recorded sessions will remain saved.")
            }
            .alert(
                "Remove \(gameDisableBlock?.displayName ?? "") cards first",
                isPresented: Binding(
                    get: { gameDisableBlock != nil },
                    set: { if !$0 { gameDisableBlock = nil } }
                ),
                presenting: gameDisableBlock
            ) { _ in
                Button("OK", role: .cancel) { gameDisableBlock = nil }
            } message: { block in
                Text(block.message)
            }
            .alert(
                "Couldn’t Check Saved Cards",
                isPresented: Binding(
                    get: { gameDisableCheckError != nil },
                    set: { if !$0 { gameDisableCheckError = nil } }
                )
            ) {
                Button("OK", role: .cancel) { gameDisableCheckError = nil }
            } message: {
                Text(gameDisableCheckError ?? "The game stayed enabled. Please try again.")
            }
            .alert(
                pendingCatalogInstall.map {
                    "Install the \($0.displayName) catalog (\(catalogPromptSize(for: $0)))?"
                } ?? "Install catalog?",
                isPresented: Binding(
                    get: { pendingCatalogInstall != nil },
                    set: { if !$0 { pendingCatalogInstall = nil } }
                ),
                presenting: pendingCatalogInstall
            ) { game in
                Button("Not Now", role: .cancel) {
                    pendingCatalogInstall = nil
                }
                Button("Install") {
                    pendingCatalogInstall = nil
                    installCatalog(game)
                }
            } message: { game in
                Text(environmentStore.sealedProductsEnabled
                    ? "This installs the separate card and sealed-product catalogs for this game."
                    : "This installs only the card catalog for this game.")
            }
            .alert(
                "Catalog Installation Failed",
                isPresented: Binding(
                    get: { catalogInstallError != nil },
                    set: { if !$0 { catalogInstallError = nil } }
                )
            ) {
                Button("OK", role: .cancel) {
                    catalogInstallError = nil
                }
            } message: {
                Text(catalogInstallError ?? "The catalog could not be installed.")
            }
            .sheet(isPresented: $showingProfile) {
                ProfileView()
                    .environmentObject(environmentStore)
            }
            .sheet(isPresented: $showingDeleteServerAccount) {
                DeleteServerAccountView()
                    .environmentObject(environmentStore)
            }
            .sheet(isPresented: $showingExportSheet) {
                if let data = exportData, let filename = exportFilename {
                    ExportShareSheet(data: data, filename: filename)
                }
            }
            .task(id: networkMonitor.isConnected) {
                let isConnected = networkMonitor.isConnected
                if isConnected {
                    await refreshServerStatus()
                } else {
                    await MainActor.run {
                        serverStatus = .offline
                    }
                }
            }
        .task(id: environmentStore.serverConfiguration.baseURL) {
            await refreshServerStatus()
            await refreshAppSettingsIfNeeded()
        }
    }

    private var tabBarSummary: String {
        environmentStore.visibleTabs.map(\.title).joined(separator: " · ")
    }

    private var displayEmail: String {
        if let email = environmentStore.currentUser?.email, !email.isEmpty {
            return email
        }
        if !environmentStore.credentials.username.isEmpty {
            return environmentStore.credentials.username
        }
        return "Not signed in"
    }

    private func updateCacheInfo() {
        cacheSize = CacheManager.shared.getFormattedCacheSize()
        lastSyncDate = CacheManager.shared.getLastSyncDate()
    }

    private func refreshLocalBackups() {
        guard isLocalMode else {
            localBackupURLs = []
            return
        }
        do {
            localBackupURLs = try LocalStore.shared.availableLocalBackups()
        } catch {
            localBackupURLs = []
            localDataMessage = "TCGer couldn’t read local recovery points: \(error.localizedDescription)"
        }
    }

    private func clearCache() {
        do {
            try CacheManager.shared.clearAll()
            offlinePackDownloads.refresh()
            updateCacheInfo()
        } catch {
            print("Failed to clear cache: \(error)")
        }
    }

    private func syncNow() async {
        guard environmentStore.isAuthenticated,
              let token = environmentStore.authToken else {
            return
        }

        isSyncing = true

        let api = APIService()

        do {
            // Fetch and cache collections
            _ = try await api.getCollections(
                config: environmentStore.serverConfiguration,
                token: token,
                useCache: false  // Force fresh fetch
            )

            updateCacheInfo()
            isSyncing = false
        } catch {
            print("Sync failed: \(error)")
            isSyncing = false
        }
    }
}

extension SettingsView {
    struct GameCardUsage {
        let collectionCount: Int
        let wishlistCount: Int
        let loadedCollections: Bool
        let loadedWishlists: Bool

        var isVerified: Bool {
            loadedCollections && loadedWishlists
        }
    }

    struct GameDisableBlock: Identifiable {
        let id = UUID()
        let game: String
        let displayName: String
        let collectionCount: Int
        let wishlistCount: Int

        var message: String {
            var parts: [String] = []
            if collectionCount > 0 {
                parts.append("\(collectionCount) in your collections")
            }
            if wishlistCount > 0 {
                parts.append("\(wishlistCount) in your wishlists")
            }
            let where_ = parts.joined(separator: " and ")
            return "You still have \(where_) for \(displayName). Remove those cards before turning this module off."
        }
    }
}

private extension SettingsView {
    /// Persist an enable, or block a disable that would orphan owned/wishlisted
    /// cards of that game.
    func handleGameToggle(game: TCGGame, isOn: Bool) async {
        guard !isApplyingRemotePreferences else { return }

        // Enabling never needs a guard.
        if isOn {
            if isLocalMode {
                setGameEnabled(game, enabled: true)
            } else {
                await updatePreferences(
                    enabledYugioh: game == .yugioh ? true : nil,
                    enabledMagic: game == .magic ? true : nil,
                    enabledPokemon: game == .pokemon ? true : nil,
                    enabledOnepiece: game == .onepiece ? true : nil,
                    enabledLorcana: game == .lorcana ? true : nil,
                    enabledDragonball: game == .dragonball ? true : nil
                )
            }
            if isLocalMode,
               TCGGame.catalogGames.contains(game),
               case .notInstalled = catalogStore.installState(for: game),
               catalogStore.isAvailable(game) {
                pendingCatalogInstall = game
            }
            return
        }

        let usage = await gameCardUsage(for: game)
        if usage.collectionCount + usage.wishlistCount > 0 {
            await MainActor.run {
                gameDisableBlock = GameDisableBlock(
                    game: game.rawValue,
                    displayName: game.displayName,
                    collectionCount: usage.collectionCount,
                    wishlistCount: usage.wishlistCount
                )
            }
            return
        }

        guard usage.isVerified else {
            await MainActor.run {
                gameDisableCheckError = "TCGer couldn’t verify your collections and wishlists, so \(game.displayName) stayed enabled. Check your connection and try again."
            }
            return
        }

        let disableSucceeded: Bool
        if isLocalMode {
            setGameEnabled(game, enabled: false)
            disableSucceeded = true
        } else {
            disableSucceeded = await updatePreferences(
                enabledYugioh: game == .yugioh ? false : nil,
                enabledMagic: game == .magic ? false : nil,
                enabledPokemon: game == .pokemon ? false : nil,
                enabledOnepiece: game == .onepiece ? false : nil,
                enabledLorcana: game == .lorcana ? false : nil,
                enabledDragonball: game == .dragonball ? false : nil
            )
        }

        if disableSucceeded && environmentStore.defaultGame == game.rawValue {
            await clearDefaultGameAfterDisabling()
        }
    }

    func clearDefaultGameAfterDisabling() async {
        await MainActor.run {
            environmentStore.defaultGame = nil
        }

        guard environmentStore.isAuthenticated,
              let token = environmentStore.authToken else { return }

        do {
            let preferences = try await APIService().updateUserPreferences(
                config: environmentStore.serverConfiguration,
                token: token,
                defaultGame: .some(nil)
            )
            await MainActor.run {
                isApplyingRemotePreferences = true
                environmentStore.applyUserPreferences(preferences)
                DispatchQueue.main.async {
                    isApplyingRemotePreferences = false
                }
            }
        } catch {
            print("Failed to clear disabled default game: \(error)")
            await refreshPreferencesIfNeeded()
        }
    }

    func setGameEnabled(_ game: TCGGame, enabled: Bool) {
        switch game {
        case .yugioh: environmentStore.enabledYugioh = enabled
        case .magic: environmentStore.enabledMagic = enabled
        case .pokemon: environmentStore.enabledPokemon = enabled
        case .onepiece: environmentStore.enabledOnepiece = enabled
        case .lorcana: environmentStore.enabledLorcana = enabled
        case .dragonball: environmentStore.enabledDragonball = enabled
        case .all: break
        }
    }

    @ViewBuilder
    func catalogInstallProgress(for game: TCGGame) -> some View {
        if catalogStore.installingGames.contains(game) {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(catalogStore.installStatus(for: game) ?? "Installing \(game.displayName) catalog")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text((catalogStore.installProgress[game] ?? 0).formatted(.percent.precision(.fractionLength(0))))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                ProgressView(value: catalogStore.installProgress[game] ?? 0)
            }
        }
    }

    func catalogPromptSize(for game: TCGGame) -> String {
        guard let metadata = catalogStore.metadata(for: game) else { return "size unavailable" }
        let cardBytes = metadata.compressedBytes ?? metadata.bytes
        let sealedBytes = environmentStore.sealedProductsEnabled
            ? catalogStore.sealedMetadata(for: game).map { $0.compressedBytes ?? $0.bytes } ?? 0
            : 0
        return "~\(ByteCountFormatter.string(fromByteCount: Int64(cardBytes + sealedBytes), countStyle: .file))"
    }

    func installCatalog(_ game: TCGGame) {
        Task {
            do {
                try await catalogStore.install(game)
                if environmentStore.sealedProductsEnabled,
                   catalogStore.isSealedAvailable(game) {
                    try await catalogStore.installSealed(game)
                }
            } catch {
                catalogInstallError = error.localizedDescription
            }
        }
    }

    /// Count cards of a game across collections and wishlists.
    func gameCardUsage(for game: TCGGame) async -> GameCardUsage {
        let api = APIService()
        let target = game.rawValue
        var collectionCount = 0
        var wishlistCount = 0
        var loadedCollections = false
        var loadedWishlists = false

        do {
            let collections = try await api.getCollections(
                config: environmentStore.serverConfiguration,
                token: environmentStore.authToken,
                useCache: environmentStore.offlineModeEnabled && environmentStore.isAuthenticated
            )
            collectionCount = collections.reduce(0) { total, collection in
                total + collection.cards
                    .filter { $0.tcg.lowercased() == target }
                    .reduce(0) { $0 + $1.quantity }
            }
            loadedCollections = true
        } catch {
            print("Game usage: failed to load collections: \(error)")
        }

        do {
            let wishlists = try await api.getWishlists(
                config: environmentStore.serverConfiguration,
                token: environmentStore.authToken ?? ""
            )
            wishlistCount = wishlists.reduce(0) { total, wishlist in
                total + wishlist.cards.filter { $0.tcg.lowercased() == target }.count
            }
            loadedWishlists = true
        } catch {
            print("Game usage: failed to load wishlists: \(error)")
        }

        return GameCardUsage(
            collectionCount: collectionCount,
            wishlistCount: wishlistCount,
            loadedCollections: loadedCollections,
            loadedWishlists: loadedWishlists
        )
    }

    enum ServerStatusState: Equatable {
        case checking
        case online
        case offline

        var label: String {
            switch self {
            case .checking: return "Checking..."
            case .online: return "Online"
            case .offline: return "Offline"
            }
        }

        var color: Color {
            switch self {
            case .checking: return .orange
            case .online: return .green
            case .offline: return .red
            }
        }
    }

    func refreshPreferencesIfNeeded() async {
        guard environmentStore.isAuthenticated,
              let token = environmentStore.authToken else {
            return
        }

        let api = APIService()

        do {
            let prefs = try await api.getUserPreferences(
                config: environmentStore.serverConfiguration,
                token: token
            )
            await MainActor.run {
                isApplyingRemotePreferences = true
                environmentStore.applyUserPreferences(prefs)
                DispatchQueue.main.async {
                    isApplyingRemotePreferences = false
                }
            }
        } catch {
            print("Failed to refresh preferences: \(error)")
        }
    }

    func refreshProfileIfNeeded() async {
        guard environmentStore.isAuthenticated,
              let token = environmentStore.authToken else {
            return
        }

        let api = APIService()

        do {
            let profile = try await api.getUserProfile(
                config: environmentStore.serverConfiguration,
                token: token
            )
            await MainActor.run {
                environmentStore.applyUserProfile(profile)
            }
        } catch {
            print("Failed to refresh user profile: \(error)")
        }
    }

    func refreshAppSettingsIfNeeded() async {
        guard environmentStore.serverConfiguration.isValid else {
            return
        }

        await MainActor.run {
            isLoadingAppSettings = true
            appSettingsError = nil
        }

        let api = APIService()

        do {
            let settings = try await api.getSettings(config: environmentStore.serverConfiguration)
            await MainActor.run {
                environmentStore.applyAppSettings(settings)
                isLoadingAppSettings = false
            }
        } catch {
            await MainActor.run {
                isLoadingAppSettings = false
                appSettingsError = error.localizedDescription
            }
        }
    }

    func updateAppSettings(
        publicDashboard: Bool? = nil,
        publicCollections: Bool? = nil,
        requireAuth: Bool? = nil
    ) async {
        guard environmentStore.isCurrentUserAdmin,
              let token = environmentStore.authToken else {
            return
        }

        await MainActor.run {
            isUpdatingAppSettings = true
            appSettingsError = nil
        }

        let api = APIService()

        do {
            let settings = try await api.updateSettings(
                config: environmentStore.serverConfiguration,
                token: token,
                publicDashboard: publicDashboard,
                publicCollections: publicCollections,
                requireAuth: requireAuth
            )
            await MainActor.run {
                environmentStore.applyAppSettings(settings)
                isUpdatingAppSettings = false
            }
        } catch {
            await MainActor.run {
                isUpdatingAppSettings = false
                appSettingsError = error.localizedDescription
            }
            await refreshAppSettingsIfNeeded()
        }
    }

    @discardableResult
    func updatePreferences(
        showCardNumbers: Bool? = nil,
        showPricing: Bool? = nil,
        enabledYugioh: Bool? = nil,
        enabledMagic: Bool? = nil,
        enabledPokemon: Bool? = nil,
        enabledOnepiece: Bool? = nil,
        enabledLorcana: Bool? = nil,
        enabledDragonball: Bool? = nil,
        defaultGame: String?? = nil
    ) async -> Bool {
        guard !isApplyingRemotePreferences,
              environmentStore.isAuthenticated,
              let token = environmentStore.authToken else {
            return false
        }

        let api = APIService()

        do {
            let prefs = try await api.updateUserPreferences(
                config: environmentStore.serverConfiguration,
                token: token,
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

            await MainActor.run {
                isApplyingRemotePreferences = true
                environmentStore.applyUserPreferences(prefs)
                DispatchQueue.main.async {
                    isApplyingRemotePreferences = false
                }
            }
            return true
        } catch {
            print("Failed to update preferences: \(error)")
            await refreshPreferencesIfNeeded()
            return false
        }
    }

    func refreshServerStatus() async {
        guard networkMonitor.isConnected,
              environmentStore.serverConfiguration.isValid else {
            await MainActor.run {
                serverStatus = .offline
            }
            return
        }

        await MainActor.run {
            serverStatus = .checking
        }

        let api = APIService()

        let reachable = await api.verifyServer(config: environmentStore.serverConfiguration)

        await MainActor.run {
            serverStatus = reachable ? .online : .offline
        }
    }

    func exportCollection(format: String) async {
        guard environmentStore.isAuthenticated,
              let token = environmentStore.authToken else {
            return
        }

        await MainActor.run {
            isExporting = true
        }

        let api = APIService()

        do {
            let data = try await api.exportCollection(
                config: environmentStore.serverConfiguration,
                token: token,
                format: format
            )
            let ext = format == "csv" ? "csv" : "json"
            let filename = "collection-export.\(ext)"

            await MainActor.run {
                exportData = data
                exportFilename = filename
                isExporting = false
                showingExportSheet = true
            }
        } catch {
            await MainActor.run {
                isExporting = false
            }
            print("Export failed: \(error)")
        }
    }

    func exportCodeVault() async {
        guard environmentStore.isAuthenticated,
              let token = environmentStore.authToken else {
            return
        }

        await MainActor.run { isExporting = true }

        do {
            let codes = try await APIService().getOnlineCodes(
                config: environmentStore.serverConfiguration,
                token: token
            )
            let groups = Dictionary(grouping: codes) { code in
                code.game?.displayName ?? code.tcg.capitalized
            }
            let text = groups.keys.sorted().flatMap { game in
                let values = groups[game, default: []].map { code in
                    "\(code.code)\t\(code.status.title)"
                }
                return ["# \(game)"] + values + [""]
            }
            .joined(separator: "\n")

            await MainActor.run {
                exportData = Data(text.utf8)
                exportFilename = "tcger-code-vault.txt"
                isExporting = false
                showingExportSheet = true
            }
        } catch {
            await MainActor.run { isExporting = false }
            print("Code Vault export failed: \(error)")
        }
    }
}

private struct TCGModuleToggleRow: View {
    let game: TCGGame
    let isOn: Bool
    let isEnabled: Bool
    let isUpdating: Bool
    let onChange: (Bool) -> Void

    var body: some View {
        Toggle(isOn: Binding(
            get: { isOn },
            set: onChange
        )) {
            HStack(spacing: 8) {
                TCGGameIcon(game: game, size: 20)
                    .foregroundStyle(game.brandColor)
                Text(game.displayName)
                if isUpdating {
                    ProgressView()
                        .controlSize(.small)
                }
            }
        }
        .disabled(!isEnabled || isUpdating)
    }
}

// MARK: - Export Share Sheet
private struct ExportShareSheet: UIViewControllerRepresentable {
    let data: Data
    let filename: String

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        try? data.write(to: tempURL)
        return UIActivityViewController(activityItems: [tempURL], applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
