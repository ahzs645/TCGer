package com.ahmadjalil.tcger.data.scanner

import android.content.Context

data class DeveloperUnlockProgress(
    val taps: Int,
    val required: Int,
    val unlocked: Boolean,
) {
    val remaining: Int get() = (required - taps).coerceAtLeast(0)
}

class DeveloperUnlockCounter(private val requiredTaps: Int = 7) {
    init { require(requiredTaps > 1) }

    private var taps = 0

    fun tap(alreadyUnlocked: Boolean): DeveloperUnlockProgress {
        if (alreadyUnlocked) return DeveloperUnlockProgress(requiredTaps, requiredTaps, unlocked = true)
        taps += 1
        val unlocked = taps >= requiredTaps
        if (unlocked) taps = requiredTaps
        return DeveloperUnlockProgress(taps, requiredTaps, unlocked)
    }

    fun reset() { taps = 0 }
}

class ScannerDeveloperAccessStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun isUnlocked(): Boolean = preferences.getBoolean(KEY, false)

    fun setUnlocked(unlocked: Boolean) {
        preferences.edit().putBoolean(KEY, unlocked).apply()
    }

    companion object {
        private const val FILE = "scanner-developer-access"
        private const val KEY = "developer-tools-unlocked"
    }
}
