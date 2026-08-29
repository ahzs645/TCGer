package com.ahmadjalil.tcger.feature.settingsparity

import android.content.Context
import com.ahmadjalil.tcger.data.preferences.normalizeServerUrl
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

data class SettingsFeatureConnection(val serverUrl: String = "", val authToken: String? = null)

@Serializable
data class PriceSourceOption(
    val id: String,
    val label: String,
    val description: String,
    val games: List<String> = emptyList(),
    val requiresServer: Boolean = false,
)

@Serializable
data class PriceSourcesResponse(val sources: List<PriceSourceOption>, val defaultSource: String = "automatic")

@Serializable
data class TestPriceSourceResult(val ok: Boolean, val latencyMs: Int = 0, val error: String? = null)

data class PricingSourceSelection(val defaultSource: String = "automatic", val gameOverrides: Map<String, String> = emptyMap())

class PricingSourcePreferenceStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("pricing_source_preferences", Context.MODE_PRIVATE)

    fun load(): PricingSourceSelection {
        val overrides = preferences.all.mapNotNull { (key, value) ->
            if (!key.startsWith("game.")) null else key.removePrefix("game.") to (value as? String ?: return@mapNotNull null)
        }.toMap()
        return PricingSourceSelection(preferences.getString("default", "automatic") ?: "automatic", overrides)
    }

    fun setDefault(source: String) { preferences.edit().putString("default", source).apply() }
    fun setOverride(game: String, source: String?) {
        preferences.edit().apply {
            if (source == null) remove("game.${game.lowercase()}") else putString("game.${game.lowercase()}", source)
        }.apply()
    }
    fun resolvedSource(game: String): String = load().gameOverrides[game.lowercase()] ?: load().defaultSource
}

class PricingSourceRepository(
    private val connection: SettingsFeatureConnection,
    private val client: OkHttpClient = OkHttpClient(),
) {
    private val http = FeatureHttp(connection, client)

    suspend fun availableSources(): PriceSourcesResponse {
        if (connection.serverUrl.isBlank() || connection.authToken.isNullOrBlank()) return localPriceSources()
        return runCatching { http.request("prices/sources", serializer = PriceSourcesResponse.serializer()) }
            .getOrElse { localPriceSources() }
    }

    suspend fun test(source: String): TestPriceSourceResult {
        if (connection.serverUrl.isBlank()) {
            return when (source) {
                "automatic", "scryfall" -> TestPriceSourceResult(true, 0)
                else -> TestPriceSourceResult(false, error = "This provider requires server configuration.")
            }
        }
        return http.request(
            "settings/test-source", "POST", "{\"source\":${Json.encodeToString(source)}}",
            TestPriceSourceResult.serializer(),
        )
    }
}

fun localPriceSources() = PriceSourcesResponse(
    sources = listOf(
        PriceSourceOption("automatic", "Best available", "Use the first compatible configured source for each game."),
        PriceSourceOption("scryfall", "Scryfall", "Free regular, foil, and etched Magic market prices.", listOf("magic")),
    ),
)

@Serializable
data class ServerAccessPolicy(
    val id: Long = 0,
    val publicDashboard: Boolean = false,
    val publicCollections: Boolean = false,
    val requireAuth: Boolean = true,
    val appName: String = "TCGer",
    val updatedAt: String = "",
)

@Serializable
data class UpdateServerAccessPolicy(
    val publicDashboard: Boolean? = null,
    val publicCollections: Boolean? = null,
    val requireAuth: Boolean? = null,
)

class ServerAccessPolicyRepository(
    private val connection: SettingsFeatureConnection,
    private val client: OkHttpClient = OkHttpClient(),
) {
    private val http = FeatureHttp(connection, client)
    suspend fun get(): ServerAccessPolicy {
        require(connection.serverUrl.isNotBlank()) { "Server access policy is unavailable in on-device mode." }
        return http.request("settings", serializer = ServerAccessPolicy.serializer(), requireToken = false)
    }
    suspend fun update(input: UpdateServerAccessPolicy): ServerAccessPolicy = http.request(
        "settings", "PATCH", Json { explicitNulls = false }.encodeToString(input), ServerAccessPolicy.serializer(),
    )
}

