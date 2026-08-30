package com.ahmadjalil.tcger.data.remote

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ScanSafetyApiModelsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun decodesServerCatalogRejectionEvidence() {
        val response = json.decodeFromString<ScanCardResponseDto>(
            """
            {
              "candidates":[{"externalId":"nearby","tcg":"pokemon","name":"Nearby","confidence":0.61}],
              "meta":{
                "engine":"phash",
                "catalogDecision":{
                  "accepted":false,
                  "reason":"low-confidence",
                  "topConfidence":0.61
                }
              }
            }
            """.trimIndent(),
        )

        val decision = requireNotNull(response.meta?.catalogDecision)
        assertFalse(decision.accepted)
        assertEquals("low-confidence", decision.reason)
        assertEquals(0.61, decision.topConfidence!!, 0.001)
    }
}
