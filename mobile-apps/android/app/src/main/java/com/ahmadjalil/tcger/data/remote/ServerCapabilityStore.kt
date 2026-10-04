package com.ahmadjalil.tcger.data.remote

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class CapabilitySource(val url: String, val token: String?)
data class CapabilitySnapshot(
    val source: CapabilitySource? = null,
    val features: Map<String, Boolean> = emptyMap(),
    val error: String? = null,
)

/** Main-dispatcher owner. Requests coalesce; only their captured source may publish. */
class ServerCapabilityStore(
    private val scope: CoroutineScope,
    private val load: suspend (CapabilitySource) -> Map<String, Boolean>,
) {
    private val mutable = MutableStateFlow(CapabilitySnapshot())
    val state = mutable.asStateFlow()
    private var active: Deferred<Result<Map<String, Boolean>>>? = null

    fun reset() {
        active?.cancel()
        active = null
        mutable.value = CapabilitySnapshot()
    }

    suspend fun refresh(source: CapabilitySource): Map<String, Boolean>? {
        if (mutable.value.source != source) {
            reset()
            mutable.value = CapabilitySnapshot(source = source)
        }
        active?.let { request ->
            try { request.await() } catch (error: CancellationException) { throw error } catch (_: Exception) { }
            return null // The creating caller owns publication.
        }
        val request = scope.async {
            try { Result.success(load(source).toMap()) }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { Result.failure(error) }
        }
        active = request
        try {
            val features = request.await().getOrThrow()
            if (active !== request || mutable.value.source != source) return null
            active = null
            mutable.value = CapabilitySnapshot(source, features)
            return features
        } catch (error: CancellationException) {
            if (active === request) active = null
            throw error
        } catch (error: Exception) {
            if (active === request && mutable.value.source == source) {
                active = null
                // Keep this server's last known restrictions on recovery failure.
                mutable.value = mutable.value.copy(error = error.message ?: "Server capabilities could not be refreshed")
            }
            return null
        }
    }
}
