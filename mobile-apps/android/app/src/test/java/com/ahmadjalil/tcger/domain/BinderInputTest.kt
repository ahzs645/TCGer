package com.ahmadjalil.tcger.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BinderInputTest {
    @Test
    fun `normalization preserves binder presentation and clears blank optionals`() {
        val normalized = BinderInput(
            name = "  Trade binder  ",
            description = "  For league nights ",
            colorHex = "#90caf9",
            defaultCondition = " Near Mint ",
            containerType = "  12-pocket zip binder ",
            imageUrl = " https://example.com/cover.jpg ",
            associatedTcg = "  ",
        ).normalized()

        assertEquals("Trade binder", normalized.name)
        assertEquals("For league nights", normalized.description)
        assertEquals("90CAF9", normalized.colorHex)
        assertEquals("Near Mint", normalized.defaultCondition)
        assertEquals("12-pocket zip binder", normalized.containerType)
        assertEquals("https://example.com/cover.jpg", normalized.imageUrl)
        assertNull(normalized.associatedTcg)
    }

    @Test
    fun `cover URL accepts only absolute http and https locations`() {
        assertTrue(BinderInput("Binder").hasValidCoverUrl)
        assertTrue(BinderInput("Binder", imageUrl = "https://example.com/a.png").hasValidCoverUrl)
        assertTrue(BinderInput("Binder", imageUrl = "HTTP://example.com/a.png").hasValidCoverUrl)
        assertFalse(BinderInput("Binder", imageUrl = "example.com/a.png").hasValidCoverUrl)
        assertFalse(BinderInput("Binder", imageUrl = "file:///tmp/a.png").hasValidCoverUrl)
        assertFalse(BinderInput("Binder", imageUrl = "https:///missing-host.png").hasValidCoverUrl)
    }
}
