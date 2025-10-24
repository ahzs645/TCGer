//
//  ContentView.swift
//  TCGer
//

import SwiftUI

struct ContentView: View {
    @State private var showingSearch = false

    var body: some View {
        TabView {
            Tab("Home", systemImage: "house.fill") {
                DashboardView()
            }

            Tab("Binders", systemImage: "folder.fill") {
                CollectionsView()
            }

            Tab("Scan", systemImage: "camera.viewfinder") {
                CardScannerView()
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
