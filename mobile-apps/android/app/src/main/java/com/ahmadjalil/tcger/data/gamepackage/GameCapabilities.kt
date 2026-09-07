package com.ahmadjalil.tcger.data.gamepackage

import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable data class GameFinish(val code: String, val label: String, val foil: Boolean)
@Serializable data class GamePrintings(val version: Int, val selection: String, val finishes: List<GameFinish>)
@Serializable data class GameSymbol(val id: String, val label: String, val kind: String, val imageUrl: String)
@Serializable data class GameCardPresentation(val packageId: String? = null, val printings: GamePrintings? = null, val symbols: List<GameSymbol> = emptyList())
@Serializable data class GameDeckEligibility(val property: String, val values: List<JsonElement>) {
    fun matches(card: JsonObject): Boolean {
        val value = property.split('.').fold(card as JsonElement?) { current, key -> (current as? JsonObject)?.get(key) }
        return if (value is JsonArray) value.any(values::contains) else value in values
    }
}
@Serializable data class GameDeckZone(val id: String, val label: String, val min: Int, val max: Int, val eligibility: List<GameDeckEligibility> = emptyList())
@Serializable data class GameDeckCopyException(val `when`: GameDeckEligibility, val maxCopies: Int)
@Serializable data class GameDeckFormat(val id: String, val label: String, val zones: List<GameDeckZone>, val defaultZone: String, val maxCopies: Int? = null, val copyIdentity: String = "baseExternalId", val copyLimitExceptions: List<GameDeckCopyException> = emptyList(), val requireLegality: Boolean = false)
@Serializable data class GameDeckRules(val version: Int, val defaultFormat: String, val formats: List<GameDeckFormat>) {
    fun validateContract() {
        require(version == 1 && formats.size in 1..32 && formats.map { it.id }.distinct().size == formats.size && formats.any { it.id == defaultFormat }) { "Invalid deck rules" }
        val id = Regex("^[a-z0-9][a-z0-9-]{0,63}$")
        fun validEligibility(rule: GameDeckEligibility): Boolean = rule.property.matches(Regex("^(name|rarity|supertype|baseExternalId|printingKey|attributes\\.[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*)$")) && rule.values.size in 1..200 && rule.values.all { it is JsonPrimitive && it !is JsonNull }
        formats.forEach { format ->
            require(format.id.matches(id) && format.label.length in 1..100 && (format.maxCopies == null || format.maxCopies in 0..10000) && format.copyIdentity in listOf("name", "baseExternalId"))
            require(format.copyLimitExceptions.size <= 32 && format.copyLimitExceptions.all { validEligibility(it.`when`) && it.maxCopies in 0..10000 })
            require(format.zones.all { it.id.matches(id) && it.label.length in 1..100 && it.eligibility.size <= 16 && it.eligibility.all(::validEligibility) })
            require(format.zones.size in 1..16 && format.zones.map { it.id }.distinct().size == format.zones.size && format.zones.any { it.id == format.defaultZone }) { "Invalid deck zones" }
            require(format.zones.all { it.min >= 0 && it.max in it.min..10000 }) { "Invalid zone limits" }
        }
    }
}
@Serializable data class GameLegalityPeriod(val format: String, val legal: Boolean, val validFrom: String? = null, val validTo: String? = null)
fun gameCardLegality(format: String, legality: Map<String, Boolean>, periods: List<GameLegalityPeriod>, sanctionedPlayLegal: Boolean? = null, now: Instant = Instant.now()): Boolean? {
    if (sanctionedPlayLegal == false) return false
    val dated = periods.filter { it.format == format }
    if (dated.isEmpty()) return legality[format]
    fun parse(value: String): Instant? = runCatching { Instant.parse(if (value.length == 10) "${value}T00:00:00Z" else value) }.getOrNull()
    return dated.filter { (it.validFrom == null || parse(it.validFrom)?.let { start -> !start.isAfter(now) } == true) && (it.validTo == null || parse(it.validTo)?.let(now::isBefore) == true) }.maxByOrNull { it.validFrom.orEmpty() }?.legal
}
data class GameDeckCard(val externalId: String, val name: String, val quantity: Int, val zone: String?, val tcg: String, val cardData: JsonObject)
data class GameDeckValidation(val valid: Boolean, val status: String, val errors: List<String>, val warnings: List<String>)
fun validateGameDeck(gameId: String, cards: List<GameDeckCard>, rules: GameDeckRules, formatId: String? = null): GameDeckValidation {
    val format = rules.formats.find { it.id == (formatId ?: rules.defaultFormat) } ?: return GameDeckValidation(false, "unsupported", emptyList(), listOf("This format has no installed rules."))
    val errors = mutableListOf<String>(); val warnings = mutableListOf<String>()
    val copies = mutableMapOf<String, Pair<Int, Int?>>()
    cards.forEach { card ->
        if (card.quantity <= 0) errors += "${card.name}: quantity must be positive."
        if (card.tcg != gameId) errors += "${card.name}: belongs to another game."
        val zone = format.zones.find { it.id == (card.zone ?: format.defaultZone) }
        if (zone == null) errors += "${card.name}: unknown zone."
        val data = JsonObject(card.cardData + ("name" to JsonPrimitive(card.name)))
        if (zone?.eligibility?.any { !it.matches(data) } == true) errors += "${card.name}: is not eligible for ${zone.label}."
        val key = if (format.copyIdentity == "name") card.name.lowercase() else data["baseExternalId"]?.jsonPrimitive?.content ?: card.externalId
        val limit = format.copyLimitExceptions.find { it.`when`.matches(data) }?.maxCopies ?: format.maxCopies
        val old = copies[key]
        copies[key] = ((old?.first ?: 0) + card.quantity) to listOfNotNull(old?.second, limit).minOrNull()
        if (format.requireLegality) {
            val legality = (data["formatLegality"] as? JsonObject)?.mapNotNull { (key, value) -> (value as? JsonPrimitive)?.booleanOrNull?.let { key to it } }?.toMap().orEmpty()
            val periods = runCatching { Json.decodeFromJsonElement<List<GameLegalityPeriod>>(data["legalityPeriods"] ?: JsonArray(emptyList())) }.getOrDefault(emptyList())
            when (gameCardLegality(format.id, legality, periods, (data["sanctionedPlayLegal"] as? JsonPrimitive)?.booleanOrNull)) {
                false -> errors += "${card.name}: is not legal in ${format.label}."
                null -> warnings += "${card.name}: legality in ${format.label} is unknown."
                true -> Unit
            }
        }
    }
    format.zones.forEach { zone ->
        val total = cards.filter { (it.zone ?: format.defaultZone) == zone.id }.sumOf { it.quantity }
        if (total !in zone.min..zone.max) errors += "${zone.label}: requires ${zone.min}–${zone.max} cards; found $total."
    }
    copies.forEach { (key, value) -> if (value.second != null && value.first > value.second!!) errors += "$key: exceeds the ${value.second}-copy limit." }
    return GameDeckValidation(errors.isEmpty() && warnings.isEmpty(), if (errors.isNotEmpty()) "invalid" else if (warnings.isNotEmpty()) "unknown" else "valid", errors, warnings)
}
@Serializable data class GamePriceQuote(val cardId: String, val printingKey: String? = null, val finishCode: String? = null, val condition: String? = null, val language: String? = null, val amount: Double, val currency: String, val source: String, val sourceUrl: String? = null, val observedAt: String, val expiresAt: String)
@Serializable data class GamePriceSnapshot(val schema: String, val gameId: String, val quotes: List<GamePriceQuote>) {
    fun quote(cardId: String, currency: String, printingKey: String? = null, finishCode: String? = null, condition: String? = null, language: String? = null, now: Instant = Instant.now()): GamePriceQuote? = quotes.filter { q ->
        q.cardId == cardId && q.currency == currency && q.printingKey == printingKey && q.finishCode == finishCode && q.condition == condition && q.language == language && runCatching { !Instant.parse(q.observedAt).isAfter(now) && now.isBefore(Instant.parse(q.expiresAt)) }.getOrDefault(false)
    }.maxByOrNull { it.observedAt }
}
@Serializable data class GamePackPoolEntry(val cardId: String, val weight: Double)
@Serializable data class GamePackSlot(val count: Int, val pool: List<GamePackPoolEntry>, val withoutReplacement: Boolean = false)
@Serializable data class GamePackDefinition(val id: String, val name: String, val setCode: String, val cardBackUrl: String? = null, val slots: List<GamePackSlot>) {
    fun open(random: () -> Double = { kotlin.random.Random.nextDouble() }): List<String> = slots.flatMap { slot ->
        val pool = slot.pool.toMutableList()
        require(slot.count in 1..100 && pool.isNotEmpty() && pool.all { it.weight.isFinite() && it.weight > 0 } && (!slot.withoutReplacement || slot.count <= pool.size)) { "Invalid pack slot" }
        List(slot.count) {
            val sample = random(); require(sample.isFinite() && sample >= 0 && sample < 1)
            var remaining = sample * pool.sumOf { it.weight }
            val index = pool.indices.first { index -> remaining -= pool[index].weight; remaining < 0 || index == pool.lastIndex }
            pool[index].cardId.also { if (slot.withoutReplacement) pool.removeAt(index) }
        }
    }
}
@Serializable data class GamePackLibrary(val schema: String, val gameId: String, val packs: List<GamePackDefinition>)

