package com.ahmadjalil.tcger.data.remote

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class WishlistRemoteModelsTest {
    @Test
    fun `request carries all wishlist editor fields`() {
        val request = WishlistRequest(
            name = "Master set",
            description = "One of every card",
            colorHex = "C43D73",
            matchAnyPrinting = true,
        )

        val value = Json.parseToJsonElement(Json.encodeToString(request)).jsonObject
        assertEquals("Master set", value.getValue("name").jsonPrimitive.content)
        assertEquals("One of every card", value.getValue("description").jsonPrimitive.content)
        assertEquals("C43D73", value.getValue("colorHex").jsonPrimitive.content)
        assertEquals(true, value.getValue("matchAnyPrinting").jsonPrimitive.boolean)
    }

    @Test
    fun `wishlist response decodes printing matching preference`() {
        val decoded = Json.decodeFromString<WishlistDto>(
            """{"id":"wish-1","name":"Master set","matchAnyPrinting":true,"cards":[]}""",
        )

        assertEquals(true, decoded.matchAnyPrinting)
    }
}
