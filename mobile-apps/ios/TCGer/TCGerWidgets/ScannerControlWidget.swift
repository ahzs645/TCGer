import AppIntents
import SwiftUI
import WidgetKit

struct ScannerControlWidget: ControlWidget {
    let kind = "ScannerControlWidget"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: kind) {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "tcger://scan")!)) {
                Label("Open Scanner", systemImage: "camera.viewfinder")
            }
        }
        .displayName("Open Scanner")
        .description("Launch TCGer's card scanner.")
    }
}
