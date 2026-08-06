import SwiftUI

struct MainContentView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @StateObject private var wishlistStore = WishlistStore()

    var body: some View {
        ContentView()
            .environmentObject(environmentStore)
            .environmentObject(wishlistStore)
    }
}
