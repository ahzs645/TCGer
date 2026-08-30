package com.ahmadjalil.tcger.feature.portfolio

import com.ahmadjalil.tcger.data.preferences.normalizeServerUrl
import com.ahmadjalil.tcger.domain.Binder
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

@Serializable
data class TrackedPriceItem(val tcg: String, val externalId: String)

@Serializable
data class TrackedPricesRequest(
    val items: List<TrackedPriceItem>,
    val force: Boolean,
    val source: String = "automatic",
)

@Serializable
data class TrackedPriceResult(
    val key: String = "",
    val tcg: String,
    val externalId: String,
    val price: Double? = null,
    val currency: String? = null,
    val source: String? = null,
    val updatedAt: String? = null,
    val cached: Boolean = false,
    val error: String? = null,
)

@Serializable
data class TrackedPricesResponse(
    val prices: List<TrackedPriceResult>,
    val refreshedAt: String,
    val refreshAfter: String,
)

@Serializable
data class MarketPriceQuote(
    val source: String,
    val price: Double,
    val currency: String,
    val basePrice: Double? = null,
    val foilPrice: Double? = null,
    val etchedPrice: Double? = null,
    val reverseHoloPrice: Double? = null,
    val finishCode: String? = null,
    val updatedAt: String? = null,
)

@Serializable
data class PriceMover(
    val externalId: String,
    val tcg: String,
    val name: String,
    val priceChange: Double,
    val percentChange: Double,
    val currentPrice: Double,
)

@Serializable
data class PriceMovers(val gainers: List<PriceMover> = emptyList(), val losers: List<PriceMover> = emptyList())

@Serializable
data class ValuePoint(val date: String, val value: Double)

@Serializable
data class ValueHistory(
    val history: List<ValuePoint> = emptyList(),
    val currentValue: Double = 0.0,
    val changePercent: Double = 0.0,
    val changePeriod: String = "30d",
)

@Serializable
data class GameValue(val tcg: String, val value: Double, val cardCount: Int)

@Serializable
data class BinderValue(val binderId: String, val binderName: String, val value: Double, val cardCount: Int)

@Serializable
data class TopCard(val externalId: String, val tcg: String, val name: String, val value: Double, val imageUrl: String? = null)

@Serializable
data class ValueBreakdown(
    @SerialName("byTcg") val byGame: List<GameValue> = emptyList(),
    val byBinder: List<BinderValue> = emptyList(),
    val topCards: List<TopCard> = emptyList(),
)

@Serializable
data class DistributionEntry(val label: String, val count: Int, val percentage: Double)

@Serializable
data class CollectionDistribution(
    val dimension: String,
    val entries: List<DistributionEntry> = emptyList(),
    val total: Int = 0,
)

data class TrackedCard(
    val id: String,
    val externalId: String,
    val tcg: String,
    val name: String,
    val setName: String?,
    val rarity: String?,
    val imageUrl: String?,
    val quantity: Int,
    val unitPrice: Double,
    val currency: String,
    val source: String?,
    val percentChange: Double?,
) { val totalValue: Double get() = unitPrice * quantity }

data class PricePortfolio(
    val cards: List<TrackedCard>,
    val costCoverage: CostBasisCoverage,
    val refreshedAt: String? = null,
    val refreshAfter: String? = null,
    val warning: String? = null,
) { val totalValue: Double get() = cards.sumOf(TrackedCard::totalValue) }

data class CostBasisCoverage(
    val totalCopies: Int,
    val costedCopies: Int,
    val cardsMissingCosts: Int,
    val untrackedMarketValue: Double,
) { val fraction: Double get() = if (totalCopies == 0) 0.0 else costedCopies.toDouble() / totalCopies }

data class AnalyticsSnapshot(
    val history: ValueHistory,
    val breakdown: ValueBreakdown,
    val rarity: CollectionDistribution,
    val movers: PriceMovers,
    val offline: Boolean,
    val warning: String? = null,
)

enum class AnalyticsPeriod(val apiValue: String, val days: Int, val title: String) {
    SEVEN_DAYS("7d", 7, "7D"), THIRTY_DAYS("30d", 30, "30D"),
    NINETY_DAYS("90d", 90, "90D"), ONE_YEAR("1y", 365, "1Y"),
}

