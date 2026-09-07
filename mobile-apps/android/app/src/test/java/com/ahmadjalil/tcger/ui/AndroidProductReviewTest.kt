package com.ahmadjalil.tcger.ui

import com.ahmadjalil.tcger.domain.*
import com.ahmadjalil.tcger.data.preferences.SecretCipher
import com.ahmadjalil.tcger.feature.settingsparity.selectPersonalQuote
import org.junit.Assert.*
import org.junit.Test
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

class AndroidProductReviewTest {
    @Test fun appLinksOnlyRouteSupportedDestinations() {
        assertEquals(AppLink("search", "Pikachu ex"), parseAppLink("https://tcger.ahmadjalil.com/search?q=Pikachu+ex"))
        assertEquals(AppLink("scanner"), parseAppLink("tcger://scan"))
        assertEquals(AppLink("binder/abc-123"), parseAppLink("tcger://binder/abc-123"))
        assertNull(parseAppLink("https://evil.example/search?q=test"))
        assertNull(parseAppLink("javascript:alert(1)"))
    }

    @Test fun gameSearchIncludesIndependentPublishersWithoutLeakingOtherGames() {
        assertTrue(matchesSearchLibrary("pokemon", "publisher-demo-pkm", "pokemon"))
        assertTrue(matchesSearchLibrary(null, "publisher-demo-pkm", "pokemon"))
        assertTrue(matchesSearchLibrary("package:publisher-demo-pkm", "publisher-demo-pkm", "pokemon"))
        assertFalse(matchesSearchLibrary("magic", "publisher-demo-pkm", "pokemon"))
        assertFalse(matchesSearchLibrary("package:someone-else", "publisher-demo-pkm", "pokemon"))
    }
    @Test fun collectionSearchUsesGameAndPrintingIdentity() {
        val card = CatalogCard("publisher::001", "Pikachu", "pokemon", collectorNumber = "001", setName = "Test set")
        assertTrue(matchesOwnedSearch(card, "001", "pokemon"))
        assertTrue(matchesOwnedSearch(card, "pikachu", "package:publisher"))
        assertFalse(matchesOwnedSearch(card, "pikachu", "magic"))
        assertFalse(matchesOwnedSearch(card, "pikachu", "package:other"))
    }
    @Test fun filtersMatchTheSamePhysicalCopyAndSortNumbersNaturally() {
        val card = CatalogCard("p", "Pikachu", "pokemon", collectorNumber = "10")
        val first = OwnedCard("one", "binder", card, 1, "NM", 20.0, details = CollectionDetails(tags = listOf(CollectionTag(label = "Trade"))))
        val second = first.copy(id = "two", condition = "LP", details = CollectionDetails())
        assertEquals(listOf(first), browseCopies(listOf(first, second), "Pika", "NM", "Trade", BinderSort.NAME))
        assertTrue(browseCopies(listOf(first, second), "", "LP", "Trade", BinderSort.NAME).isEmpty())
        val third = first.copy(id = "three", card = card.copy(collectorNumber = "2"))
        assertEquals(listOf("three", "one"), browseCopies(listOf(first, third), "", null, null, BinderSort.NUMBER).map { it.id })
    }
    @Test fun hiddenNavigationDoesNotChangeCapabilityAvailability() {
        val prefs = AppPreferences(hiddenBottomNavigationItems = setOf(BottomNavigationItem.SCAN))
        assertFalse(BottomNavigationItem.SCAN in prefs.visibleBottomNavigationItems)
        assertTrue(BottomNavigationItem.SCAN.isAvailable(false, false, false))
        assertFalse(BottomNavigationItem.DECKS.isAvailable(false, true, true))
        assertFalse(BottomNavigationItem.DECKS.isSupportedBy(mapOf("decks" to false)))
        assertTrue(BottomNavigationItem.SETTINGS.isAvailable(false, false, false))
    }
    @Test fun encryptionIsRandomizedAuthenticatedAndBoundToTheDeviceKey() {
        val cipher = SecretCipher { SecretKeySpec(ByteArray(32) { 7 }, "AES") }
        val first = cipher.encrypt("a-test-session-token")
        val second = cipher.encrypt("a-test-session-token")
        assertNotEquals(first, second)
        assertEquals("a-test-session-token", cipher.decrypt(first))
        val bytes = java.util.Base64.getDecoder().decode(first); bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
        assertTrue(runCatching { cipher.decrypt(java.util.Base64.getEncoder().encodeToString(bytes)) }.isFailure)
        assertTrue(runCatching { SecretCipher { SecretKeySpec(ByteArray(32) { 8 }, "AES") }.decrypt(first) }.isFailure)
    }
    @Test fun pricingRequiresExactPrintingAndCopyVariant() {
        val payload = Json.parseToJsonElement("""{"data":[{"name":"Pikachu","number":"025","set_name":"Test Set","variants":[{"condition":"Near Mint","language":"English","printing":"Normal","price":12},{"condition":"Lightly Played","language":"English","printing":"Normal","price":8}]}]}""").jsonObject
        val owned = OwnedCard("copy", "binder", CatalogCard("25", "Pikachu", "pokemon", setName = "Test Set", collectorNumber = "25"), 1, "LP", 5.0)
        assertEquals(8.0, selectPersonalQuote(payload, owned, "match", "match")!!, 0.001)
        assertNull(selectPersonalQuote(payload, owned.copy(card = owned.card.copy(setName = "Different set")), "match", "match"))
        assertNull(selectPersonalQuote(payload, owned.copy(details = CollectionDetails(language = "Japanese")), "match", "match"))
    }
}
