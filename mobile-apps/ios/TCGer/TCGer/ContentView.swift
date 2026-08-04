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

    /// Keep the tab count at five so SwiftUI does not hand overflow tabs to
    /// UIKit's automatic More navigation controller. That controller would wrap
    /// destinations which already own a navigation stack, producing two bars.
    private var primaryTabs: [AppTab] {
        guard tabs.count > 5 else { return tabs }
        return Array(tabs.prefix(4))
    }

    private var overflowTabs: [AppTab] {
        guard tabs.count > 5 else { return [] }
        return Array(tabs.dropFirst(4))
    }

    var body: some View {
        TabView {
            ForEach(primaryTabs) { tab in
                Tab(tab.title, systemImage: tab.systemImage) {
                    destination(for: tab)
                }
            }

            if !overflowTabs.isEmpty {
                Tab("More", systemImage: "ellipsis") {
                    moreTabsView
                }
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .environment(\.showingSearch, $showingSearch)
        .sheet(isPresented: $showingSearch) {
            CardSearchView()
        }
    }

    private var moreTabsView: some View {
        NavigationStack {
            List(overflowTabs) { tab in
                NavigationLink(value: tab) {
                    Label(tab.title, systemImage: tab.systemImage)
                }
            }
            .navigationTitle("More")
            .navigationDestination(for: AppTab.self) { tab in
                destination(for: tab, parentProvidesNavigation: true)
            }
        }
    }

    @ViewBuilder
    private func destination(for tab: AppTab, parentProvidesNavigation: Bool = false) -> some View {
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
            SettingsView(parentProvidesNavigation: parentProvidesNavigation)
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
