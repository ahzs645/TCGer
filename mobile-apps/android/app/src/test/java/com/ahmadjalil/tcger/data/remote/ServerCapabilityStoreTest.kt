package com.ahmadjalil.tcger.data.remote

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ServerCapabilityStoreTest {
    private val source = CapabilitySource("https://server.test", "account-a")
    @Test fun failureRetainsRestrictionsAndSameServerRecoveryRefreshes() = runTest {
        var response: Map<String, Boolean>? = mapOf("onlineCodes" to false, "decks" to false)
        val store = ServerCapabilityStore(this) { response ?: error("offline") }
        store.refresh(source)
        response = null
        store.refresh(source)
        assertEquals(false, store.state.value.features["onlineCodes"])
        assertNotNull(store.state.value.error)
        response = mapOf("onlineCodes" to true)
        store.refresh(source)
        assertEquals(true, store.state.value.features["onlineCodes"])
        assertNull(store.state.value.error)
    }
    @Test fun overlappingRequestsCoalesce() = runTest {
        val response = CompletableDeferred<Map<String, Boolean>>()
        var calls = 0
        val store = ServerCapabilityStore(this) { calls++; response.await() }
        val first = async { store.refresh(source) }; runCurrent()
        val second = async { store.refresh(source) }; runCurrent()
        assertEquals(1, calls)
        response.complete(mapOf("sealed" to false))
        first.await(); second.await()
        assertEquals(false, store.state.value.features["sealed"])
    }
    @Test fun accountSwitchRejectsLateResponseAndDropsOldRestrictions() = runTest {
        val delayed = CompletableDeferred<Map<String, Boolean>>()
        val other = source.copy(token = "account-b")
        val store = ServerCapabilityStore(this) { if (it == source) delayed.await() else mapOf("decks" to true) }
        val first = async { runCatching { store.refresh(source) } }; runCurrent()
        store.refresh(other)
        delayed.complete(mapOf("decks" to false)); first.await()
        assertEquals(other, store.state.value.source)
        assertEquals(true, store.state.value.features["decks"])
        store.reset()
        assertTrue(store.state.value.features.isEmpty())
    }
    @Test fun failedInitialRequestCanRetry() = runTest {
        var fail = true
        val store = ServerCapabilityStore(this) { if (fail) error("offline") else mapOf("prices" to false) }
        store.refresh(source); fail = false; store.refresh(source)
        assertEquals(false, store.state.value.features["prices"])
    }
}
