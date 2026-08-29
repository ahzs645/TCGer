package com.ahmadjalil.tcger.feature.onlinecodes

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OnlineCodeFeatureTest {
    @Test fun `manual parser trims and deduplicates without changing original casing`() {
        assertEquals(
            listOf("ABC-123", "def-456", "GHI-789"),
            parseOnlineCodes(" ABC-123\ndef-456,abc-123; GHI-789 "),
        )
    }

    @Test fun `masked code reveals only final four characters`() {
        val masked = maskedOnlineCode("ABCD-EFGH-1234")
        assertTrue(masked.endsWith("1234"))
        assertTrue("ABCD" !in masked)
        assertEquals("••••", maskedOnlineCode("123"))
    }

    @Test fun `wire enums use server values`() {
        val json = Json.encodeToString(
            CreateOnlineCodeBatch("pokemon", listOf(OnlineCodeInput("ABC")), OnlineCodeSource.MANUAL),
        )
        assertTrue("\"source\":\"manual\"" in json)
        val patch = Json.encodeToString(UpdateOnlineCodeInput(status = OnlineCodeStatus.REDEEMED))
        assertTrue("\"status\":\"redeemed\"" in patch)
    }

    @Test fun `camera OCR extracts printed redemption tokens and removes duplicates`() {
        assertEquals(
            listOf("ABC-123-XYZ", "9Z8Y-7X6W"),
            scannedOnlineCodes("Redeem ABC-123-XYZ\n9Z8Y-7X6W\nabc-123-xyz"),
        )
    }
}
