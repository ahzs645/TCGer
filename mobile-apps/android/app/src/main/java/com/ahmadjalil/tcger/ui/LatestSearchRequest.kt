package com.ahmadjalil.tcger.ui

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch

/** Only the latest request may publish results, errors, or loading changes. */
internal class LatestSearchRequest(private val scope: CoroutineScope) {
    private var generation = 0L
    private var job: Job? = null

    fun <T> launch(
        delayMillis: Long = 0,
        onStart: () -> Unit = {},
        operation: suspend () -> T,
        onSuccess: (T) -> Unit,
        onFailure: (Throwable) -> Unit,
    ) {
        val request = ++generation
        job?.cancel()
        job = scope.launch {
            delay(delayMillis)
            if (request != generation) return@launch
            onStart()
            try {
                val value = operation()
                ensureActive()
                if (request == generation) onSuccess(value)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                ensureActive()
                if (request == generation) onFailure(error)
            }
        }
    }
}
