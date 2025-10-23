//
//  SettingsView.swift
//  TCGer
//

import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var showingResetAlert = false

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Server")) {
                    HStack {
                        Text("Base URL")
                        Spacer()
                        Text(environmentStore.serverConfiguration.baseURLString.isEmpty ? "Not set" : environmentStore.serverConfiguration.baseURLString)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.trailing)
                    }
                    Button("Reconfigure Server") {
                        environmentStore.serverConfiguration = .empty
                        environmentStore.isAuthenticated = false
                    }
                }

                Section(header: Text("Account")) {
                    HStack {
                        Text("Email")
                        Spacer()
                        Text(environmentStore.credentials.email.isEmpty ? "Not set" : environmentStore.credentials.email)
                            .foregroundColor(.secondary)
                    }
                    Button("Sign Out", role: .destructive) {
                        environmentStore.isAuthenticated = false
                        environmentStore.authToken = nil
                    }
                }

                Section {
                    Button("Reset All Settings", role: .destructive) {
                        showingResetAlert = true
                    }
                }
            }
            .navigationTitle("Settings")
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
