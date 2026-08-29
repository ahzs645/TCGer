package com.ahmadjalil.tcger.data.remote

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class BinderRemoteModelsTest {
    @Test
    fun `create request carries all binder editor fields`() {
        val request = CreateBinderRequest(
            name = "Trades",
            description = "League binder",
            colorHex = "90CAF9",
            defaultCondition = "Near Mint",
            containerType = "12-pocket zip binder",
            imageUrl = "https://example.com/cover.jpg",
        )

        val objectValue = Json.parseToJsonElement(Json.encodeToString(request)).jsonObject
        assertEquals("Trades", objectValue.getValue("name").jsonPrimitive.content)
        assertEquals("League binder", objectValue.getValue("description").jsonPrimitive.content)
        assertEquals("90CAF9", objectValue.getValue("colorHex").jsonPrimitive.content)
        assertEquals("Near Mint", objectValue.getValue("defaultCondition").jsonPrimitive.content)
        assertEquals("12-pocket zip binder", objectValue.getValue("containerType").jsonPrimitive.content)
        assertEquals("https://example.com/cover.jpg", objectValue.getValue("imageUrl").jsonPrimitive.content)
    }
}
