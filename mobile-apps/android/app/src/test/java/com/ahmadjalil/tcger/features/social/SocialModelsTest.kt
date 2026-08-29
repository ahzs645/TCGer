package com.ahmadjalil.tcger.features.social

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SocialModelsTest {
    @Test
    fun deckDraftNormalizesUserInput() {
        val result = DeckDraft(
            name = "  League deck  ",
            description = "   ",
            tcg = " POKEMON ",
            format = " Standard ",
            colorHex = "#aa09ef",
        ).normalized()

        assertEquals("League deck", result.name)
        assertNull(result.description)
        assertEquals("pokemon", result.tcg)
        assertEquals("Standard", result.format)
        assertEquals("AA09EF", result.colorHex)
        assertTrue(result.isValid)
    }

    @Test
    fun tradePermissionsMatchServerRules() {
        val trade = trade(status = "pending")

        assertTrue(trade.canAccept("receiver"))
        assertFalse(trade.canAccept("sender"))
        assertTrue(trade.canCancel("sender"))
        assertFalse(trade.canCancel("receiver"))
        assertTrue(trade.canDelete("sender"))
        assertFalse(trade.canDelete("receiver"))
    }

    @Test
    fun tradeMatchCreatesExactServerPayload() {
        val match = TradeMatch(
            userId = "other-user",
            youHave = listOf(TradeMatchCard("mine", "pokemon", "My card")),
            theyHave = listOf(TradeMatchCard("theirs", "magic", "Their card")),
        )

        val request = match.toTradeRequest("  Want to trade? ")
        val json = Json { explicitNulls = false }.encodeToString(request)

        assertEquals("other-user", request.receiverId)
        assertEquals("Want to trade?", request.message)
        assertTrue(json.contains("\"senderCards\""))
        assertTrue(json.contains("\"receiverCards\""))
        assertEquals(1, request.senderCards.single().quantity)
    }

    @Test
    fun notificationTypesMapToIosCategories() {
        assertEquals(NotificationCategory.TRADE, NotificationCategory.from("trade_requested"))
        assertEquals(NotificationCategory.PRICE, NotificationCategory.from("market-price-alert"))
        assertEquals(NotificationCategory.IMPORT, NotificationCategory.from("scan_import_complete"))
        assertEquals(NotificationCategory.NEWS, NotificationCategory.from("new_release"))
        assertEquals(NotificationCategory.GENERAL, NotificationCategory.from("account"))
    }

    private fun trade(status: String) = Trade(
        id = "trade",
        senderId = "sender",
        receiverId = "receiver",
        status = status,
        createdAt = "2026-01-01T00:00:00Z",
        updatedAt = "2026-01-01T00:00:00Z",
    )
}
