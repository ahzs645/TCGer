//
//  ContentView.swift
//  TCGer
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var showingSearch = false

    private var canViewDashboardWithoutAuth: Bool {
        guard let settings = environmentStore.appSettings else { return false }
        return settings.publicDashboard || !settings.requireAuth
    }

    private var canViewCollectionsWithoutAuth: Bool {
        guard let settings = environmentStore.appSettings else { return false }
        return settings.publicCollections || !settings.requireAuth
    }

    var body: some View {
        TabView {
            if environmentStore.isAuthenticated || canViewDashboardWithoutAuth {
                Tab("Home", systemImage: "house.fill") {
                    DashboardView()
                }
            }

            if environmentStore.isAuthenticated || canViewCollectionsWithoutAuth {
                Tab("Collections", systemImage: "folder.fill") {
                    CollectionsView()
                }
            }

            if environmentStore.isAuthenticated {
                Tab("Scan", systemImage: "camera.viewfinder") {
                    CardScannerView()
                }
            }

            Tab("Settings", systemImage: "gearshape.fill") {
                SettingsView()
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .environment(\.showingSearch, $showingSearch)
        .sheet(isPresented: $showingSearch) {
            CardSearchView()
        }
    }
}

// Environment key for search sheet
private struct ShowingSearchKey: EnvironmentKey {
    static let defaultValue: Binding<Bool> = .constant(false)
}

extension EnvironmentValues {
    var showingSearch: Binding<Bool> {
        get { self[ShowingSearchKey.self] }
        set { self[ShowingSearchKey.self] = newValue }
    }
}
