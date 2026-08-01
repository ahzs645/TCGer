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

    /// The user's chosen tabs, minus any that the current session can't reach.
    private var tabs: [AppTab] {
        environmentStore.visibleTabs.filter(isAvailable)
    }

    var body: some View {
        TabView {
            ForEach(tabs) { tab in
                Tab(tab.title, systemImage: tab.systemImage) {
                    destination(for: tab)
                }
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .environment(\.showingSearch, $showingSearch)
        .sheet(isPresented: $showingSearch) {
            CardSearchView()
        }
    }

    @ViewBuilder
    private func destination(for tab: AppTab) -> some View {
        switch tab {
        case .home:
            DashboardView()
        case .collections:
            CollectionsView()
        case .sets:
            SetBrowserView()
        case .wishlists:
            WishlistsView()
        case .sealed:
            SealedInventoryView()
        case .scan:
            CardScannerView()
        case .settings:
            SettingsView()
        }
    }

    private func isAvailable(_ tab: AppTab) -> Bool {
        switch tab {
        case .settings:
            return true
        case .home:
            return environmentStore.isAuthenticated || canViewDashboardWithoutAuth
        case .collections:
            return environmentStore.isAuthenticated || canViewCollectionsWithoutAuth
        case .sealed:
            return environmentStore.serverFeatures.sealed && environmentStore.isAuthenticated
        case .sets, .wishlists, .scan:
            return environmentStore.isAuthenticated
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
