import Foundation

/// Explicit opt-in used by black-box cross-platform tests. Production launches
/// never enter this mode. Maestro passes the key through launch arguments.
enum ParityTestMode {
    private static let key = "tcgerParityTest"

    static let isEnabled: Bool = {
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains(key) || arguments.contains("-\(key)") {
            return true
        }

        // XCTest-based launchers also register key/value launch arguments in
        // the standard defaults domain. Supporting both forms keeps local
        // simctl launches and Maestro launches deterministic.
        let defaults = UserDefaults.standard
        return defaults.bool(forKey: key) || defaults.string(forKey: key) == "true"
    }()
}
