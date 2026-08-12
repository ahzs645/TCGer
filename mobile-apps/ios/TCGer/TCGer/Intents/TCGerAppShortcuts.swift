import AppIntents
import Foundation

struct OpenScannerIntent: AppIntent {
    static let title: LocalizedStringResource = "Scan a Card"
    static let description = IntentDescription("Open TCGer directly in the card scanner.")
    static var supportedModes: IntentModes { .foreground(.immediate) }

    func perform() async throws -> some IntentResult & OpensIntent {
        // OpenURLIntent only accepts universal links. The AASA file routes
        // this back into the same typed deep-link pipeline as tcger:// URLs.
        let url = URL(string: "https://tcger.ahmadjalil.com/scan")!
        return .result(opensIntent: OpenURLIntent(url))
    }
}

struct SearchCardsIntent: AppIntent {
    static let title: LocalizedStringResource = "Search Cards"
    static let description = IntentDescription("Open TCGer and search the card catalog.")
    static var supportedModes: IntentModes { .foreground(.immediate) }

    @Parameter(title: "Search")
    var query: String

    func perform() async throws -> some IntentResult & OpensIntent {
        var components = URLComponents()
        components.scheme = "https"
        components.host = "tcger.ahmadjalil.com"
        components.path = "/search"
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        guard let url = components.url else { return .result() }
        return .result(opensIntent: OpenURLIntent(url))
    }
}

struct TCGerAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenScannerIntent(),
            phrases: [
                "Scan a card with \(.applicationName)",
                "Open the scanner in \(.applicationName)"
            ],
            shortTitle: "Scan a Card",
            systemImageName: "camera.viewfinder"
        )

        AppShortcut(
            intent: SearchCardsIntent(),
            phrases: [
                "Search cards with \(.applicationName)",
                "Find a card in \(.applicationName)"
            ],
            shortTitle: "Search Cards",
            systemImageName: "magnifyingglass"
        )
    }
}
