package com.ahmadjalil.tcger.feature.settingsparity

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsParityFeatureTest {
    @Test fun `local price catalog only advertises usable providers`() {
        val catalog = localPriceSources()
        assertEquals("automatic", catalog.defaultSource)
        assertEquals(listOf("automatic", "scryfall"), catalog.sources.map(PriceSourceOption::id))
        assertEquals(listOf("magic"), catalog.sources.single { it.id == "scryfall" }.games)
    }

    @Test fun `access policy patch omits settings not being changed`() {
        val payload = Json.encodeToString(UpdateServerAccessPolicy(publicDashboard = true))
        assertTrue("\"publicDashboard\":true" in payload)
        assertFalse("publicCollections" in payload)
        assertFalse("requireAuth" in payload)
    }

    @Test fun `transaction validation rejects invalid money and currency`() {
        assertFalse(CreateFinanceTransaction(TransactionType.PURCHASE, amount = 0.0).isValid)
        assertFalse(CreateFinanceTransaction(TransactionType.PURCHASE, amount = 2.0, currency = "US").isValid)
        assertFalse(CreateFinanceTransaction(TransactionType.SALE, amount = 2.0, fees = -1.0).isValid)
        assertTrue(CreateFinanceTransaction(TransactionType.SALE, amount = 2.0, currency = "cad").isValid)
    }

    @Test fun `finance summary separates purchases sales and ignores trade cash direction`() {
        val items = listOf(
            transaction("p", TransactionType.PURCHASE, 40.0),
            transaction("s", TransactionType.SALE, 65.0),
            transaction("t", TransactionType.TRADE, 100.0),
        )
        assertEquals(FinanceSummary(40.0, 65.0, 25.0, 3), financeSummary(items))
    }

    @Test fun `transaction wire enums match API contract`() {
        val payload = Json.encodeToString(CreateFinanceTransaction(TransactionType.PURCHASE, amount = 12.0))
        assertTrue("\"type\":\"purchase\"" in payload)
    }

    private fun transaction(id: String, type: TransactionType, amount: Double) = FinanceTransaction(
        id = id, type = type, amount = amount, date = "2026-08-29T00:00:00Z",
    )
}