@Serializable
enum class TransactionType(val apiValue: String, val title: String) {
    @kotlinx.serialization.SerialName("purchase") PURCHASE("purchase", "Purchase"),
    @kotlinx.serialization.SerialName("sale") SALE("sale", "Sale"),
    @kotlinx.serialization.SerialName("trade") TRADE("trade", "Trade"),
}

@Serializable
data class FinanceTransaction(
    val id: String,
    val type: TransactionType,
    val collectionEntryId: String? = null,
    val cardId: String? = null,
    val externalId: String? = null,
    val cardName: String? = null,
    val tcg: String? = null,
    val quantity: Int = 1,
    val amount: Double,
    val currency: String = "USD",
    val platform: String? = null,
    val sourceUrl: String? = null,
    val costBasis: Double? = null,
    val fees: Double? = null,
    val shippingCost: Double? = null,
    val acquiredAt: String? = null,
    val netProceeds: Double? = null,
    val realizedProfit: Double? = null,
    val holdingDays: Int? = null,
    val notes: String? = null,
    val date: String,
)

@Serializable
data class CreateFinanceTransaction(
    val type: TransactionType,
    val cardName: String? = null,
    val tcg: String? = null,
    val quantity: Int = 1,
    val amount: Double,
    val currency: String = "USD",
    val platform: String? = null,
    val costBasis: Double? = null,
    val fees: Double? = null,
    val shippingCost: Double? = null,
    val acquiredAt: String? = null,
    val notes: String? = null,
    val date: String? = null,
) {
    fun normalized() = copy(
        cardName = cardName?.trim()?.ifBlank { null }, tcg = tcg?.trim()?.ifBlank { null },
        quantity = quantity.coerceAtLeast(1), currency = currency.trim().uppercase(),
        platform = platform?.trim()?.ifBlank { null }, notes = notes?.trim()?.ifBlank { null },
    )
    val isValid get() = amount > 0 && quantity > 0 && currency.matches(Regex("[A-Z]{3}", RegexOption.IGNORE_CASE)) &&
        listOf(costBasis, fees, shippingCost).all { it == null || it >= 0 }
}

@Serializable
data class FinanceSummary(val totalSpent: Double, val totalEarned: Double, val profitLoss: Double, val transactionCount: Int)

interface FinanceRepository {
    suspend fun getTransactions(): List<FinanceTransaction>
    suspend fun getSummary(): FinanceSummary
    suspend fun create(input: CreateFinanceTransaction): FinanceTransaction
    suspend fun delete(id: String)

    companion object {
        fun create(context: Context, connection: SettingsFeatureConnection): FinanceRepository =
            if (connection.serverUrl.isBlank()) LocalFinanceRepository(context.applicationContext)
            else RemoteFinanceRepository(connection)
    }
}

