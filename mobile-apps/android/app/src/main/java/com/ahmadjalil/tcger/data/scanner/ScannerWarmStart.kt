package com.ahmadjalil.tcger.data.scanner

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class ScannerWarmStartKey(val game: String, val encoderVariant: ScannerEncoderVariant)

fun interface ScannerModelWarmStartBoundary {
    /** Prepares the exact reusable model/index instance the production recognition path will use. */
    suspend fun prepare(key: ScannerWarmStartKey)
}

data class ScannerWarmStartResult(
    val key: ScannerWarmStartKey,
    val prepared: Boolean,
    val reused: Boolean,
    val elapsedMs: Double,
    val error: String? = null,
)

/** Single-flight warm-start coordinator; it never claims success unless the production owner prepares its shared instance. */
class ScannerWarmStartCoordinator(
    private val boundary: ScannerModelWarmStartBoundary,
    private val nanoTime: () -> Long = System::nanoTime,
) {
    private val mutex = Mutex()
    private val preparedKeys = mutableSetOf<ScannerWarmStartKey>()

    suspend fun prepare(game: String, options: ScannerSessionOptions): ScannerWarmStartResult {
        val key = ScannerWarmStartKey(game.lowercase(), options.encoderVariant)
        if (options.performance[ScannerPerformanceOption.WARM_START] != true) {
            return ScannerWarmStartResult(key, prepared = false, reused = false, elapsedMs = 0.0, error = "Warm start is disabled")
        }
        return mutex.withLock {
            if (key in preparedKeys) return@withLock ScannerWarmStartResult(key, prepared = true, reused = true, elapsedMs = 0.0)
            val started = nanoTime()
            runCatching { boundary.prepare(key) }.fold(
                onSuccess = {
                    preparedKeys += key
                    ScannerWarmStartResult(key, prepared = true, reused = false, elapsedMs = (nanoTime() - started) / 1_000_000.0)
                },
                onFailure = {
                    ScannerWarmStartResult(key, prepared = false, reused = false, elapsedMs = (nanoTime() - started) / 1_000_000.0, error = it.message)
                },
            )
        }
    }

    suspend fun invalidate() = mutex.withLock { preparedKeys.clear() }
}
