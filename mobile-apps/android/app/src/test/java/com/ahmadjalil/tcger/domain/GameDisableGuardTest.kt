package com.ahmadjalil.tcger.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GameDisableGuardTest {
    private val pokemon = CatalogCard(id = "sv1-1", name = "Pikachu", tcg = "pokemon")

    @Test
    fun `game with no saved cards can be disabled`() {
        assertNull(gameDisableBlockReason("magic", emptyList(), emptyList()))
    }

    @Test
    fun `owned copies and wishlist entries both block disabling a game`() {
        val binder = Binder(
            id = "binder",
            name = "Main",
            cards = listOf(OwnedCard("copy", "binder", pokemon, quantity = 2)),
        )
        val wishlist = Wishlist(
            id = "wishlist",
            name = "Want",
            cards = listOf(WishlistCard("want", pokemon)),
        )

        assertEquals(
            "2 collection cards and 1 wishlist entry",
            gameDisableBlockReason("pokemon", listOf(binder), listOf(wishlist)),
        )
    }
}
