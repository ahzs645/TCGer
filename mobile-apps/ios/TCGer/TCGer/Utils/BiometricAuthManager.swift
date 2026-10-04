// @tcger-feature {"id":"security.biometricLock","platform":"ios","status":"partial","requires":["enrolled-device-biometrics"],"limitation":"Face ID/Touch ID lock exists; authentication uses biometric-only policy even though cancellation says Use Passcode, so device-credential fallback is absent."}
import LocalAuthentication

enum BiometricAuthManager {
    enum BiometricType {
        case faceID, touchID, none
    }

    static var biometricType: BiometricType {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else {
            return .none
        }
        switch context.biometryType {
        case .faceID: return .faceID
        case .touchID: return .touchID
        default: return .none
        }
    }

    static var isAvailable: Bool {
        biometricType != .none
    }

    static var displayName: String {
        switch biometricType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .none: return "Biometrics"
        }
    }

    static func authenticate(reason: String = "Unlock TCGer") async -> Bool {
        let context = LAContext()
        context.localizedCancelTitle = "Use Passcode"

        do {
            return try await context.evaluatePolicy(
                .deviceOwnerAuthenticationWithBiometrics,
                localizedReason: reason
            )
        } catch {
            return false
        }
    }
}
