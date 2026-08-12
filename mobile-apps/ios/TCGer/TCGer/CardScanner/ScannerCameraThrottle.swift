import Foundation

/// Decides when the capture device should drop to its low idle frame rate.
///
/// Pure policy, no camera dependency: the view model feeds it delivered-frame
/// overlay state and live-analysis outcomes, and pushes the returned `isIdle`
/// into `CardScannerCameraController.setIdle(_:)`, which ignores repeats.
struct ScannerCameraThrottle {
    /// Consecutive card-free analyses before idling. Live analyses run at most
    /// once a second, so this is roughly eight seconds of empty viewfinder —
    /// comfortably above LiveScanConsensus's confirmation window (2 matches in
    /// 3s), so a candidate mid-confirmation can never idle the camera while
    /// the user is holding a card steady.
    static let emptyAnalysesBeforeIdle = 8

    private var emptyAnalyses = 0
    private var overlayPresented = false
    private(set) var isIdle = false

    /// Note a delivered frame's overlay state. A presented result sheet or
    /// binder review covers the preview, so it idles the camera immediately
    /// AND holds the empty count at zero — dismissing it returns to the
    /// scanning rate on the very next frame instead of after a fresh streak.
    @discardableResult
    mutating func noteOverlay(_ presented: Bool) -> Bool {
        overlayPresented = presented
        if presented { emptyAnalyses = 0 }
        return recompute()
    }

    /// Note a completed live analysis. `cardVisible` covers a successful
    /// match, a pending consensus candidate, or mere card-shaped presence —
    /// an unrecognized card held by an actively trying user must keep the
    /// full scanning rate.
    @discardableResult
    mutating func noteAnalysis(cardVisible: Bool) -> Bool {
        emptyAnalyses = cardVisible ? 0 : emptyAnalyses + 1
        return recompute()
    }

    private mutating func recompute() -> Bool {
        isIdle = overlayPresented || emptyAnalyses >= Self.emptyAnalysesBeforeIdle
        return isIdle
    }
}