data class PortfolioConnection(val serverUrl: String = "", val authToken: String? = null)

interface PortfolioRepository {
    suspend fun prices(binders: List<Binder>, force: Boolean = false): PricePortfolio
    suspend fun comparePrices(card: TrackedCard): List<MarketPriceQuote>
    suspend fun analytics(binders: List<Binder>, period: AnalyticsPeriod): AnalyticsSnapshot
}

class DefaultPortfolioRepository(
    private val connection: PortfolioConnection,
    private val client: OkHttpClient = OkHttpClient(),
    private val priceSourceResolver: (String) -> String = { "automatic" },
) : PortfolioRepository {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }

    override suspend fun prices(binders: List<Binder>, force: Boolean): PricePortfolio {
        val local = buildLocalPricePortfolio(binders)
        if (connection.serverUrl.isBlank() || connection.authToken.isNullOrBlank() || local.cards.isEmpty()) return local
        return runCatching {
            val items = local.cards.map { TrackedPriceItem(it.tcg, it.externalId) }.distinct()
            val responses = items.groupBy { priceSourceResolver(it.tcg) }.map { (source, sourceItems) ->
                request(
                    "prices/tracked", "POST", json.encodeToString(TrackedPricesRequest(sourceItems, force, source)),
                    TrackedPricesResponse.serializer(),
                )
            }
            val live = responses.flatMap(TrackedPricesResponse::prices).associateBy { priceKey(it.tcg, it.externalId) }
            val movers = runCatching {
                request("prices/analytics/movers?period=30", serializer = PriceMovers.serializer())
            }.getOrDefault(PriceMovers())
            val changes = (movers.gainers + movers.losers).associateBy { priceKey(it.tcg, it.externalId) }
            local.copy(
                cards = local.cards.map { card ->
                    val quote = live[priceKey(card.tcg, card.externalId)]
                    card.copy(
                        unitPrice = quote?.price ?: card.unitPrice,
                        currency = quote?.currency ?: card.currency,
                        source = quote?.source,
                        percentChange = changes[priceKey(card.tcg, card.externalId)]?.percentChange,
                    )
                },
                refreshedAt = responses.lastOrNull()?.refreshedAt,
                refreshAfter = responses.minOfOrNull(TrackedPricesResponse::refreshAfter),
            )
        }.getOrElse { local.copy(warning = "Live prices unavailable; showing stored collection prices. ${it.message.orEmpty()}".trim()) }
    }

    override suspend fun comparePrices(card: TrackedCard): List<MarketPriceQuote> {
        if (connection.serverUrl.isBlank() || connection.authToken.isNullOrBlank()) return emptyList()
        return request(
            "prices/${card.tcg}/${card.externalId}?source=automatic&compare=true",
            serializer = ListSerializer(MarketPriceQuote.serializer()),
        ).sortedWith(compareBy<MarketPriceQuote> { it.currency }.thenBy { it.price })
    }

    override suspend fun analytics(binders: List<Binder>, period: AnalyticsPeriod): AnalyticsSnapshot {
        val local = buildLocalAnalytics(binders, period)
        if (connection.serverUrl.isBlank() || connection.authToken.isNullOrBlank()) return local
        return runCatching {
            val history = request("analytics/value?period=${period.apiValue}", serializer = ValueHistory.serializer())
            val breakdown = request("analytics/value/breakdown", serializer = ValueBreakdown.serializer())
            val rarity = request("analytics/distribution?by=rarity", serializer = CollectionDistribution.serializer())
            val movers = runCatching {
                request("prices/analytics/movers?period=${period.days}", serializer = PriceMovers.serializer())
            }.getOrDefault(PriceMovers())
            AnalyticsSnapshot(history, breakdown, rarity, movers, offline = false)
        }.getOrElse { local.copy(warning = "Server analytics unavailable; showing current on-device collection totals. ${it.message.orEmpty()}".trim()) }
    }

    private suspend fun <T> request(
        path: String,
        method: String = "GET",
        body: String? = null,
        serializer: KSerializer<T>,
    ): T = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(normalizeServerUrl(connection.serverUrl) + path)
            .header("Authorization", "Bearer ${connection.authToken.orEmpty()}")
            .apply {
                if (method == "POST") post(body.orEmpty().toRequestBody("application/json".toMediaType()))
            }
            .build()
        client.newCall(request).execute().use {
            val payload = it.body?.string().orEmpty()
            if (!it.isSuccessful) error("Request failed (${it.code})")
            json.decodeFromString(serializer, payload)
        }
    }
}

