package com.ahmadjalil.tcger.ui

import androidx.compose.runtime.mutableStateOf

/** Auth success is the only enabled-lock transition to unlocked. */
class DeviceAppLockState {
    val unlocked = mutableStateOf(false)
    val error = mutableStateOf<String?>(null)
    var enabled = false
        private set
    var promptActive = false
        private set
    private var preferencesLoaded = false

    fun configure(enabled: Boolean, debugBypass: Boolean = false): Boolean {
        val needsAuthentication = enabled && (!preferencesLoaded || !this.enabled)
        preferencesLoaded = true
        this.enabled = enabled
        if (!enabled || debugBypass) {
            unlocked.value = true
            promptActive = false
            error.value = null
            return false
        }
        if (needsAuthentication) unlocked.value = false
        return needsAuthentication
    }
    fun begin(): Boolean {
        if (promptActive) return false
        promptActive = true
        error.value = null
        return true
    }
    fun unavailable(message: String) {
        promptActive = false
        unlocked.value = false
        error.value = message
    }
    fun complete(success: Boolean, foreground: Boolean, message: String? = null) {
        promptActive = false
        unlocked.value = !enabled || (success && foreground)
        error.value = if (unlocked.value) null else message
    }
    fun background() { if (enabled) unlocked.value = false }
}
