package com.ahmadjalil.tcger.data.backup

import com.ahmadjalil.tcger.domain.*
import java.io.File
import java.math.BigDecimal
import org.junit.Assert.*
import org.junit.Test

class PortableParityTest {
    private fun fixture(): String {
        val root = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }.first { File(it, "mobile-parity/fixtures/portable-backup-v2.json").exists() }
        return File(root, "mobile-parity/fixtures/portable-backup-v2.json").readText()
    }
    @Test fun `shared fixture preserves physical copies game identity and every metadata field`() {
        val backup = CollectionBackupJson.decode(fixture())
        val plan = backup.importPlan(emptyList())
        assertEquals(3, plan.binders.single().cards.size)
        assertEquals(3, plan.binders.single().cards.map { it.id }.distinct().size)
        assertEquals(setOf("pokemon", "magic"), plan.binders.single().cards.map { it.tcg }.toSet())
        val first = plan.binders.single().cards.first()
        assertEquals("LP", first.condition); assertEquals(10.5, first.price!!, 0.0); assertEquals(4.25, first.acquisitionPrice!!, 0.0)
        assertTrue(first.detailsJson.contains("physical-1")); assertTrue(first.detailsJson.contains("Favorites"))
        assertNull(plan.binders.single().cards[1].condition)
        assertEquals(plan, CollectionBackupJson.decode(CollectionBackupJson.encode(backup)).importPlan(emptyList()))
        assertTrue(CollectionBackupJson.encode(backup).contains("preserve-me"))
    }
    @Test fun `repeated legacy imports produce the same copy IDs without stacking`() {
        val backup = CollectionBackupJson.decode(fixture()).copy(binders = listOf(PortableBinder(name="Old",colorHex="315DA8",cards=listOf(PortableOwnedCard(PortableCard("001","Pikachu","pokemon"),3)))))
        val first = backup.importPlan(emptyList()); val second = backup.copy(exportedAt="2026-09-05T12:00:00Z").importPlan(emptyList())
        assertEquals(first.binders, second.binders)
        assertEquals(listOf(1,1,1), first.binders.single().cards.map { it.quantity })
        assertEquals(3, first.binders.single().cards.map { it.id }.distinct().size)
    }
    @Test fun `CSV roundtrip preserves multiline notes prices and printing identity`() {
        val portable = CollectionBackupJson.decode(fixture()).binders.single()
        val cards = portable.cards.map { OwnedCard(it.id!!,"b",it.card.toCatalogCard(),it.quantity,it.condition,it.price,it.acquisitionPrice,it.details) }
        val parsed = parseCollectionCsv(CollectionBackupJson.collectionCsv(listOf(Binder("b",portable.name,cards=cards))))
        assertEquals("001", parsed.binders.single().cards.first().card.id)
        assertEquals(cards.first().details.notes, parsed.binders.single().cards.first().details.notes)
        assertEquals(cards.first().acquisitionPrice, parsed.binders.single().cards.first().acquisitionPrice)
        assertEquals(cards.first().details.isFoil, parsed.binders.single().cards.first().details.isFoil)
    }
    @Test fun `missing rates retain source currency and valid rates convert value`() {
        val usd = Money(BigDecimal("100"),"USD")
        assertEquals(usd, usd.convert("CAD",null)); assertEquals(usd, usd.convert("CAD",BigDecimal.ZERO))
        assertEquals(Money(BigDecimal("135.00"),"CAD"), usd.convert("CAD",BigDecimal("1.35")))
    }
    @Test fun `reject malformed file before constructing a write plan`() {
        assertThrows(IllegalArgumentException::class.java) { CollectionBackupJson.decode(fixture().replace("10.5", "-10.5")) }
        assertThrows(IllegalArgumentException::class.java) { parseCollectionCsv("name,tcg\nPikachu,pokemon") }
        assertThrows(IllegalArgumentException::class.java) { parseCollectionCsv("externalId,name,tcg\n001,\"Pikachu,pokemon") }
    }
    @Test fun `identity and smart rules retain game boundaries`() {
        val pokemon = CatalogCard("001","Pikachu","pokemon")
        val magic = CatalogCard("001","Pikachu","magic")
        assertNotEquals(pokemon.identity(),magic.identity())
        val rule = WishlistRule(type="name",tcg="pokemon",query="Pikachu")
        assertTrue(rule.matches(pokemon)); assertFalse(rule.matches(magic))
    }
    @Test fun `duplicate backup copy IDs fail before any writes`() {
        assertThrows(IllegalArgumentException::class.java) { CollectionBackupJson.decode(fixture().replace("pokemon-copy-2", "pokemon-copy-1")) }
    }
    @Test fun `smart folders require condition and tag on the same physical copy`() {
        val card = CatalogCard("001", "Pikachu", "pokemon")
        val tagged = OwnedCard("one", "binder", card, 1, condition = "LP", details = CollectionDetails(tags = listOf(CollectionTag(label = "Favorites"))))
        val nearMint = OwnedCard("two", "binder", card, 1, condition = "NM")
        val folder = SmartFolder("folder", "NM favorites", rules = listOf(SmartFolderRule("c", "condition", "NM"), SmartFolderRule("t", "tag", "Favorites")))
        assertFalse(folder.matches(tagged)); assertFalse(folder.matches(nearMint))
        assertTrue(folder.matches(tagged.copy(condition = "NM")))
    }

}
