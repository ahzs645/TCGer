package com.ahmadjalil.tcger.data.scanner

/** One sampled frame in flight; inactive/busy frames never enter conversion. */
class ScannerPreviewAnalysisThrottle {
    private var lastSampleMillis: Long? = null
    private var inFlight = false

    @Synchronized
    fun tryAcquire(nowMillis: Long, enabled: Boolean, busy: Boolean, intervalMillis: Long): Boolean {
        if (!enabled || busy || inFlight) return false
        val last = lastSampleMillis
        if (last != null && nowMillis - last < intervalMillis.coerceAtLeast(1)) return false
        lastSampleMillis = nowMillis
        inFlight = true
        return true
    }

    @Synchronized
    fun release() { inFlight = false }
}
