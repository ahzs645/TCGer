package com.ahmadjalil.tcger.ui.packopening

import com.ahmadjalil.tcger.domain.SealedInventoryItem
import com.ahmadjalil.tcger.domain.SealedProduct
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PackOpeningBridgeDecoderTest {
    @Test
    fun `decodes the complete native state emitted by pack-core`() {
        val event = PackOpeningBridgeDecoder.decode(nativeStateJSON)
            as PackOpeningBridgeEvent.NativeState

        assertEquals(PackOpeningPhase.REVEAL, event.state.phase)
        assertEquals(PackOpeningMode.NORMAL, event.state.openingMode)
        assertEquals("Base Set · Charizard wrapper", event.state.selectedPackDisplayLabel)
        assertEquals(1, event.state.packSets.size)
        assertEquals(2, event.state.selectedCardPool?.cards?.size)
        assertEquals("Community pull data", event.state.selectedOddsReference?.title)
        assertEquals("Charizard", event.state.session?.bestPull?.name)
    }

    @Test
    fun `decodes save request into callback session boundary`() {
        val payload = """{
          "type":"saveRequested",
          "session":$sessionJSON
        }"""

        val event = PackOpeningBridgeDecoder.decode(payload)
            as PackOpeningBridgeEvent.SaveRequested

        assertEquals("opening-1", event.session.id)
        assertEquals(2, event.session.pulls.size)
        assertEquals("Charizard", event.session.bestPull?.name)
    }

    @Test
    fun `commands match the shared JavaScript wire contract`() {
        assertEquals(
            "{\"type\":\"setOpeningMode\",\"mode\":\"quick\"}",
            PackOpeningCommand.setOpeningMode(PackOpeningMode.QUICK).encode(),
        )
        assertEquals(
            "{\"type\":\"setPackCount\",\"count\":10}",
            PackOpeningCommand.setPackCount(10).encode(),
        )
        assertTrue(PackOpeningCommand.selectPack("base1:charizard").encode().contains("base1:charizard"))
    }

    @Test
    fun `invalid event is ignored instead of crashing the host`() {
        assertEquals(null, PackOpeningBridgeDecoder.decode("not json"))
        assertNotNull(PackOpeningBridgeDecoder.decode("""{"type":"error","message":"failed"}"""))
    }

    @Test
    fun `inspection navigation stops at boundaries and share text carries card identity`() {
        assertEquals(1, adjacentPullIndex(current = 0, direction = 1, count = 2))
        assertEquals(null, adjacentPullIndex(current = 0, direction = -1, count = 2))
        assertEquals(null, adjacentPullIndex(current = 1, direction = 1, count = 2))

        val pull = PackOpeningBridgeDecoder.decode("""{"type":"saveRequested","session":$sessionJSON}""")
            .let { it as PackOpeningBridgeEvent.SaveRequested }
            .session.pulls.first()
        assertEquals(
            "Charizard — Base Set #4\nhttps://example.test/4/high.webp",
            packShareText(pull),
        )
    }

    @Test
    fun `set picker filters search and downloaded availability independently`() {
        val base = PackOpeningPackSet(
            id = "base1",
            label = "Base Set",
            options = listOf(PackOpeningPackOption("base1-zard", "Charizard", variationLabel = "Charizard")),
        )
        val jungle = PackOpeningPackSet(
            id = "jungle",
            label = "Jungle",
            options = listOf(PackOpeningPackOption("jungle-wiggly", "Wigglytuff", variationLabel = "Wigglytuff")),
        )
        val downloaded = PackOfflineSetStatus.Downloaded(
            PackOfflineDownloadRecord("base1", "Base Set", 1L, 2, 3L, emptyList()),
        )

        assertEquals(
            listOf(base),
            filterPackSets(listOf(base, jungle), "char", PackSetAvailabilityFilter.ALL, mapOf("base1" to downloaded)),
        )
        assertEquals(
            listOf(base),
            filterPackSets(listOf(base, jungle), "", PackSetAvailabilityFilter.DOWNLOADED, mapOf("base1" to downloaded)),
        )
        assertEquals(
            listOf(jungle),
            filterPackSets(listOf(base, jungle), "", PackSetAvailabilityFilter.NOT_DOWNLOADED, mapOf("base1" to downloaded)),
        )
    }

    @Test
    fun `sealed inventory eligibility matches loose booster tcg set and quantity`() {
        val session = PackOpeningBridgeDecoder.decode("""{"type":"saveRequested","session":$sessionJSON}""")
            .let { it as PackOpeningBridgeEvent.SaveRequested }.session
        fun item(type: String = "booster_pack", set: String = "base1", quantity: Int = 1) =
            SealedInventoryItem(
                id = "inventory",
                product = SealedProduct("product", "pokemon", "Base booster", type, setCode = set),
                quantity = quantity,
            )

        assertTrue(item().canRecordOpening(session))
        assertTrue(!item(type = "booster_box").canRecordOpening(session))
        assertTrue(!item(set = "jungle").canRecordOpening(session))
        assertTrue(!item(quantity = 0).canRecordOpening(session))
    }

    private companion object {
        val pullOne = """{
          "cardId":"base1-4","name":"Charizard","rarity":"Rare Holo","tier":"chase",
          "collectorNumber":"4","tcg":"pokemon","setCode":"base1","setName":"Base Set",
          "imageUrl":"https://example.test/4/high.webp","imageUrlSmall":"https://example.test/4/low.webp"
        }""".trimIndent()
        val pullTwo = """{
          "cardId":"base1-44","name":"Bulbasaur","rarity":"Common","tier":"common",
          "collectorNumber":"44","tcg":"pokemon","setCode":"base1","setName":"Base Set",
          "imageUrl":"https://example.test/44/high.webp","imageUrlSmall":"https://example.test/44/low.webp"
        }""".trimIndent()
        val sessionJSON = """{
          "id":"opening-1","packLabel":"Base Set · Charizard wrapper","openedAt":"2026-08-26T00:00:00Z",
          "packs":[[$pullOne,$pullTwo]]
        }""".trimIndent()
        val nativeStateJSON = """{
          "type":"nativeState",
          "state":{
            "phase":"reveal","selectedPackID":"base1:charizard","selectedPackLabel":"Base Set · Charizard wrapper",
            "packCount":1,"openingMode":"normal","packBackwards":true,"currentCardFaceUp":false,
            "packOptions":[{
              "id":"base1:charizard","label":"Base Set · Charizard wrapper","setID":"base1","setLabel":"Base Set",
              "variationLabel":"Charizard wrapper","packPoolID":"base1",
              "oddsReference":{"title":"Community pull data","url":"https://example.test/odds","sampleSize":153,"note":"Not official odds."}
            }],
            "cardPools":[{"id":"base1","label":"Base Set","cards":[$pullOne,$pullTwo]}],
            "revealedCount":1,"totalCards":11,"currentPackNumber":1,"totalPacks":1,"canSave":false,
            "session":$sessionJSON
          }
        }""".trimIndent()
    }
}
