package com.ahmadjalil.tcger.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class DashboardStatsTest {
    @Test
    fun aggregatesBinderCardsCopiesAndValue() {
        val binders = listOf(
            Binder(
                id = "binder-1",
                name = "Main",
                cards = listOf(
                    OwnedCard("copy-1", "binder-1", CatalogCard("card-1", "Pikachu", "pokemon"), 2, price = 4.5),
                    OwnedCard("copy-2", "binder-1", CatalogCard("card-2", "Raichu", "pokemon"), 1, price = 8.0),
                ),
            ),
            Binder(id = "binder-2", name = "Trades"),
        )

        val stats = binders.dashboardStats()

        assertEquals(2, stats.binderCount)
        assertEquals(2, stats.uniqueCards)
        assertEquals(3, stats.totalCopies)
        assertEquals(17.0, stats.totalValue, 0.001)
    }
}
