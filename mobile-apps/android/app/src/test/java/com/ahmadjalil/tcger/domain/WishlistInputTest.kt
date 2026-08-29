package com.ahmadjalil.tcger.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WishlistInputTest {
    @Test
    fun `normalization preserves wishlist options and clears blank description`() {
        val normalized = WishlistInput(
            name = "  Master set  ",
            description = "   ",
            colorHex = "#c43d73",
            matchAnyPrinting = true,
        ).normalized()

        assertEquals("Master set", normalized.name)
        assertNull(normalized.description)
        assertEquals("C43D73", normalized.colorHex)
        assertEquals(true, normalized.matchAnyPrinting)
    }
}
