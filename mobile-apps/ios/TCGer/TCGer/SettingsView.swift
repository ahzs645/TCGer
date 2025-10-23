//
//  SettingsView.swift
//  TCGer
//

import SwiftUI

struct SettingsView: View {
    var body: some View {
        NavigationView {
            VStack(spacing: 12) {
                Image(systemName: "gearshape")
                    .imageScale(.large)
                    .foregroundColor(.accentColor)
                Text("Settings")
                Text("Configure your app preferences")
                    .foregroundColor(.secondary)
            }
            .padding()
            .navigationTitle("Settings")
        }
    }
}

#Preview {
    SettingsView()
}
