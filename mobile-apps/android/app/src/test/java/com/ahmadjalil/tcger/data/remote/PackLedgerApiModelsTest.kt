package com.ahmadjalil.tcger.data.remote

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class PackLedgerApiModelsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `add card response exposes created collection copy ID`() {
        val direct = json.decodeFromString<AddedCollectionCopyDto>("""{"id":"copy-1","quantity":1}""")
        val envelope = json.decodeFromString<AddedCollectionCopyDto>("""{"copies":[{"id":"copy-2"}]}""")

        assertEquals("copy-1", direct.createdCopyId)
        assertEquals("copy-2", envelope.createdCopyId)
    }

    @Test
    fun `sealed inventory and opening responses decode backend contract`() {
        val inventory = json.decodeFromString<SealedInventoryItemDto>(
            """{
              "id":"inventory-1","quantity":3,"purchasePrice":4.99,
              "product":{"id":"product-1","tcg":"pokemon","name":"Base booster","productType":"booster_pack","setCode":"base1"}
            }""".trimIndent(),
        )
        val opening = json.decodeFromString<SealedOpeningDto>(
            """{"id":"opening-1","sealedInventoryId":"inventory-1","openedQuantity":1,"openedAt":"2026-08-26T00:00:00Z"}""",
        )

        assertEquals("base1", inventory.product.setCode)
        assertEquals(3, inventory.quantity)
        assertEquals("inventory-1", opening.sealedInventoryId)
    }

    @Test
    fun `sealed opening ledger decodes cards and pnl`() {
        val ledger = json.decodeFromString<SealedOpeningLedgerDto>(
            """{
              "id":"ledger-1","inventoryId":"inventory-1","productName":"Base booster",
              "openedQuantity":1,"openedAt":"2026-08-26T00:00:00Z","invested":5.0,
              "liveValue":12.0,"realizedProceeds":3.0,"profitLoss":10.0,
              "activeCopies":1,"soldCopies":1,
              "cards":[{"id":"pull-1","externalId":"base-4","tcg":"pokemon","cardName":"Charizard","quantity":1,"status":"active","liveValue":12.0}]
            }""".trimIndent(),
        )

        assertEquals("Base booster", ledger.productName)
        assertEquals(10.0, ledger.profitLoss, 0.0)
        assertEquals("Charizard", ledger.cards.single().cardName)
    }
}
