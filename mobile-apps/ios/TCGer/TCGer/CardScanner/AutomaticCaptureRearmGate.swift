import Foundation

/// Prevents one physical card from being accepted more than once in automatic mode.
struct AutomaticCaptureRearmGate: Equatable, Sendable {
    private(set) var isArmed = true

    mutating func acceptedCapture() {
        isArmed = false
    }

    @discardableResult
    mutating func observe(cardPresent: Bool) -> Bool {
        guard !isArmed, !cardPresent else { return false }
        isArmed = true
        return true
    }

    mutating func nextCard() {
        isArmed = true
    }
}
