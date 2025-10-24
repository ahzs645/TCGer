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

            CardScannerView()
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
