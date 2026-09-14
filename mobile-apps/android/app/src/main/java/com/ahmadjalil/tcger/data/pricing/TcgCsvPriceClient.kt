package com.ahmadjalil.tcger.data.pricing

import com.ahmadjalil.tcger.domain.CatalogCard
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.text.Normalizer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request

/** Market references in USD; TCGCSV does not supply condition-specific prices. */
data class TcgCsvQuote(val price: Double, val sourceAsOf: String, val printing: String, val backup: Boolean) {
    val sourceLabel get() = "TCGCSV market · $printing · ${sourceAsOf.take(10)}${if (backup) " · backup" else ""}"
}
internal fun JsonObject.string(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull
internal fun JsonObject.list(key: String) = (get(key) as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
internal fun normalized(value: String?) = Normalizer.normalize(value.orEmpty().trim(), Normalizer.Form.NFC).lowercase(java.util.Locale.ROOT)
internal fun number(value: String?) = normalized(value).substringBefore('/').trimStart('0')
internal fun stampTime(value: String): Instant = runCatching { Instant.parse(value) }.getOrElse {
    OffsetDateTime.parse(value, DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssZ")).toInstant()
}
object TcgCsvMatch {
    fun group(card: CatalogCard, groups: List<JsonObject>): Int? {
        val name = normalized(card.setName); val code = normalized(card.setCode)
        return groups.filter {
            it["categoryId"]?.jsonPrimitive?.intOrNull == 3 &&
                ((name.isNotEmpty() && (name == normalized(it.string("name")) || name == normalized(it.string("name")?.substringAfter(':', "")))) ||
                    (code.isNotEmpty() && code == normalized(it.string("abbreviation"))))
        }.singleOrNull()?.get("groupId")?.jsonPrimitive?.intOrNull
    }
    fun quote(card: CatalogCard, set: JsonObject, finish: String? = null, language: String? = null, backup: Boolean = false): TcgCsvQuote? {
        if (normalized(language) !in setOf("", "en", "english")) return null
        val product = set.list("products").filter {
            val cardNumber = it.list("extendedData").firstOrNull { field -> field.string("name") == "Number" }?.string("value")
            it["categoryId"]?.jsonPrimitive?.intOrNull == 3 && it["groupId"] == set["groupId"] &&
                number(cardNumber).isNotEmpty() && number(card.collectorNumber).isNotEmpty() && number(cardNumber) == number(card.collectorNumber) && normalized(it.string("name")) == normalized(card.name)
        }.singleOrNull() ?: return null
        val aliases = mapOf("regular" to "normal", "nonfoil" to "normal", "non-foil" to "normal", "nonholo" to "normal", "non-holo" to "normal", "foil" to "holofoil", "holo" to "holofoil", "reverse" to "reverse holofoil", "reverse-holo" to "reverse holofoil", "reverse_holo" to "reverse holofoil", "reverse holo" to "reverse holofoil")
        val wanted = normalized(finish).let { aliases[it] ?: it }
        val printings = set.list("prices").filter { it["productId"] == product["productId"] }
        if (wanted.isEmpty() && printings.any { normalized(it.string("subTypeName")) !in setOf("normal", "holofoil", "reverse holofoil") }) return null
        val price = printings.filter {
            if (wanted.isEmpty()) normalized(it.string("subTypeName")) != "reverse holofoil" else normalized(it.string("subTypeName")) == wanted
        }.singleOrNull() ?: return null
        val market = price["marketPrice"]?.jsonPrimitive?.doubleOrNull?.takeIf { it.isFinite() && it >= 0 } ?: return null
        return TcgCsvQuote(market, set.string("sourceAsOf") ?: return null, price.string("subTypeName") ?: return null, backup)
    }
}

data class TcgCsvHttpResponse(val code: Int, val bytes: ByteArray, val retryAfter: String? = null)
class TcgCsvPriceClient(
    private val directory: File,
    private val clock: () -> Instant = Instant::now,
    private val transport: suspend (String) -> TcgCsvHttpResponse = { url ->
        http.newCall(Request.Builder().url(url).header("User-Agent", "TCGer/1.0 (Android native price cache)").header("Accept", "application/json,text/plain;q=0.9").build()).execute().use { response ->
            val body = response.body ?: throw IOException("Empty pricing response")
            val source = body.source()
            source.request(8_000_001)
            check(source.buffer.size <= 8_000_000) { "Price response too large" }
            TcgCsvHttpResponse(response.code, source.readByteArray(), response.header("Retry-After"))
        }
    },
) {
    companion object {
        private val http = OkHttpClient.Builder().callTimeout(java.time.Duration.ofSeconds(20)).build()
        private val instances = mutableMapOf<String, TcgCsvPriceClient>()
        @Synchronized fun shared(directory: File) = instances.getOrPut(directory.absolutePath) { TcgCsvPriceClient(directory) }
        const val BACKUP = "https://assets.tcger.ahmadjalil.com/prices/pokemon/"
        private const val DAY = 86_400L
    }
    private val mutex = Mutex()
    private val cacheFile = File(directory, "cache.json")
    private var state: MutableMap<String, JsonElement> = mutableMapOf()
    private var loaded = false
    private var nextRequestAt = 0L
    private fun time() = clock().epochSecond
    private fun long(key: String) = (state[key] as? JsonPrimitive)?.longOrNull ?: 0L
    private fun str(key: String) = (state[key] as? JsonPrimitive)?.contentOrNull.orEmpty()
    private fun obj(key: String) = state[key] as? JsonObject ?: JsonObject(emptyMap())
    private fun load() {
        if (loaded) return
        loaded = true
        if (cacheFile.exists() && cacheFile.length() < 64_000_000) state = runCatching { Json.parseToJsonElement(cacheFile.readText()).jsonObject.toMutableMap() }.getOrDefault(mutableMapOf())
    }
    private fun save() {
        directory.mkdirs()
        runCatching {
            val temporary = File(directory, "cache.tmp")
            temporary.writeText(JsonObject(state).toString())
            java.nio.file.Files.move(temporary.toPath(), cacheFile.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE)
        }
    }
    private fun cachedQuote(card: CatalogCard, finish: String?, language: String?): TcgCsvQuote? {
        val groups = (state["groups"] as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty().ifEmpty { obj("backup").list("groups") }
        val id = TcgCsvMatch.group(card, groups) ?: return null
        val saved = obj("sets")[id.toString()]?.jsonObject ?: return null
        return TcgCsvMatch.quote(card, saved.getValue("data").jsonObject, finish, language, saved["backup"]?.jsonPrimitive?.booleanOrNull == true)
    }
    suspend fun cached(card: CatalogCard, finish: String? = null, language: String? = null): TcgCsvQuote? = withContext(Dispatchers.IO) {
        mutex.withLock { load(); cachedQuote(card, finish, language) }
    }
    suspend fun quote(card: CatalogCard, finish: String? = null, language: String? = null): TcgCsvQuote? = withContext(Dispatchers.IO) {
        mutex.withLock {
            load()
            if (card.tcg != "pokemon" || normalized(language) !in setOf("", "en", "english")) return@withLock null
            try { refresh(card) } finally { save() }
            cachedQuote(card, finish, language)
        }
    }
    private suspend fun get(path: String, primary: Boolean): ByteArray {
        if (primary && time() < long("blockedUntil")) throw IOException("Provider cooling down")
        if (time() - long("budgetStart") >= DAY) { state["budgetStart"] = JsonPrimitive(time()); state["requests"] = JsonPrimitive(0) }
        check(long("requests") < 1500) { "Daily request budget reached" }
        delay((nextRequestAt - System.currentTimeMillis()).coerceAtLeast(0))
        nextRequestAt = System.currentTimeMillis() + 250
        state["requests"] = JsonPrimitive(long("requests") + 1); save()
        val response = transport((if (primary) "https://tcgcsv.com/" else BACKUP) + path)
        if (primary && response.code in setOf(429, 503)) {
            val wait = response.retryAfter?.toLongOrNull() ?: runCatching { java.time.ZonedDateTime.parse(response.retryAfter, DateTimeFormatter.RFC_1123_DATE_TIME).toEpochSecond() - time() }.getOrDefault(600)
            state["blockedUntil"] = JsonPrimitive(time() + wait.coerceAtLeast(600)); save()
        }
        if (response.code != 200 || response.bytes.size > 8_000_000) throw IOException("Invalid price response (${response.code})")
        return response.bytes
    }
    private suspend fun getJson(path: String, primary: Boolean) = Json.parseToJsonElement(get(path, primary).decodeToString()).jsonObject
    private fun validStamp(stamp: String) = stampTime(stamp) <= clock().plusSeconds(3600)
    private suspend fun backupManifest(): JsonObject {
        if (time() - long("backupCheckedAt") < DAY && obj("backup").isNotEmpty()) return obj("backup")
        check(time() - long("backupCheckedAt") >= 600) { "Backup cooling down" }
        state["backupCheckedAt"] = JsonPrimitive(time()); save()
        val backup = getJson("manifest.json", false)
        check(backup.string("schema") == "tcger-pokemon-prices-backup-v1" && validStamp(backup.string("sourceAsOf").orEmpty()) && backup.list("groups").size <= 1000)
        state["backup"] = backup; save(); return backup
    }
    private suspend fun refresh(card: CatalogCard) {
        try {
            if (time() - long("checkedAt") >= DAY) {
                val stamp = get("last-updated.txt", true).decodeToString().trim()
                check(validStamp(stamp))
                if (str("stamp") != stamp || state["groups"] == null) {
                    val groups = getJson("tcgplayer/3/groups", true)
                    check(groups["success"]?.jsonPrimitive?.booleanOrNull == true && groups.list("results").size in 1..1000)
                    state["groups"] = groups.getValue("results")
                }
                state["stamp"] = JsonPrimitive(stamp); state["checkedAt"] = JsonPrimitive(time()); save()
            }
            val groups = (state["groups"] as? JsonArray)?.map { it.jsonObject }.orEmpty()
            val id = TcgCsvMatch.group(card, groups) ?: return
            val saved = obj("sets")[id.toString()]?.jsonObject
            if (saved?.get("backup")?.jsonPrimitive?.booleanOrNull == false && saved["data"]?.jsonObject?.string("sourceAsOf") == str("stamp")) return
            if (time() - (obj("attempts")[id.toString()]?.jsonPrimitive?.longOrNull ?: 0) < DAY) return
            state["attempts"] = JsonObject(obj("attempts") + (id.toString() to JsonPrimitive(time()))); save()
            val products = getJson("tcgplayer/3/$id/products", true)
            val prices = getJson("tcgplayer/3/$id/prices", true)
            check(products["success"]?.jsonPrimitive?.booleanOrNull == true && prices["success"]?.jsonPrimitive?.booleanOrNull == true)
            store(buildJsonObject { put("groupId", id); put("sourceAsOf", str("stamp")); put("products", products.getValue("results")); put("prices", prices.getValue("results")) }, false)
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            state["blockedUntil"] = JsonPrimitive(maxOf(long("blockedUntil"), time() + 600))
            try {
                val backup = backupManifest()
                val id = TcgCsvMatch.group(card, backup.list("groups")) ?: return
                val asset = backup["sets"]?.jsonObject?.get(id.toString())?.jsonObject ?: return
                val saved = obj("sets")[id.toString()]?.jsonObject
                if (saved != null && stampTime(saved.getValue("data").jsonObject.string("sourceAsOf").orEmpty()) >= stampTime(backup.string("sourceAsOf").orEmpty())) return
                if (time() - (obj("backupAttempts")[id.toString()]?.jsonPrimitive?.longOrNull ?: 0) < 600) return
                state["backupAttempts"] = JsonObject(obj("backupAttempts") + (id.toString() to JsonPrimitive(time()))); save()
                val hash = asset.string("sha256").orEmpty(); val file = asset.string("file").orEmpty()
                check(hash.matches(Regex("[a-f0-9]{64}")) && file == "objects/$hash.json")
                val bytes = get(file, false)
                check(bytes.size == asset["bytes"]?.jsonPrimitive?.intOrNull && MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) } == hash)
                val set = Json.parseToJsonElement(bytes.decodeToString()).jsonObject
                check(set["groupId"]?.jsonPrimitive?.intOrNull == id && set["sourceAsOf"] == backup["sourceAsOf"])
                store(set, true)
            } catch (failure: Exception) { if (failure is CancellationException) throw failure /* Retain dated cache. */ }
        }
    }
    private fun store(set: JsonObject, backup: Boolean) {
        val sets = obj("sets").toMutableMap()
        val saved = sets[set.getValue("groupId").jsonPrimitive.content]?.jsonObject?.get("data")?.jsonObject
        if (saved != null && stampTime(saved.string("sourceAsOf").orEmpty()) > stampTime(set.string("sourceAsOf").orEmpty())) return
        sets[set.getValue("groupId").jsonPrimitive.content] = buildJsonObject { put("data", set); put("backup", backup); put("checkedAt", time()) }
        while (sets.size > 256) sets.remove(sets.minBy { it.value.jsonObject["checkedAt"]?.jsonPrimitive?.longOrNull ?: 0 }.key)
        state["sets"] = JsonObject(sets)
    }
}
