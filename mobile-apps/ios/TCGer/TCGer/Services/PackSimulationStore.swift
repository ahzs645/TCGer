// @tcger-feature {"id":"packOpening.simulationHistory","platform":"ios","status":"implemented","modes":["local"]}
import Foundation

/// Simulation history is deliberately separate from LocalStore and its owned
/// inventory, sales, collection value, and sealed-product balances.
@MainActor
final class PackSimulationStore {
    static let shared = PackSimulationStore()
    struct History: Codable {
        var sessions: [PackOpeningPullSession] = []
        var favorites: [Card] = []
    }
    private let file: URL

    init(file: URL? = nil) {
        self.file = file ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PackSimulations/history.json")
    }

    func history() throws -> History {
        guard FileManager.default.fileExists(atPath: file.path) else { return History() }
        return try JSONDecoder().decode(History.self, from: Data(contentsOf: file))
    }

    func save(_ session: PackOpeningPullSession) throws {
        var current = try history()
        current.sessions.removeAll { $0.id == session.id }
        current.sessions.insert(session, at: 0)
        try write(current)
    }

    func favorite(_ card: Card) throws {
        var current = try history()
        current.favorites.removeAll { $0.tcg == card.tcg && $0.id == card.id }
        current.favorites.insert(card, at: 0)
        try write(current)
    }

    private func write(_ history: History) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(history).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
