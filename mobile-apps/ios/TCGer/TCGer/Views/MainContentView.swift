import SwiftUI

struct MainContentView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore

    var body: some View {
        ContentView()
            .environmentObject(environmentStore)
    }
}
