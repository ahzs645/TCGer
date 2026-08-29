package com.ahmadjalil.tcger.data.repository

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class SealedRepositoryContractTest {
    @Test
    fun `barcode lookup treats UPC-A and zero-prefixed EAN as equivalent`() {
        assertEquals(listOf("820650855221", "0820650855221"), barcodeEquivalents("820650855221"))
        assertEquals(listOf("0820650855221", "820650855221"), barcodeEquivalents("0820650855221"))
    }

    @Test
    fun `sealed update sends explicit nulls so server fields can be cleared`() {
        val body = sealedInventoryUpdateJson(
            quantity = 3,
            purchasePrice = null,
            purchaseDate = null,
            notes = "  ",
        )

        assertEquals(3, body.getValue("quantity").jsonPrimitive.content.toInt())
        assertSame(JsonNull, body.getValue("purchasePrice"))
        assertSame(JsonNull, body.getValue("purchaseDate"))
        assertSame(JsonNull, body.getValue("notes"))
    }
}