fun buildLocalPricePortfolio(binders: List<Binder>): PricePortfolio {
    data class Accumulator(val sample: com.ahmadjalil.tcger.domain.OwnedCard, var quantity: Int, var value: Double)
    val grouped = linkedMapOf<String, Accumulator>()
    binders.flatMap(Binder::cards).forEach { owned ->
        val external = owned.card.exactPrintingId ?: owned.card.id
        val key = priceKey(owned.card.tcg, external)
        val existing = grouped[key]
        if (existing == null) grouped[key] = Accumulator(owned, owned.quantity, (owned.price ?: 0.0) * owned.quantity)
        else { existing.quantity += owned.quantity; existing.value += (owned.price ?: 0.0) * owned.quantity }
    }
    val coverage = CostBasisCoverage(
        totalCopies = binders.sumOf(Binder::totalCopies),
        costedCopies = binders.flatMap(Binder::cards).filter { it.acquisitionPrice != null }.sumOf { it.quantity },
        cardsMissingCosts = binders.flatMap(Binder::cards).count { it.acquisitionPrice == null },
        untrackedMarketValue = binders.flatMap(Binder::cards).filter { it.acquisitionPrice == null }
            .sumOf { (it.price ?: 0.0) * it.quantity },
    )
    return PricePortfolio(grouped.map { (key, value) ->
        val card = value.sample.card
        TrackedCard(
            id = key, externalId = card.exactPrintingId ?: card.id, tcg = card.tcg, name = card.name,
            setName = card.setName, rarity = card.rarity, imageUrl = card.imageUrl,
            quantity = value.quantity, unitPrice = if (value.quantity == 0) 0.0 else value.value / value.quantity,
            currency = "USD", source = null, percentChange = null,
        )
    }.sortedByDescending(TrackedCard::totalValue), costCoverage = coverage)
}

fun buildLocalAnalytics(binders: List<Binder>, period: AnalyticsPeriod): AnalyticsSnapshot {
    val cards = binders.flatMap(Binder::cards)
    val current = cards.sumOf { (it.price ?: 0.0) * it.quantity }
    val byGame = cards.groupBy { it.card.tcg }.map { (tcg, values) ->
        GameValue(tcg, values.sumOf { (it.price ?: 0.0) * it.quantity }, values.sumOf { it.quantity })
    }.sortedByDescending(GameValue::value)
    val byBinder = binders.map { BinderValue(it.id, it.name, it.totalValue, it.totalCopies) }.sortedByDescending(BinderValue::value)
    val top = cards.groupBy { priceKey(it.card.tcg, it.card.exactPrintingId ?: it.card.id) }.map { (_, values) ->
        val first = values.first()
        TopCard(first.card.exactPrintingId ?: first.card.id, first.card.tcg, first.card.name,
            values.sumOf { (it.price ?: 0.0) * it.quantity }, first.card.imageUrl)
    }.sortedByDescending(TopCard::value).take(10)
    val rarityLabels = cards.map { it.card.rarity ?: "Unknown" }
    val rarity = rarityLabels.groupingBy { it }.eachCount().map { (label, count) ->
        DistributionEntry(label, count, if (rarityLabels.isEmpty()) 0.0 else count * 100.0 / rarityLabels.size)
    }.sortedByDescending(DistributionEntry::count)
    return AnalyticsSnapshot(
        history = ValueHistory(emptyList(), current, 0.0, period.apiValue),
        breakdown = ValueBreakdown(byGame, byBinder, top),
        rarity = CollectionDistribution("rarity", rarity, rarityLabels.size),
        movers = PriceMovers(), offline = true,
    )
}

fun priceKey(tcg: String, externalId: String) = "${tcg.trim().lowercase()}:${externalId.trim().lowercase()}"

fun formatPortfolioMoney(value: Double, currency: String = "USD"): String =
    runCatching { java.text.NumberFormat.getCurrencyInstance().apply { this.currency = java.util.Currency.getInstance(currency) }.format(value) }
        .getOrElse { "$currency ${"%.2f".format(value)}" }
