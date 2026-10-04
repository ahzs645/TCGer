import Combine
import Foundation

@MainActor
final class DeviceAppLockStore: ObservableObject {
    @Published private(set) var isLocked = true
    private let authenticate: @MainActor () async -> Bool
    private var enabled = false
    private var foreground = true
    private var requestID: UUID?

    init(authenticate: @escaping @MainActor () async -> Bool = { await BiometricAuthManager.authenticate() }) {
        self.authenticate = authenticate
    }
    func configure(enabled: Bool) {
        guard self.enabled != enabled else { return }
        self.enabled = enabled
        requestID = nil
        isLocked = enabled
    }
    func shield() { if enabled { isLocked = true } }
    func background() {
        foreground = false
        requestID = nil
        shield()
    }
    func becomeActive() { foreground = true }
    func unlock() async {
        guard enabled, isLocked, foreground, requestID == nil else { return }
        let id = UUID()
        requestID = id
        let authenticated = await authenticate()
        guard requestID == id, foreground, enabled else { return }
        requestID = nil
        if authenticated { isLocked = false }
    }
}
