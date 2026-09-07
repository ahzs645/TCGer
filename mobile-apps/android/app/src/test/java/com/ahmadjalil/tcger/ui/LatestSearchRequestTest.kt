package com.ahmadjalil.tcger.ui

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LatestSearchRequestTest {
    @Test fun `superseded providers cannot publish late results or errors`() = runTest {
        for (fail in listOf(false, true)) {
            val requests = LatestSearchRequest(backgroundScope)
            val gate = CompletableDeferred<Unit>()
            val values = mutableListOf<Int>()
            val errors = mutableListOf<Throwable>()
            requests.launch(operation = {
                withContext(NonCancellable) { gate.await() }
                if (fail) error("old failure")
                1
            }, onSuccess = values::add, onFailure = errors::add)
            runCurrent()
            requests.launch(operation = { 2 }, onSuccess = values::add, onFailure = errors::add)
            runCurrent()
            gate.complete(Unit)
            runCurrent()
            assertEquals(listOf(2), values)
            assertEquals(emptyList<Throwable>(), errors)
        }
    }

    @Test fun `cancelling debounce never changes loading and current errors remain visible`() = runTest {
        val requests = LatestSearchRequest(this)
        val events = mutableListOf<String>()
        requests.launch(delayMillis = 250, onStart = { events += "old start" }, operation = { 1 },
            onSuccess = { events += "old success" }, onFailure = { events += "old failure" })
        runCurrent()
        requests.launch(onStart = { events += "current start" }, operation = { error("current failure") },
            onSuccess = { events += "current success" }, onFailure = { events += it.message!! })
        advanceUntilIdle()
        assertEquals(listOf("current start", "current failure"), events)
    }
}
