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
    @StateObject private var wishlistStore = WishlistStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(environmentStore)
                .environmentObject(wishlistStore)
                .preferredColorScheme(environmentStore.appColorScheme.colorScheme)
                .tint(environmentStore.accentColorChoice.color)
                .onOpenURL { url in
                    environmentStore.handleDeepLink(url)
                }
        }
    }
}
