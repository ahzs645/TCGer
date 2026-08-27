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
}
