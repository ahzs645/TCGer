package com.ahmadjalil.tcger.data.pricing

import com.ahmadjalil.tcger.domain.CatalogCard
import java.nio.file.Files
import java.time.Instant
import java.security.MessageDigest
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class TcgCsvPriceClientTest {
    private val card = CatalogCard("swsh12-139", "Lugia VSTAR", "pokemon", setName = "Silver Tempest", setCode = "swsh12", collectorNumber = "139")
    private val stamp = "2026-09-13T20:05:38.000Z"
    private val now = Instant.parse("2026-09-14T12:00:00Z")
    private val groups = """[{"groupId":3170,"name":"SWSH12: Silver Tempest","abbreviation":"SWSH12","categoryId":3}]"""
    private val products = """[{"productId":451396,"name":"Lugia VSTAR","groupId":3170,"categoryId":3,"extendedData":[{"name":"Number","value":"139/195"}]}]"""
    private val prices = """[{"productId":451396,"subTypeName":"Holofoil","marketPrice":6.96}]"""
    private fun shard(prices: String = this.prices) = """{"groupId":3170,"sourceAsOf":"$stamp","products":$products,"prices":$prices}"""
    private fun obj(value: String) = Json.parseToJsonElement(value).jsonObject
    private fun fixtures() = mutableMapOf(
        "https://tcgcsv.com/last-updated.txt" to TcgCsvHttpResponse(200, stamp.toByteArray()),
        "https://tcgcsv.com/tcgplayer/3/groups" to TcgCsvHttpResponse(200, """{"success":true,"results":$groups}""".toByteArray()),
        "https://tcgcsv.com/tcgplayer/3/3170/products" to TcgCsvHttpResponse(200, """{"success":true,"results":$products}""".toByteArray()),
        "https://tcgcsv.com/tcgplayer/3/3170/prices" to TcgCsvHttpResponse(200, """{"success":true,"results":$prices}""".toByteArray()),
    )
    @Test fun exactMatchingRejectsWrongPrintingLanguageAmbiguityAndNullMarket() {
        val groupList = Json.parseToJsonElement(groups).jsonArray.map { it.jsonObject }
        assertEquals(3170, TcgCsvMatch.group(card, groupList))
        assertNull(TcgCsvMatch.group(card, groupList + groupList))
        assertEquals(6.96, TcgCsvMatch.quote(card, obj(shard()))!!.price, 0.001)
        assertNull(TcgCsvMatch.quote(card.copy(collectorNumber = "138"), obj(shard())))
        assertNull(TcgCsvMatch.quote(card, obj(shard()), finish = "reverse-holo"))
        assertNull(TcgCsvMatch.quote(card, obj(shard()), language = "Japanese"))
        val editions = obj(shard("""[{"productId":451396,"subTypeName":"1st Edition Holofoil","marketPrice":50},{"productId":451396,"subTypeName":"Unlimited Holofoil","marketPrice":5}]"""))
        assertNull(TcgCsvMatch.quote(card, editions))
        assertEquals(50.0, TcgCsvMatch.quote(card, editions, finish = "1st Edition Holofoil")!!.price, 0.001)
        assertNull(TcgCsvMatch.quote(card, obj(shard("""[{"productId":451396,"subTypeName":"Holofoil","marketPrice":null,"lowPrice":3}]"""))))
    }
    @Test fun dailyCacheSurvivesRelaunchAndConcurrentCalls() = runBlocking {
        val directory = Files.createTempDirectory("tcgcsv-test").toFile()
        try {
            val fixture = fixtures(); val requests = mutableListOf<String>()
            val client = TcgCsvPriceClient(directory, { now }) { requests += it; fixture.getValue(it) }
            val first = async { client.quote(card) }; val second = async { client.quote(card) }
            assertEquals(6.96, first.await()!!.price, 0.001); assertEquals(6.96, second.await()!!.price, 0.001)
            assertEquals(4, requests.size)
            val restarted = TcgCsvPriceClient(directory, { now }) { error("Unexpected network request: $it") }
            assertEquals(stamp, restarted.cached(card)!!.sourceAsOf)
            assertEquals(stamp, restarted.quote(card)!!.sourceAsOf)
        } finally { directory.deleteRecursively() }
    }
    @Test fun rateLimitUsesBackupAndKeepsItOffline() = runBlocking {
        val directory = Files.createTempDirectory("tcgcsv-test").toFile()
        try {
            val data = shard().toByteArray()
            val hash = MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }
            val manifest = """{"schema":"tcger-pokemon-prices-backup-v1","sourceAsOf":"$stamp","groups":$groups,"sets":{"3170":{"file":"objects/$hash.json","sha256":"$hash","bytes":${data.size}}}}"""
            val requests = mutableListOf<String>()
            val fixture = mapOf(
                "https://tcgcsv.com/last-updated.txt" to TcgCsvHttpResponse(429, byteArrayOf(), "3600"),
                TcgCsvPriceClient.BACKUP + "manifest.json" to TcgCsvHttpResponse(200, manifest.toByteArray()),
                TcgCsvPriceClient.BACKUP + "objects/$hash.json" to TcgCsvHttpResponse(200, data),
            )
            val client = TcgCsvPriceClient(directory, { now }) { requests += it; fixture.getValue(it) }
            val quote = client.quote(card)!!
            assertTrue(quote.backup); assertEquals(6.96, quote.price, 0.001)
            val restarted = TcgCsvPriceClient(directory, { now }) { error("No request allowed during cooldown") }
            assertEquals(stamp, restarted.quote(card)!!.sourceAsOf)
            assertEquals(3, requests.size)
        } finally { directory.deleteRecursively() }
    }
    @Test fun invalidBackupChecksumIsRejectedAndRetriedWithCooldown() = runBlocking {
        val directory = Files.createTempDirectory("tcgcsv-test").toFile()
        try {
            val data = shard().toByteArray(); val hash = "0".repeat(64)
            val manifest = """{"schema":"tcger-pokemon-prices-backup-v1","sourceAsOf":"$stamp","groups":$groups,"sets":{"3170":{"file":"objects/$hash.json","sha256":"$hash","bytes":${data.size}}}}"""
            var requests = 0
            val client = TcgCsvPriceClient(directory, { now }) {
                requests++
                when {
                    it.endsWith("manifest.json") -> TcgCsvHttpResponse(200, manifest.toByteArray())
                    it.endsWith(".json") -> TcgCsvHttpResponse(200, data)
                    else -> TcgCsvHttpResponse(503, byteArrayOf())
                }
            }
            assertNull(client.quote(card)); assertNull(client.quote(card)); assertEquals(3, requests)
        } finally { directory.deleteRecursively() }
    }
    @Test fun nextDayFailureRetainsSourceDateAndNeverReplacesWithOlderBackup() = runBlocking {
        val directory = Files.createTempDirectory("tcgcsv-test").toFile()
        try {
            val fixture = fixtures()
            val client = TcgCsvPriceClient(directory, { now }) { fixture.getValue(it) }
            assertNotNull(client.quote(card))
            val offline = TcgCsvPriceClient(directory, { now.plusSeconds(86401) }) { TcgCsvHttpResponse(503, byteArrayOf()) }
            assertEquals(stamp, offline.quote(card)!!.sourceAsOf)
        } finally { directory.deleteRecursively() }
    }
}
