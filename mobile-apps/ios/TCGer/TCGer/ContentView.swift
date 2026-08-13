//
//  ContentView.swift
//  TCGer
//

import Combine
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @EnvironmentObject private var featureDependencies: AppFeatureDependencies
    @State private var showingSearch = false
    @State private var searchQuery: String?
    @State private var selectedTab = AppTab.home.rawValue
    @State private var moreNavigationPath: [AppTab] = []

    private static let moreTabSelection = "__more__"

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
        tabLayout.primaryTabs
    }

    private var overflowTabs: [AppTab] {
        tabLayout.overflowTabs
    }

    private var tabLayout: AppTabLayout { AppTabLayout(tabs: tabs) }

    var body: some View {
        TabView(selection: $selectedTab) {
            ForEach(primaryTabs) { tab in
                Tab(tab.title, systemImage: tab.systemImage, value: tab.rawValue) {
                    destination(for: tab)
                }
            }

            if !overflowTabs.isEmpty {
                Tab("More", systemImage: "ellipsis", value: Self.moreTabSelection) {
                    moreTabsView
                }
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .environment(\.showingSearch, $showingSearch)
        .sheet(isPresented: $showingSearch, onDismiss: {
            searchQuery = nil
        }) {
            CardSearchView(initialSearchText: searchQuery ?? "")
        }
        .onAppear {
            reconcileSelection()
            applyDeepLink(environmentStore.pendingDeepLinkRequest)
        }
        .onChange(of: tabs) {
            reconcileSelection()
            applyDeepLink(environmentStore.pendingDeepLinkRequest)
        }
        .onReceive(environmentStore.$pendingDeepLinkRequest.dropFirst()) { request in
            applyDeepLink(request)
        }
    }

    private var moreTabsView: some View {
        NavigationStack(path: $moreNavigationPath) {
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
        .tint(environmentStore.accentColorChoice.color)
    }

    @ViewBuilder
    private func destination(for tab: AppTab, parentProvidesNavigation: Bool = false) -> some View {
        switch tab {
        case .home:
            DashboardView(parentProvidesNavigation: parentProvidesNavigation)
        case .collections:
            CollectionsView(
                parentProvidesNavigation: parentProvidesNavigation,
                repository: featureDependencies.collections
            )
        case .sets:
            SetBrowserView(parentProvidesNavigation: parentProvidesNavigation)
        case .pokedex:
            PokedexView(parentProvidesNavigation: parentProvidesNavigation)
        case .decks:
            DecksView(parentProvidesNavigation: parentProvidesNavigation)
        case .wishlists:
            WishlistsView(parentProvidesNavigation: parentProvidesNavigation)
        case .guides:
            CollectionGuidesView(parentProvidesNavigation: parentProvidesNavigation)
        case .sealed:
            SealedInventoryView(parentProvidesNavigation: parentProvidesNavigation)
        case .prices:
            PricesView(parentProvidesNavigation: parentProvidesNavigation)
        case .analytics:
            AnalyticsView(parentProvidesNavigation: parentProvidesNavigation)
        case .trades:
            TradesView(parentProvidesNavigation: parentProvidesNavigation)
        case .activity:
            ActivityView(parentProvidesNavigation: parentProvidesNavigation)
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
        case .sets, .pokedex, .decks, .wishlists, .guides, .prices, .analytics, .trades, .activity, .scan:
            return environmentStore.isAuthenticated
        }
    }

    private func applyDeepLink(_ request: AppDeepLinkRequest?) {
        guard let request else { return }
        let destination = request.destination

        if case .search(let query) = destination {
            guard environmentStore.claimDeepLinkRequest(request, for: .appShell) else { return }
            searchQuery = query
            showingSearch = true
            return
        }

        guard let tab = destination.tab, tabs.contains(tab) else { return }
        guard environmentStore.claimDeepLinkRequest(request, for: .appShell) else { return }

        switch tabLayout.presentation(for: tab) {
        case .primary:
            selectedTab = tab.rawValue
            moreNavigationPath.removeAll()
        case .more:
            selectedTab = Self.moreTabSelection
            moreNavigationPath = [tab]
        case .unavailable:
            break
        }
    }

    private func reconcileSelection() {
        if selectedTab == Self.moreTabSelection, !overflowTabs.isEmpty {
            if let activeOverflowTab = moreNavigationPath.last,
               !overflowTabs.contains(activeOverflowTab) {
                moreNavigationPath.removeAll()
            }
            return
        }
        if overflowTabs.isEmpty {
            moreNavigationPath.removeAll()
        }
        if primaryTabs.contains(where: { $0.rawValue == selectedTab }) {
            return
        }
        selectedTab = primaryTabs.first?.rawValue ?? Self.moreTabSelection
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
