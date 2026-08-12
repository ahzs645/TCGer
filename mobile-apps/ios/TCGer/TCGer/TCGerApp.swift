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
    @StateObject private var featureDependencies: AppFeatureDependencies
    @StateObject private var wishlistStore: WishlistStore

    init() {
        let apiService = APIService()
        let featureDependencies = AppFeatureDependencies(
            collections: APICollectionRepository(apiService: apiService),
            wishlists: APIWishlistRepository(apiService: apiService)
        )
        _featureDependencies = StateObject(wrappedValue: featureDependencies)
        _wishlistStore = StateObject(
            wrappedValue: WishlistStore(repository: featureDependencies.wishlists)
        )
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(environmentStore)
                .environmentObject(featureDependencies)
                .environmentObject(wishlistStore)
                .preferredColorScheme(environmentStore.appColorScheme.colorScheme)
                .tint(environmentStore.accentColorChoice.color)
                .onOpenURL { url in
                    environmentStore.handleDeepLink(url)
                }
        }
    }
}
