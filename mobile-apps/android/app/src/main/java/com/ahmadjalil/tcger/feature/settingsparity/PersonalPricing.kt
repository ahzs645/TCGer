package com.ahmadjalil.tcger.feature.settingsparity

import android.content.Context
import com.ahmadjalil.tcger.data.preferences.SecretCipher
import com.ahmadjalil.tcger.domain.*
import com.ahmadjalil.tcger.feature.portfolio.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.time.Instant

class PersonalPricingStore(context: Context) {
    private val prefs = context.getSharedPreferences("personal_pricing", Context.MODE_PRIVATE)
    private val cipher = SecretCipher()
    fun key(): String? = prefs.getString("key", null)?.let { runCatching { cipher.decrypt(it) }.getOrNull() }
    fun saveKey(value: String) { prefs.edit().putString("key", cipher.encrypt(value.trim())).apply() }
    fun removeKey() { prefs.edit().remove("key").apply() }
    var condition: String
        get() = prefs.getString("condition", "match").orEmpty()
        set(value) { prefs.edit().putString("condition", value).apply() }
    var language: String
        get() = prefs.getString("language", "match").orEmpty()
        set(value) { prefs.edit().putString("language", value).apply() }
}

/** Exact set/number identity and variant selection; ambiguity leaves the saved value intact. */
fun selectPersonalQuote(payload: JsonObject, owned: OwnedCard, condition: String, language: String): Double? {
    val cards = payload["data"] as? JsonArray ?: return null
    fun JsonObject.str(key: String) = this[key]?.jsonPrimitive?.contentOrNull
    val matching = cards.mapNotNull { it as? JsonObject }.filter { card ->
        card.str("name").equals(owned.card.name, true) &&
            !owned.card.collectorNumber.isNullOrBlank() && card.str("number")?.substringBefore('/')?.trimStart('0') == owned.card.collectorNumber.substringBefore('/').trimStart('0') &&
            (!owned.card.setName.isNullOrBlank() && card.str("set_name").equals(owned.card.setName, true) || !owned.card.setCode.isNullOrBlank() && card.str("set").equals(owned.card.setCode, true))
    }
    if (matching.size != 1) return null
    val conditionNames = mapOf("NM" to "Near Mint", "LP" to "Lightly Played", "MP" to "Moderately Played", "HP" to "Heavily Played", "DMG" to "Damaged", "M" to "Mint")
    val wantedCondition = if (condition == "match") owned.condition?.let { conditionNames[it.uppercase()] ?: it } ?: "Near Mint" else condition
    val wantedLanguage = if (language == "match") owned.details.language ?: "English" else language
    val wantedFinish = owned.details.finishCode.orEmpty().lowercase()
    return (matching.single()["variants"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
        .filter { it.str("condition").equals(wantedCondition, true) && it.str("language").equals(wantedLanguage, true) }
        .filter {
            val printing = it.str("printing").orEmpty().lowercase()
            when {
                wantedFinish.contains("etched") -> printing.contains("etched")
                wantedFinish.contains("reverse") -> printing.contains("reverse")
                owned.details.isFoil || wantedFinish.contains("holo") || wantedFinish == "foil" -> printing in setOf("foil", "holofoil", "holo")
                else -> printing in setOf("normal", "non-foil", "nonfoil", "regular")
            }
        }.singleOrNull()?.get("price")?.jsonPrimitive?.doubleOrNull?.takeIf { it.isFinite() && it > 0 }
}

class PersonalPricingClient(
    private val store: PersonalPricingStore,
    private val direct: com.ahmadjalil.tcger.data.pricing.TcgCsvPriceClient? = null,
    private val source: (String) -> String,
) {
    private val client = OkHttpClient.Builder().callTimeout(java.time.Duration.ofSeconds(20)).build()
    suspend fun test(): Long = withContext(Dispatchers.IO) {
        val start = System.nanoTime()
        get("https://api.justtcg.com/v1/cards?game=pokemon&limit=1", requireNotNull(store.key()) { "Save a personal key first" })
        (System.nanoTime() - start) / 1_000_000
    }
    private fun get(url: String, key: String? = null): JsonObject = client.newCall(Request.Builder().url(url)
        .header("Accept", "application/json").header("User-Agent", "TCGer/0.1 (Android pricing integration)")
        .apply { if (key != null) header("x-api-key", key) }.build()).execute().use {
        check(it.isSuccessful) { "Pricing provider returned ${it.code}. Check your configuration and try again." }
        Json.parseToJsonElement(requireNotNull(it.body).string()).jsonObject
    }
    suspend fun cached(binders: List<Binder>, portfolio: PricePortfolio): PricePortfolio = load(binders, portfolio, force = false, cacheOnly = true)
    suspend fun refresh(binders: List<Binder>, portfolio: PricePortfolio, force: Boolean = false): PricePortfolio = load(binders, portfolio, force, cacheOnly = false)
    private suspend fun load(binders: List<Binder>, portfolio: PricePortfolio, force: Boolean, cacheOnly: Boolean): PricePortfolio = withContext(Dispatchers.IO) {
        val copies = binders.flatMap { it.cards }
        val key = store.key()
        val quoteCache = mutableMapOf<String, JsonObject?>()
        var missed = 0
        val priced = portfolio.cards.map { tracked ->
            val matching = copies.filter { it.card.tcg == tracked.tcg && (it.card.exactPrintingId ?: it.card.id) == tracked.externalId }
            val requested = source(tracked.tcg)
            val quotes = matching.map { owned ->
                runCatching {
                    if (owned.card.tcg == "pokemon" && requested == "automatic" && direct != null) {
                        val finish = owned.details.finishCode ?: if (owned.details.isFoil) "holofoil" else null
                        val market = if (cacheOnly) direct.cached(owned.card, finish, owned.details.language)
                            else direct.quote(owned.card, finish, owned.details.language)
                        return@runCatching market?.let { it.price to it.sourceLabel }
                    }
                    if (cacheOnly || !force) return@runCatching null
                    val useJust = key != null && requested in setOf("automatic", "justtcg")
                    var quote: Pair<Double, String>? = null
                    if (useJust) {
                        val game = mapOf("magic" to "magic-the-gathering", "yugioh" to "yu-gi-oh", "onepiece" to "one-piece-card-game", "lorcana" to "disney-lorcana", "dragonball" to "dragon-ball-super-fusion-world")[owned.card.tcg] ?: owned.card.tcg
                        val url = "https://api.justtcg.com/v1/cards".toHttpUrl().newBuilder().addQueryParameter("q", owned.card.name).addQueryParameter("game", game).addQueryParameter("limit", "20").apply { owned.card.collectorNumber?.let { addQueryParameter("number", it) } }.build().toString()
                        val payload = if (quoteCache.containsKey(url)) quoteCache[url] else { delay(150); runCatching { get(url, key) }.getOrNull().also { quoteCache[url] = it } }
                        quote = payload?.let { selectPersonalQuote(it, owned, store.condition, store.language) }?.let { it to "justtcg" }
                    }
                    if (quote == null && owned.card.tcg == "magic" && requested in setOf("automatic", "scryfall")) {
                        val id = owned.card.exactPrintingId ?: owned.card.id.substringAfter("::")
                        if (runCatching { java.util.UUID.fromString(id) }.isSuccess) {
                            val url = "https://api.scryfall.com/cards/$id"
                            val payload = if (quoteCache.containsKey(url)) quoteCache[url] else { delay(120); runCatching { get(url) }.getOrNull().also { quoteCache[url] = it } }
                            val field = if (owned.details.finishCode?.contains("etched") == true) "usd_etched" else if (owned.details.isFoil) "usd_foil" else "usd"
                            quote = payload?.get("prices")?.jsonObject?.get(field)?.jsonPrimitive?.doubleOrNull?.takeIf { it.isFinite() && it > 0 }?.let { it to "scryfall" }
                        }
                    }
                    quote
                }.getOrElse { error ->
                    if (error is kotlinx.coroutines.CancellationException) throw error
                    null
                }
            }
            if (quotes.isEmpty() || quotes.any { it == null }) { missed++; tracked }
            else tracked.copy(unitPrice = matching.indices.sumOf { quotes[it]!!.first * matching[it].quantity } / tracked.quantity, currency = "USD", source = quotes.map { it!!.second }.distinct().joinToString(" / "))
        }
        portfolio.copy(cards = priced, refreshedAt = if (cacheOnly) portfolio.refreshedAt else Instant.now().toString(), warning = if (missed > 0) "$missed printings could not be priced exactly. Their saved values are shown." else null)
    }
}
