package com.ahmadjalil.tcger.ui.catalogparity

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogParityModelsTest {
    @Test fun `standard and master totals match iOS fallback rules`() {
        val set = CatalogSet("sv1", "Scarlet & Violet", "pokemon", totalCards = 258, standardCards = 198)
        assertEquals(198, SetProgressCalculator.total(set, SetCompletionMode.STANDARD))
        assertEquals(258, SetProgressCalculator.total(set, SetCompletionMode.MASTER))
        assertEquals(258, SetProgressCalculator.total(set.copy(standardCards = null), SetCompletionMode.STANDARD))
    }

    @Test fun `pokemon standard completion excludes secret collector numbers`() {
        assertTrue(SetProgressCalculator.includes("198/198", "pokemon", 198, SetCompletionMode.STANDARD))
        assertFalse(SetProgressCalculator.includes("199/198", "pokemon", 198, SetCompletionMode.STANDARD))
        assertTrue(SetProgressCalculator.includes("TG01", "pokemon", 198, SetCompletionMode.STANDARD))
        assertTrue(SetProgressCalculator.includes("199", "pokemon", 198, SetCompletionMode.MASTER))
        assertTrue(SetProgressCalculator.includes("199", "magic", 198, SetCompletionMode.STANDARD))
    }

    @Test fun `set ownership counts unique printings and ignores zero quantity`() {
        val set = CatalogSet("base1", "Base", "pokemon", totalCards = 102, standardCards = 102)
        val ownership = listOf(
            OwnedPrinting("a", "pokemon", "BASE1", "1/102", "A", 1),
            OwnedPrinting("a", "pokemon", "base1", "1/102", "A", 3),
            OwnedPrinting("b", "pokemon", "base1", "2/102", "B", 0),
        )
        assertEquals(1, SetProgressCalculator.bySet(listOf(set), ownership, SetCompletionMode.STANDARD)[set.id]?.owned)
    }

    @Test fun `pokedex progress resolves owned card dex entries through catalog printing`() {
        val bulbasaur = PokedexEntry(1, "Bulbasaur")
        val pikachu = PokedexEntry(25, "Pikachu")
        val catalog = listOf(
            CatalogParityCard("bulb-1", "Bulbasaur", "pokemon", dexEntries = listOf(bulbasaur)),
            CatalogParityCard("pika-1", "Pikachu", "pokemon", dexEntries = listOf(pikachu)),
            CatalogParityCard("pika-2", "Pikachu", "pokemon", dexEntries = listOf(pikachu)),
        )
        val progress = PokedexProgressBuilder.build(
            catalog,
            ownedCards = listOf(OwnedPrinting("pika-2", "pokemon", name = "Pikachu", quantity = 2)),
            nationalDex = listOf(bulbasaur, pikachu),
        )
        assertFalse(progress.first { it.entry.number == 1 }.isOwned)
        assertEquals(2, progress.first { it.entry.number == 25 }.ownedCopies)
        assertEquals(2, progress.first { it.entry.number == 25 }.printings.size)
    }

    @Test fun `guide category uses server wire value`() {
        val guide = Json { ignoreUnknownKeys = true }.decodeFromString<CollectionGuide>(
            """{"id":"1","slug":"art","title":"Art","description":"d","tcg":"pokemon","category":"art-style","rule":{"type":"tag","tcg":"pokemon","query":"art","includeAllPrintings":true}}""",
        )
        assertEquals(GuideCategory.ART_STYLE, guide.category)
        assertEquals("art-style", guideCategoryApiValue(guide.category))
    }

    @Test fun `local source derives sets searches guides and follows once`() = runTest {
        var followCalls = 0
        val cards = listOf(
            CatalogParityCard("ditto-a", "Ditto", "pokemon", "base3", "Fossil"),
            CatalogParityCard("other", "Pikachu", "pokemon", "base1", "Base"),
        )
        val source = LocalCatalogParityDataSource(cards, onFollow = { _, _, _ ->
            followCalls++
            "wishlist-$followCalls"
        })
        assertEquals(2, source.sets("pokemon").sets.size)
        val result = source.guideCards(GuideCardFilters(guide = "every-ditto"))
        assertEquals(listOf("ditto-a"), result.results.map { it.card.id })
        assertEquals(9, source.guideCards(GuideCardFilters(guide = "pokemon-crown-zenith-connected-art")).total)
        assertTrue(source.followGuide("every-ditto").created)
        assertFalse(source.followGuide("every-ditto").created)
        assertEquals(1, followCalls)
        assertTrue(source.guides().first { it.slug == "every-ditto" }.followed)
    }
}
