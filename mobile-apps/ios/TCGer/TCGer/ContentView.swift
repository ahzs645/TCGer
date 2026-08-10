//
//  ContentView.swift
//  TCGer
//

import Combine
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var showingSearch = false
    @State private var selectedTab = AppTab.home.rawValue

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
        guard tabs.count > 5 else { return tabs }
        return Array(tabs.prefix(4))
    }

    private var overflowTabs: [AppTab] {
        guard tabs.count > 5 else { return [] }
        return Array(tabs.dropFirst(4))
    }

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
        .sheet(isPresented: $showingSearch) {
            CardSearchView()
        }
        .onAppear {
            reconcileSelection()
            applyDeepLink(environmentStore.pendingDeepLinkTab)
        }
        .onChange(of: tabs) {
            reconcileSelection()
        }
        .onReceive(environmentStore.$pendingDeepLinkTab.dropFirst()) { tab in
            applyDeepLink(tab)
        }
    }

    private var moreTabsView: some View {
        NavigationStack {
            List(overflowTabs) { tab in
                NavigationLink {
                    destination(for: tab, parentProvidesNavigation: true)
                } label: {
                    Label(tab.title, systemImage: tab.systemImage)
                }
            }
            .navigationTitle("More")
        }
    }

    @ViewBuilder
    private func destination(for tab: AppTab, parentProvidesNavigation: Bool = false) -> some View {
        switch tab {
        case .home:
            DashboardView(parentProvidesNavigation: parentProvidesNavigation)
        case .collections:
            CollectionsView(parentProvidesNavigation: parentProvidesNavigation)
        case .sets:
            SetBrowserView(parentProvidesNavigation: parentProvidesNavigation)
        case .wishlists:
            WishlistsView(parentProvidesNavigation: parentProvidesNavigation)
        case .guides:
            CollectionGuidesView(parentProvidesNavigation: parentProvidesNavigation)
        case .sealed:
            SealedInventoryView(parentProvidesNavigation: parentProvidesNavigation)
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
        case .sets, .wishlists, .guides, .scan:
            return environmentStore.isAuthenticated
        }
    }

    private func applyDeepLink(_ tab: AppTab?) {
        guard let tab, tabs.contains(tab) else { return }

        if primaryTabs.contains(tab) {
            selectedTab = tab.rawValue
        } else if overflowTabs.contains(tab) {
            selectedTab = Self.moreTabSelection
        }
    }

    private func reconcileSelection() {
        if selectedTab == Self.moreTabSelection, !overflowTabs.isEmpty {
            return
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