private val capabilityJson = Json { ignoreUnknownKeys = true }
fun com.ahmadjalil.tcger.domain.CatalogCard.gamePresentation(): GameCardPresentation? = runCatching {
    capabilityJson.decodeFromString<GameCardPresentation>(attributes["tcger"]?.first() ?: return null)
}.getOrNull()

fun GamePriceSnapshot.validateContract() {
    require(schema == "tcger-price-snapshot-v1" && quotes.size <= 1_000_000)
    require(quotes.all { it.cardId.isNotEmpty() && it.amount.isFinite() && it.amount >= 0 && it.currency.matches(Regex("^[A-Z]{3}$")) && it.source.length in 1..100 && Instant.parse(it.expiresAt).isAfter(Instant.parse(it.observedAt)) }) { "Invalid price snapshot" }
}
fun GamePackLibrary.validateContract() {
    require(schema == "tcger-pack-library-v1" && packs.size <= 10000 && packs.map { it.id }.distinct().size == packs.size)
    packs.forEach { pack ->
        require(pack.name.length in 1..100 && pack.setCode.isNotEmpty() && pack.slots.size in 1..32)
        pack.slots.forEach { slot ->
            require(slot.count in 1..100 && slot.pool.size in 1..100000 && slot.pool.map { it.cardId }.distinct().size == slot.pool.size && slot.pool.all { it.cardId.isNotEmpty() && it.weight.isFinite() && it.weight > 0 && it.weight <= 1_000_000 } && (!slot.withoutReplacement || slot.count <= slot.pool.size)) { "Invalid pack slot" }
        }
    }
}

fun GamePrintings.validateContract() {
    require(version == 1 && selection in listOf("printing", "functional") && finishes.size <= 200 && finishes.map { it.code }.distinct().size == finishes.size && finishes.all { it.code.length in 1..80 && it.label.length in 1..100 }) { "Invalid printings contract" }
}
fun GameSymbol.validateContract() {
    require(id.length in 1..80 && label.length in 1..100 && kind in listOf("rarity", "resource", "type") && imageUrl.length <= 2048 && java.net.URI(imageUrl).let { it.scheme == "https" && it.host != null }) { "Invalid game symbol" }
}
