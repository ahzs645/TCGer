//
//  SettingsView.swift
//  TCGer
//

import SwiftUI
import Foundation

struct SettingsView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var showingResetAlert = false
    @State private var isApplyingRemotePreferences = false
    var body: some View {
        NavigationView {
            Form {
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
                    .onChange(of: environmentStore.showCardNumbers) { newValue in
                        Task { await updatePreferences(showCardNumbers: newValue) }
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
                    .onChange(of: environmentStore.showPricing) { newValue in
                        Task { await updatePreferences(showPricing: newValue) }
                    }
                } header: {
                    Text("Display Preferences")
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
            }
            .alert("Reset Configuration?", isPresented: $showingResetAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Reset", role: .destructive) {
                    environmentStore.resetEverything()
                }
            } message: {
                Text("This will remove your server address, login credentials, and authentication token.")
            }
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
        showPricing: Bool? = nil
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
                showPricing: showPricing
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
