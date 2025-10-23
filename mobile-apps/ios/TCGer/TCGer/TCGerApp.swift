//
//  TCGerApp.swift
//  TCGer
//
//  Created by Ahmad Jalil on 2025-10-22.
//

import SwiftUI

@main
struct TCGerApp: App {
    @StateObject private var environmentStore = EnvironmentStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(environmentStore)
        }
    }
}
