package com.ahmadjalil.tcger.ui

import org.junit.Assert.*
import org.junit.Test

class DeviceAppLockStateTest {
    @Test fun unavailableOrCancelledAuthenticationCannotUnlock() {
        val lock = DeviceAppLockState()
        assertTrue(lock.configure(true))
        assertTrue(lock.begin())
        lock.unavailable("Set up your screen lock")
        assertFalse(lock.unlocked.value)
        assertTrue(lock.begin())
        lock.complete(false, true, "Cancelled")
        assertFalse(lock.unlocked.value)
    }
    @Test fun onlySuccessInForegroundUnlocksAndBackgroundRelocks() {
        val lock = DeviceAppLockState(); lock.configure(true); lock.begin()
        lock.background(); lock.complete(true, false)
        assertFalse(lock.unlocked.value)
        lock.begin(); lock.complete(true, true)
        assertTrue(lock.unlocked.value)
        lock.background(); assertFalse(lock.unlocked.value)
    }
    @Test fun enablingRequiresAuthenticationAndConfigurationDoesNotReuseSuccess() {
        val lock = DeviceAppLockState(); lock.configure(false)
        assertTrue(lock.unlocked.value)
        assertTrue(lock.configure(true))
        assertFalse(lock.unlocked.value)
        assertTrue(lock.begin()); assertFalse(lock.begin())
        lock.complete(true, true)
        assertFalse(lock.configure(true))
        assertTrue(lock.unlocked.value)
        val relaunched = DeviceAppLockState(); assertTrue(relaunched.configure(true))
        assertFalse(relaunched.unlocked.value)
    }
}
