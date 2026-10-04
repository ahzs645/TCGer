import LocalAuthentication
import XCTest
@testable import TCGer

private final class FakeDeviceContext: DeviceAuthenticationContext {
    var biometryType: LABiometryType = .none
    var available = true
    var result = true
    var failure: Error?
    var evaluations = 0
    func canAuthenticate() -> Bool { available }
    func authenticate(reason: String) async throws -> Bool {
        evaluations += 1
        if let failure { throw failure }
        return result
    }
}

@MainActor
final class DeviceAuthenticationTests: XCTestCase {
    func testPasscodeOnlyDeviceAuthenticatesWithoutBiometricEnrollment() async {
        let context = FakeDeviceContext()
        let result = await BiometricAuthManager.authenticate(context: context)
        XCTAssertTrue(result)
        XCTAssertEqual(context.evaluations, 1)
    }
    func testUnavailableAuthenticationNeverGrantsAccess() async {
        let context = FakeDeviceContext(); context.available = false
        let result = await BiometricAuthManager.authenticate(context: context)
        XCTAssertFalse(result); XCTAssertEqual(context.evaluations, 0)
    }
    func testCancelledOrFailedAuthenticationNeverGrantsAccess() async {
        let context = FakeDeviceContext(); context.failure = LAError(.userCancel)
        let result = await BiometricAuthManager.authenticate(context: context)
        XCTAssertFalse(result)
    }
    func testBackgroundRejectsLateSuccessAndAllowsFreshForegroundAuthentication() async {
        var replies: [CheckedContinuation<Bool, Never>] = []
        let lock = DeviceAppLockStore { await withCheckedContinuation { replies.append($0) } }
        lock.configure(enabled: true)
        let first = Task { await lock.unlock() }
        while replies.isEmpty { await Task.yield() }
        lock.background()
        replies.removeFirst().resume(returning: true)
        await first.value
        XCTAssertTrue(lock.isLocked)
        lock.becomeActive()
        let second = Task { await lock.unlock() }
        while replies.isEmpty { await Task.yield() }
        replies.removeFirst().resume(returning: true)
        await second.value
        XCTAssertFalse(lock.isLocked)
    }
    func testAlreadyUnlockedDoesNotStartAnotherPrompt() async {
        var evaluations = 0
        let lock = DeviceAppLockStore { evaluations += 1; return true }
        lock.configure(enabled: true)
        await lock.unlock()
        await lock.unlock()
        XCTAssertEqual(evaluations, 1)
    }
    func testEnableRelocksAndFailedRetryStaysLocked() async {
        let lock = DeviceAppLockStore { false }
        lock.configure(enabled: false)
        lock.configure(enabled: true)
        await lock.unlock()
        XCTAssertTrue(lock.isLocked)
        lock.configure(enabled: false)
        XCTAssertFalse(lock.isLocked)
        lock.configure(enabled: true)
        XCTAssertTrue(lock.isLocked)
    }
}
