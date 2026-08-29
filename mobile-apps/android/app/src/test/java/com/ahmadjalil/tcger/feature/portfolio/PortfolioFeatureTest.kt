package com.ahmadjalil.tcger.feature.portfolio

import com.ahmadjalil.tcger.domain.Binder
import com.ahmadjalil.tcger.domain.CatalogCard
import com.ahmadjalil.tcger.domain.OwnedCard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PortfolioFeatureTest {
    private val pika = CatalogCard("base-25", "Pikachu", "pokemon", setName = "Base", rarity = "Rare", exactPrintingId = "pk-25")

    @Test fun `local prices merge the same printing across binders`() {
        val binders = listOf(
            Binder("a", "Main", cards = listOf(OwnedCard("1", "a", pika, 2, price = 10.0))),
            Binder("b", "Trade", cards = listOf(OwnedCard("2", "b", pika, 1, price = 16.0))),
        )
        val result = buildLocalPricePortfolio(binders)
        assertEquals(1, result.cards.size)
        assertEquals(3, result.cards.single().quantity)
        assertEquals(12.0, result.cards.single().unitPrice, 0.001)
        assertEquals(36.0, result.totalValue, 0.001)
    }

    @Test fun `offline analytics are honest about unavailable history`() {
        val binder = Binder("a", "Main", cards = listOf(OwnedCard("1", "a", pika, 2, price = 10.0)))
        val result = buildLocalAnalytics(listOf(binder), AnalyticsPeriod.THIRTY_DAYS)
        assertTrue(result.offline)
        assertTrue(result.history.history.isEmpty())
        assertTrue(result.movers.gainers.isEmpty())
        assertEquals(20.0, result.history.currentValue, 0.001)
        assertEquals(2, result.breakdown.byGame.single().cardCount)
    }

    @Test fun `price keys normalize game and identifiers`() {
        assertEquals("pokemon:sv-001", priceKey(" Pokemon ", " SV-001 "))
    }
}
