//
//  SettingsView.swift
//  TCGer
//

import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @StateObject private var networkMonitor = NetworkMonitor.shared
    @State private var showingResetAlert = false
    @State private var isApplyingRemotePreferences = false
    @State private var showingProfile = false
    @State private var showingClearCacheAlert = false
    @State private var cacheSize: String = "Calculating..."
    @State private var lastSyncDate: Date?
    @State private var isSyncing = false

    var body: some View {
        NavigationView {
            List {
                // Account Section
                Section {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(environmentStore.credentials.email.isEmpty ? "Not signed in" : environmentStore.credentials.email)
                                .font(.headline)
                            if !environmentStore.credentials.email.isEmpty {
                                Text("Signed in")
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
                    }
                } header: {
                    Text("Account")
                }

                // Server Section
                Section {
                    HStack {
                        Text("Base URL")
                        Spacer()
                        Text(environmentStore.serverConfiguration.baseURL.isEmpty ? "Not set" : environmentStore.serverConfiguration.baseURL)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.trailing)
                            .lineLimit(1)
                    }
                    Button("Reconfigure Server") {
                        environmentStore.serverConfiguration = .empty
                        environmentStore.isAuthenticated = false
                    }
                } header: {
                    Text("Server")
                } footer: {
                    Text("Change your TCG Manager server connection")
                }

                // TCG Modules Section
                Section {
                    Toggle(isOn: $environmentStore.enabledYugioh) {
                        HStack {
                            Image("YugiohIcon")
                                .resizable()
                                .scaledToFit()
                                .frame(width: 20, height: 20)
                                .foregroundColor(.accentColor)
                            Text("Yu-Gi-Oh!")
                        }
                    }
                    .disabled(!environmentStore.isAuthenticated)
                    .onChange(of: environmentStore.enabledYugioh) {
                        Task { await updatePreferences(enabledYugioh: environmentStore.enabledYugioh) }
                    }

                    Toggle(isOn: $environmentStore.enabledMagic) {
                        HStack {
                            Image("MTGIcon")
                                .resizable()
                                .scaledToFit()
                                .frame(width: 20, height: 20)
                                .foregroundColor(.accentColor)
                            Text("Magic: The Gathering")
                        }
                    }
                    .disabled(!environmentStore.isAuthenticated)
                    .onChange(of: environmentStore.enabledMagic) {
                        Task { await updatePreferences(enabledMagic: environmentStore.enabledMagic) }
                    }

                    Toggle(isOn: $environmentStore.enabledPokemon) {
                        HStack {
                            Image("PokemonIcon")
                                .resizable()
                                .scaledToFit()
                                .frame(width: 20, height: 20)
                                .foregroundColor(.accentColor)
                            Text("Pokémon")
                        }
                    }
                    .disabled(!environmentStore.isAuthenticated)
                    .onChange(of: environmentStore.enabledPokemon) {
                        Task { await updatePreferences(enabledPokemon: environmentStore.enabledPokemon) }
                    }
                } header: {
                    Text("TCG Modules")
                } footer: {
                    Text("Enable or disable specific TCG games in search and analytics")
                }

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
                    .disabled(!environmentStore.isAuthenticated)
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
                    .disabled(!environmentStore.isAuthenticated)
                    .onChange(of: environmentStore.showPricing) {
                        Task { await updatePreferences(showPricing: environmentStore.showPricing) }
                    }
                } header: {
                    Text("Display Preferences")
                }

                // Data & Sync Section
                Section {
                    // Network Status
                    HStack {
                        Text("Connection Status")
                        Spacer()
                        HStack(spacing: 6) {
                            Circle()
                                .fill(networkMonitor.isConnected ? Color.green : Color.red)
                                .frame(width: 8, height: 8)
                            Text(networkMonitor.isConnected ? "Online" : "Offline")
                                .foregroundColor(.secondary)
                                .font(.caption)
                        }
                    }

                    Toggle(isOn: $environmentStore.offlineModeEnabled) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Offline Mode")
                            Text("Cache data for offline viewing")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    .disabled(!environmentStore.isAuthenticated)

                    Toggle(isOn: $environmentStore.autoSyncEnabled) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Auto-Sync")
                            Text("Automatically sync when online")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    .disabled(!environmentStore.isAuthenticated || !environmentStore.offlineModeEnabled)

                    // Cache Info
                    HStack {
                        Text("Cache Size")
                        Spacer()
                        Text(cacheSize)
                            .foregroundColor(.secondary)
                    }

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
                    .disabled(!environmentStore.isAuthenticated || !networkMonitor.isConnected || isSyncing)

                    // Clear Cache Button
                    Button("Clear Cache", role: .destructive) {
                        showingClearCacheAlert = true
                    }
                    .disabled(!environmentStore.isAuthenticated)
                } header: {
                    Text("Data & Sync")
                } footer: {
                    Text("Offline mode downloads your collections for viewing without internet. Clear cache to free up storage.")
                }

                // Actions Section
                Section {
                    Button("Sign Out", role: .destructive) {
                        environmentStore.isAuthenticated = false
                        environmentStore.authToken = nil
                    }

                    Button("Reset All Settings", role: .destructive) {
                        showingResetAlert = true
                    }
                }

                // App Info Section
                Section {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("1.0.0")
                            .foregroundColor(.secondary)
                    }
                } header: {
                    Text("About")
                }
            }
            .navigationTitle("Settings")
            .task {
                await refreshPreferencesIfNeeded()
                updateCacheInfo()
            }
            .alert("Reset Configuration?", isPresented: $showingResetAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Reset", role: .destructive) {
                    environmentStore.resetEverything()
                }
            } message: {
                Text("This will remove your server address, login credentials, and authentication token.")
            }
            .alert("Clear Cache?", isPresented: $showingClearCacheAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Clear", role: .destructive) {
                    clearCache()
                }
            } message: {
                Text("This will remove all cached data. You'll need to sync again for offline access.")
            }
            .sheet(isPresented: $showingProfile) {
                ProfileView()
                    .environmentObject(environmentStore)
            }
        }
    }

    private func updateCacheInfo() {
        cacheSize = CacheManager.shared.getFormattedCacheSize()
        lastSyncDate = CacheManager.shared.getLastSyncDate()
    }

    private func clearCache() {
        do {
            try CacheManager.shared.clearAll()
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

private extension SettingsView {
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

    func updatePreferences(
        showCardNumbers: Bool? = nil,
        showPricing: Bool? = nil,
        enabledYugioh: Bool? = nil,
        enabledMagic: Bool? = nil,
        enabledPokemon: Bool? = nil
    ) async {
        guard !isApplyingRemotePreferences,
              environmentStore.isAuthenticated,
              let token = environmentStore.authToken else {
            return
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
                enabledPokemon: enabledPokemon
            )

            await MainActor.run {
                isApplyingRemotePreferences = true
                environmentStore.applyUserPreferences(prefs)
                DispatchQueue.main.async {
                    isApplyingRemotePreferences = false
                }
            }
        } catch {
            print("Failed to update preferences: \(error)")
            await refreshPreferencesIfNeeded()
        }
    }
}
