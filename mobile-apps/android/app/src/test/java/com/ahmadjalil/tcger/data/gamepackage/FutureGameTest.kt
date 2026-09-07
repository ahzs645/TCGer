package com.ahmadjalil.tcger.data.gamepackage

import kotlinx.serialization.json.*
import java.security.MessageDigest
import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class FutureGameTest {
    private val json = Json { ignoreUnknownKeys = true }
    private fun resource(name: String) = requireNotNull(javaClass.classLoader?.getResourceAsStream("star-garden/$name")).use { it.readBytes() }
    @Test fun `future game fixture verifies and reuses deck printing price and pack contracts`() {
        val manifest = json.decodeFromString<GamePackageManifest>(resource("game-package.json").decodeToString())
        listOf(manifest.catalog.asset, manifest.pricing!!.asset, manifest.offlinePacks!!.manifest).forEach { asset ->
            val bytes = resource(asset.url)
            assertEquals(asset.bytes, bytes.size.toLong())
            assertEquals(asset.sha256, MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) })
        }
        val rules = manifest.definition!!.deckRules!!; rules.validateContract()
        val packs = json.decodeFromString<GamePackLibrary>(resource("packs.json").decodeToString()); packs.validateContract()
        val pulls = packs.packs.first().open { 0.0 }
        assertEquals(listOf("captain-1", "scout-1", "scout-2"), pulls)
        val cards = json.parseToJsonElement(resource("cards.json").decodeToString()).jsonObject["cards"]!!.jsonArray.map { it.jsonObject }.associateBy { it["id"]!!.jsonPrimitive.content }
        val deck = pulls.map { id -> val card = cards.getValue(id); GameDeckCard(id, card["name"]!!.jsonPrimitive.content, 1, if (id == "captain-1") "captain" else "lineup", "star-garden", card) }
        assertTrue(validateGameDeck("star-garden", deck, rules).valid)
        assertFalse(validateGameDeck("star-garden", deck + deck.last().copy(quantity = 2), rules).valid)
        val prices = json.decodeFromString<GamePriceSnapshot>(resource("prices.json").decodeToString()); prices.validateContract()
        assertEquals(2.0, prices.quote("scout-1", "USD", "scout-1", "matte", "NM", "English", Instant.parse("2026-09-05T00:00:00Z"))!!.amount, 0.0)
        assertNull(prices.quote("scout-1", "USD", "scout-1", "moon-glow", "NM", "English", Instant.parse("2026-09-05T00:00:00Z")))
        assertFalse(manifest.definition!!.printings!!.finishes.first().foil)
    }
    @Test fun `dated legality expires to unknown and invalid collation is rejected`() {
        val periods = listOf(GameLegalityPeriod("duel", true, "2026-01-01", "2026-02-01"))
        assertNull(gameCardLegality("duel", mapOf("duel" to true), periods, now = Instant.parse("2026-02-01T00:00:00Z")))
        val pack = GamePackLibrary("tcger-pack-library-v1", "star-garden", listOf(GamePackDefinition("a", "A", "A", slots = listOf(GamePackSlot(2, listOf(GamePackPoolEntry("a", 1.0)), true)))))
        assertThrows(IllegalArgumentException::class.java) { pack.validateContract() }
    }
}
