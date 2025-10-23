//
//  ContentView.swift
//  TCGer
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore

    var body: some View {
        TabView {
            HomePlaceholderView()
                .tabItem {
                    Image(systemName: "house")
                    Text("Home")
                }

            CollectionPlaceholderView()
                .tabItem {
                    Image(systemName: "rectangle.stack")
                    Text("Collection")
                }

            ScanPlaceholderView()
                .tabItem {
                    Image(systemName: "camera.viewfinder")
                    Text("Scan")
                }

            BindersPlaceholderView()
                .tabItem {
                    Image(systemName: "folder")
                    Text("Binders")
                }

            SettingsView()
                .tabItem {
                    Image(systemName: "gearshape")
                    Text("Settings")
                }
        }
    }
}

private struct HomePlaceholderView: View {
    var body: some View {
        NavigationView {
            VStack(spacing: 12) {
                Image(systemName: "house")
                    .imageScale(.large)
                    .foregroundColor(.accentColor)
                Text("Home")
                Text("Dashboard coming soon")
                    .foregroundColor(.secondary)
            }
            .padding()
            .navigationTitle("TCGer")
        }
    }
}

private struct CollectionPlaceholderView: View {
    var body: some View {
        NavigationView {
            VStack(spacing: 12) {
                Image(systemName: "rectangle.stack")
                    .imageScale(.large)
                    .foregroundColor(.accentColor)
                Text("Collection")
                Text("Browse your cards here")
                    .foregroundColor(.secondary)
            }
            .padding()
            .navigationTitle("Collection")
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

private struct BindersPlaceholderView: View {
    var body: some View {
        NavigationView {
            VStack(spacing: 12) {
                Image(systemName: "folder")
                    .imageScale(.large)
                    .foregroundColor(.accentColor)
                Text("Binders")
                Text("Organize cards into binders")
                    .foregroundColor(.secondary)
            }
            .padding()
            .navigationTitle("Binders")
        }
    }
}
