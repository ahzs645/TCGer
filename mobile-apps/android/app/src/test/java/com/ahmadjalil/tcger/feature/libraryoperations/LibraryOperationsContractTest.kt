package com.ahmadjalil.tcger.feature.libraryoperations

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class LibraryOperationsContractTest {
    @Test fun trackedPricesDecodeFromEnvelope() {
        val envelope = Json.decodeFromString<TrackedPricesEnvelope>(
            """{"prices":[{"key":"pokemon:sv1-1","tcg":"pokemon","externalId":"sv1-1","price":1.25,"currency":"USD","cached":true}],"refreshedAt":"2026-08-29T00:00:00Z","refreshAfter":"2026-08-29T01:00:00Z"}""",
        )
        assertEquals("sv1-1", envelope.prices.single().externalId)
        assertEquals("2026-08-29T01:00:00Z", envelope.refreshAfter)
    }
}
