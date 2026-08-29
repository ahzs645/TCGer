package com.ahmadjalil.tcger.data.backup

import com.ahmadjalil.tcger.domain.Binder
import com.ahmadjalil.tcger.domain.CatalogCard
import com.ahmadjalil.tcger.domain.OwnedCard
import com.ahmadjalil.tcger.domain.Wishlist
import com.ahmadjalil.tcger.domain.WishlistCard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CollectionBackupTest {
    private val card = CatalogCard("sv1-25", "Pikachu", "pokemon", "SV1", "Scarlet & Violet", collectorNumber = "25")

    @Test
    fun `portable backup round trips collection and wishlist options`() {
        val binder = Binder("b1", "Main", cards = listOf(OwnedCard("copy", "b1", card, 3)))
        val wishlist = Wishlist(
            "w1",
            "Master set",
            description = "All printings",
            matchAnyPrinting = true,
            cards = listOf(WishlistCard("wanted", card, desiredQuantity = 2, notes = "Reverse holo")),
        )

        val decoded = CollectionBackupJson.decode(
            CollectionBackupJson.encode(CollectionBackupJson.create(listOf(binder), listOf(wishlist), emptyList(), "now")),
        )

        assertEquals(3, decoded.binders.single().cards.single().quantity)
        assertTrue(decoded.wishlists.single().matchAnyPrinting)
        assertEquals(2, decoded.wishlists.single().cards.single().desiredQuantity)
    }

    @Test
    fun `csv quotes commas and collector numbers`() {
        val binder = Binder("b1", "Trade, binder", cards = listOf(OwnedCard("copy", "b1", card, 1)))
        val csv = CollectionBackupJson.collectionCsv(listOf(binder))

        assertTrue(csv.contains("\"Trade, binder\""))
        assertTrue(csv.contains("\"25\""))
    }
}
