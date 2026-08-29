package com.ahmadjalil.tcger.data.scanner

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class ScannerSharedSessionClientTest {
    @Test
    fun `shared session request normalizes code and preserves language and identity`() {
        val entry = ScannerSessionEntry(
            id = "event-1",
            cardId = "sv1-25",
            name = "Pikachu",
            game = "pokemon",
            setCode = "SV1",
            source = "ON_DEVICE_TEXT",
            scannedAt = "2026-08-29T00:00:00Z",
            confidence = 0.92,
        )

        val encoded = SharedScannerSessionJson.encode(
            SharedScannerSessionJson.request(" ab12 ", entry, "Japanese"),
        )
        val value = Json.parseToJsonElement(encoded).jsonObject
        assertEquals("AB12", value.getValue("code").jsonPrimitive.content)
        assertEquals("event-1", value.getValue("clientEventId").jsonPrimitive.content)
        assertEquals("sv1-25", value.getValue("externalId").jsonPrimitive.content)
        assertEquals("Japanese", value.getValue("language").jsonPrimitive.content)
    }
}
