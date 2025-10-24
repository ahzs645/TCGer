//
//  ContentView.swift
//  TCGer
//

import SwiftUI

struct ContentView: View {
    @State private var showingSearch = false
    @State private var selectedTab = 0
    @State private var isTabBarHidden = false
    @State private var lastScrollOffset: CGFloat = 0
    @State private var scrollOffset: CGFloat = 0

    let tabs = [
        TabItem(icon: "house.fill", title: "Home"),
        TabItem(icon: "folder.fill", title: "Binders"),
        TabItem(icon: "camera.viewfinder", title: "Scan"),
        TabItem(icon: "gearshape.fill", title: "Settings")
    ]

    var body: some View {
        ZStack(alignment: .bottom) {
            // Content
            Group {
                switch selectedTab {
                case 0:
                    ScrollViewWithDetection(scrollOffset: $scrollOffset, isTabBarHidden: $isTabBarHidden) {
                        DashboardView()
                    }
                case 1:
                    ScrollViewWithDetection(scrollOffset: $scrollOffset, isTabBarHidden: $isTabBarHidden) {
                        CollectionsView()
                    }
                case 2:
                    CardScannerView()
                case 3:
                    ScrollViewWithDetection(scrollOffset: $scrollOffset, isTabBarHidden: $isTabBarHidden) {
                        SettingsView()
                    }
                default:
                    EmptyView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            // Custom Tab Bar
            CustomTabBar(
                selectedTab: $selectedTab,
                isHidden: $isTabBarHidden,
                tabs: tabs
            )
        }
        .ignoresSafeArea(.keyboard)
        .environment(\.showingSearch, $showingSearch)
        .environment(\.hideTabBar, $isTabBarHidden)
        .sheet(isPresented: $showingSearch) {
            CardSearchView()
        }
        .onChange(of: selectedTab) { _ in
            // Reset scroll tracking when changing tabs
            scrollOffset = 0
            lastScrollOffset = 0
        }
        .onChange(of: scrollOffset) { newValue in
            handleScrollChange(newValue)
        }
    }

    private func handleScrollChange(_ newValue: CGFloat) {
        let delta = newValue - lastScrollOffset
        let threshold: CGFloat = 10

        // User scrolling down (content moving up)
        if delta < -threshold && !isTabBarHidden && newValue < -50 {
            withAnimation(.spring(response: 0.3)) {
                isTabBarHidden = true
            }
        }
        // User scrolling up (content moving down)
        else if delta > threshold && isTabBarHidden {
            withAnimation(.spring(response: 0.3)) {
                isTabBarHidden = false
            }
        }

        lastScrollOffset = newValue
    }
}

// Wrapper to detect scroll in non-scrollable views
struct ScrollViewWithDetection<Content: View>: View {
    @Binding var scrollOffset: CGFloat
    @Binding var isTabBarHidden: Bool
    let content: Content

    init(scrollOffset: Binding<CGFloat>, isTabBarHidden: Binding<Bool>, @ViewBuilder content: () -> Content) {
        self._scrollOffset = scrollOffset
        self._isTabBarHidden = isTabBarHidden
        self.content = content()
    }

    var body: some View {
        content
            .environment(\.scrollOffset, $scrollOffset)
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

// Environment key for hiding tab bar
private struct HideTabBarKey: EnvironmentKey {
    static let defaultValue: Binding<Bool> = .constant(false)
}

extension EnvironmentValues {
    var hideTabBar: Binding<Bool> {
        get { self[HideTabBarKey.self] }
        set { self[HideTabBarKey.self] = newValue }
    }
}

// Environment key for scroll offset
private struct ScrollOffsetKey: EnvironmentKey {
    static let defaultValue: Binding<CGFloat> = .constant(0)
}

extension EnvironmentValues {
    var scrollOffset: Binding<CGFloat> {
        get { self[ScrollOffsetKey.self] }
        set { self[ScrollOffsetKey.self] = newValue }
    }
}
