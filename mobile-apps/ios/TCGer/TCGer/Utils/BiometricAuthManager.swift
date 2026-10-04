// @tcger-feature {"id":"security.biometricLock","platform":"ios","status":"partial","requires":["device-screen-lock"],"limitation":"Device-owner authentication supports biometrics and system passcode fallback and fails closed; physical-device enrollment, lockout and release lifecycle checks remain outstanding."}
import LocalAuthentication

/// Injectable boundary: the OS owns passcode entry and biometric verification.
protocol DeviceAuthenticationContext {
    var biometryType: LABiometryType { get }
    func canAuthenticate() -> Bool
    func authenticate(reason: String) async throws -> Bool
}

final class SystemDeviceAuthenticationContext: DeviceAuthenticationContext {
    private let context = LAContext()
    var biometryType: LABiometryType { context.biometryType }
    func canAuthenticate() -> Bool {
        context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }
    func authenticate(reason: String) async throws -> Bool {
        context.localizedCancelTitle = "Cancel"
        return try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
    }
}

enum BiometricAuthManager {
    enum BiometricType { case faceID, touchID, none }
    static var biometricType: BiometricType {
        let context = SystemDeviceAuthenticationContext()
        guard context.canAuthenticate() else { return .none }
        switch context.biometryType {
        case .faceID: return .faceID
        case .touchID: return .touchID
        default: return .none
        }
    }
    static var isAvailable: Bool { SystemDeviceAuthenticationContext().canAuthenticate() }
    static var displayName: String {
        switch biometricType {
        case .faceID: return "Face ID or Passcode"
        case .touchID: return "Touch ID or Passcode"
        case .none: return "Device Passcode"
        }
    }
    static func authenticate(reason: String = "Unlock TCGer", context suppliedContext: (any DeviceAuthenticationContext)? = nil) async -> Bool {
        let context = suppliedContext ?? SystemDeviceAuthenticationContext()
        guard context.canAuthenticate() else { return false }
        do { return try await context.authenticate(reason: reason) }
        catch { return false }
    }
}
