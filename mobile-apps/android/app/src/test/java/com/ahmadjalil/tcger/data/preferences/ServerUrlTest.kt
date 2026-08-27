package com.ahmadjalil.tcger.data.preferences

import org.junit.Assert.assertEquals
import org.junit.Test

class ServerUrlTest {
    @Test
    fun addsSchemeAndRequiredTrailingSlash() {
        assertEquals("https://tcger.example/api/", normalizeServerUrl("tcger.example/api"))
    }

    @Test
    fun preservesExplicitLocalHttpScheme() {
        assertEquals("http://10.0.2.2:3000/", normalizeServerUrl(" http://10.0.2.2:3000/ "))
    }

    @Test
    fun emptyInputStaysEmpty() {
        assertEquals("", normalizeServerUrl("  "))
    }
}
