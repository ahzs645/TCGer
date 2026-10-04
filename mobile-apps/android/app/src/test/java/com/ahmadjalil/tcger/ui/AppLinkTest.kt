package com.ahmadjalil.tcger.ui

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class AppLinkTest {
    @Test fun sharedLinksRouteToEquivalentDestinationsAndRejectUntrustedInputs() {
        val raw = requireNotNull(javaClass.classLoader?.getResource("app-links-v1.json")).readText()
        Json.parseToJsonElement(raw).jsonArray.forEach { item ->
            val fixture = item.jsonObject
            val url = fixture.getValue("url").jsonPrimitive.content
            val link = parseAppLink(url)
            assertEquals(url, fixture.getValue("android").jsonPrimitive.contentOrNull, link?.route)
            assertEquals(url, fixture["query"]?.jsonPrimitive?.contentOrNull, link?.query)
        }
    }
    @Test fun directChildRoutesInheritExplicitServerRestrictions() {
        assertEquals("decks", requiredServerCapability("deck/{deckId}"))
        assertEquals("trades", requiredServerCapability("trade/{tradeId}"))
        assertEquals("finance", requiredServerCapability("settings-finance-history"))
        assertEquals("onlineCodes", requiredServerCapability("online-codes"))
        assertNull(requiredServerCapability("binder/{binderId}"))
    }
}
