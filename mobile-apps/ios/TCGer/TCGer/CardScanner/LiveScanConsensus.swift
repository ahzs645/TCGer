import Foundation

/// Turns per-frame scanner proposals into stable live results.
///
/// Live camera frames are intentionally treated as evidence rather than final
/// answers. A card must win on consecutive observations before it is committed,
/// and the same physical card cannot be committed again until the camera has
/// seen a short run of clear/no-match frames.
struct LiveScanConsensus {
    struct Configuration: Equatable, Sendable {
        let requiredMatches: Int
        let matchWindow: TimeInterval
        let clearObservationsRequired: Int

        static let standard = Configuration(
            requiredMatches: 2,
            matchWindow: 3,
            clearObservationsRequired: 2
        )
    }

    enum Decision: Equatable, Sendable {
        case pending(count: Int, required: Int)
        case accepted
        case duplicateSuppressed
        case cleared
    }

    private let configuration: Configuration
    private var pendingKey: String?
    private var pendingCount = 0
    private var pendingStartedAt: Date?
    private var lastAcceptedKey: String?
    private var clearObservationCount = 0

    init(configuration: Configuration = .standard) {
        precondition(configuration.requiredMatches > 0)
        precondition(configuration.matchWindow > 0)
        precondition(configuration.clearObservationsRequired > 0)
        self.configuration = configuration
    }

    mutating func observe(key: String, at date: Date = Date()) -> Decision {
        clearObservationCount = 0

        // Once a card is committed, wait for a clear gap before accepting any
        // candidate. This prevents one physical card from being added twice
        // when the matcher briefly flips between near-identical printings.
        if lastAcceptedKey != nil {
            resetPending()
            return .duplicateSuppressed
        }

        let isSamePendingCandidate = pendingKey == key
        let isInsideWindow = pendingStartedAt.map {
            date.timeIntervalSince($0) <= configuration.matchWindow
        } ?? false

        if isSamePendingCandidate, isInsideWindow {
            pendingCount += 1
        } else {
            pendingKey = key
            pendingCount = 1
            pendingStartedAt = date
        }

        guard pendingCount >= configuration.requiredMatches else {
            return .pending(
                count: pendingCount,
                required: configuration.requiredMatches
            )
        }

        lastAcceptedKey = key
        resetPending()
        return .accepted
    }

    mutating func observeNoMatch() -> Decision {
        resetPending()
        clearObservationCount += 1
        guard clearObservationCount >= configuration.clearObservationsRequired else {
            return .cleared
        }
        lastAcceptedKey = nil
        clearObservationCount = configuration.clearObservationsRequired
        return .cleared
    }

    mutating func reset() {
        resetPending()
        lastAcceptedKey = nil
        clearObservationCount = 0
    }

    private mutating func resetPending() {
        pendingKey = nil
        pendingCount = 0
        pendingStartedAt = nil
    }
}
