//
//  ContentView.swift
//  TCGer
//

import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            DashboardView()
                .tabItem {
                    Image(systemName: "house")
                    Text("Home")
                }

            CardSearchView()
                .tabItem {
                    Image(systemName: "magnifyingglass")
                    Text("Search")
                }

            CollectionsView()
                .tabItem {
                    Image(systemName: "folder")
                    Text("Binders")
                }

            ScanPlaceholderView()
                .tabItem {
                    Image(systemName: "camera.viewfinder")
                    Text("Scan")
                }

            SettingsView()
                .tabItem {
                    Image(systemName: "gearshape")
                    Text("Settings")
                }
        }
    }
}

private struct ScanPlaceholderView: View {
    var body: some View {
        NavigationView {
            VStack(spacing: 12) {
                Image(systemName: "camera.viewfinder")
                    .imageScale(.large)
                    .foregroundColor(.accentColor)
                Text("Scanner")
                Text("Scan cards to identify them")
                    .foregroundColor(.secondary)
            }
            .padding()
            .navigationTitle("Scan")
        }
    }
}