class LocalFinanceRepository(context: Context) : FinanceRepository {
    private val preferences = context.getSharedPreferences("finance_transactions", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    override suspend fun getTransactions(): List<FinanceTransaction> = read().sortedByDescending(FinanceTransaction::date)
    override suspend fun getSummary(): FinanceSummary = financeSummary(read())
    override suspend fun create(input: CreateFinanceTransaction): FinanceTransaction {
        require(input.isValid) { "Enter a positive amount, quantity, and valid currency." }
        val normalized = input.normalized()
        val transaction = FinanceTransaction(
            id = UUID.randomUUID().toString(), type = normalized.type, cardName = normalized.cardName,
            tcg = normalized.tcg, quantity = normalized.quantity, amount = normalized.amount,
            currency = normalized.currency, platform = normalized.platform, costBasis = normalized.costBasis,
            fees = normalized.fees, shippingCost = normalized.shippingCost, acquiredAt = normalized.acquiredAt,
            netProceeds = normalized.takeIf { it.type == TransactionType.SALE }?.let { it.amount - (it.fees ?: 0.0) - (it.shippingCost ?: 0.0) },
            realizedProfit = normalized.takeIf { it.type == TransactionType.SALE && it.costBasis != null }?.let { it.amount - (it.fees ?: 0.0) - (it.shippingCost ?: 0.0) - requireNotNull(it.costBasis) },
            notes = normalized.notes, date = normalized.date ?: Instant.now().toString(),
        )
        write(read() + transaction)
        return transaction
    }
    override suspend fun delete(id: String) { write(read().filterNot { it.id == id }) }
    private fun read() = preferences.getString("items", null)?.let { runCatching { json.decodeFromString(ListSerializer(FinanceTransaction.serializer()), it) }.getOrDefault(emptyList()) }.orEmpty()
    private fun write(items: List<FinanceTransaction>) { preferences.edit().putString("items", json.encodeToString(ListSerializer(FinanceTransaction.serializer()), items)).apply() }
}

class RemoteFinanceRepository(connection: SettingsFeatureConnection, client: OkHttpClient = OkHttpClient()) : FinanceRepository {
    private val http = FeatureHttp(connection, client)
    private val json = Json { explicitNulls = false; encodeDefaults = true }
    override suspend fun getTransactions(): List<FinanceTransaction> = http.request("finance/transactions", serializer = ListSerializer(FinanceTransaction.serializer()))
    override suspend fun getSummary(): FinanceSummary = http.request("finance/summary", serializer = FinanceSummary.serializer())
    override suspend fun create(input: CreateFinanceTransaction): FinanceTransaction {
        require(input.isValid) { "Enter a positive amount, quantity, and valid currency." }
        return http.request("finance/transactions", "POST", json.encodeToString(input.normalized()), FinanceTransaction.serializer())
    }
    override suspend fun delete(id: String) { http.requestUnit("finance/transactions/${java.net.URLEncoder.encode(id, "UTF-8")}", "DELETE") }
}

fun financeSummary(items: List<FinanceTransaction>): FinanceSummary {
    val spent = items.filter { it.type == TransactionType.PURCHASE }.sumOf { it.amount }
    val earned = items.filter { it.type == TransactionType.SALE }.sumOf { it.amount }
    return FinanceSummary(spent, earned, earned - spent, items.size)
}

internal class FeatureHttp(private val connection: SettingsFeatureConnection, private val client: OkHttpClient) {
    private val json = Json { ignoreUnknownKeys = true }
    suspend fun <T> request(path: String, method: String = "GET", body: String? = null, serializer: KSerializer<T>, requireToken: Boolean = true): T = withContext(Dispatchers.IO) {
        client.newCall(build(path, method, body, requireToken)).execute().use {
            val payload = it.body?.string().orEmpty()
            if (!it.isSuccessful) error("Request failed (${it.code})${payload.takeIf(String::isNotBlank)?.let { value -> ": ${value.take(160)}" }.orEmpty()}")
            json.decodeFromString(serializer, payload)
        }
    }
    suspend fun requestUnit(path: String, method: String) = withContext(Dispatchers.IO) { client.newCall(build(path, method, null, true)).execute().use { if (!it.isSuccessful) error("Request failed (${it.code})") } }
    private fun build(path: String, method: String, body: String?, requireToken: Boolean): Request {
        val token = connection.authToken?.takeIf(String::isNotBlank)
        if (requireToken && token == null) error("Sign in is required.")
        return Request.Builder().url(normalizeServerUrl(connection.serverUrl) + path).apply {
            token?.let { header("Authorization", "Bearer $it") }
            if (method == "PATCH") patch(body.orEmpty().toRequestBody("application/json".toMediaType()))
            else if (method == "POST") post(body.orEmpty().toRequestBody("application/json".toMediaType()))
            else if (method == "DELETE") delete()
        }.build()
    }
}
