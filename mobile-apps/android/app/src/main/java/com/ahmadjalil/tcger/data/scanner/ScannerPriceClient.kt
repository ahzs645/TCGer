package com.ahmadjalil.tcger.data.scanner

import com.ahmadjalil.tcger.domain.CatalogCard
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

@Serializable
data class ScannerPriceQuote(
    val source: String,
    val price: Double,
    val currency: String,
    val updatedAt: String? = null,
    val isFallback: Boolean = false,
)

object ScannerPriceJson {
    private val codec = Json { ignoreUnknownKeys = true; explicitNulls = false }

    fun decodeQuotes(json: String): List<ScannerPriceQuote> = codec.decodeFromString<List<ScannerPriceQuote>>(json)
        .filter { it.price.isFinite() && it.price > 0 && it.currency.isNotBlank() }

    /** Prefer a live automatic provider; otherwise retain the first valid backend quote. */
    fun preferredQuote(json: String): ScannerPriceQuote? = decodeQuotes(json)
        .sortedWith(compareBy<ScannerPriceQuote> { it.isFallback }.thenBy { it.source })
        .firstOrNull()
}

class ScannerPriceClient(private val client: OkHttpClient = OkHttpClient()) {
    suspend fun fetch(serverUrl: String, authToken: String, card: CatalogCard): ScannerPriceQuote? = withContext(Dispatchers.IO) {
        require(serverUrl.isNotBlank() && authToken.isNotBlank()) { "A signed-in scanner server is required for pricing" }
        val url = serverUrl.trim().trimEnd('/').toHttpUrl().newBuilder()
            .addPathSegment("prices")
            .addPathSegment(card.tcg)
            .addPathSegment(card.id)
            .build()
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $authToken")
            .get()
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Price lookup failed with HTTP ${response.code}")
            ScannerPriceJson.preferredQuote(response.body?.string().orEmpty())
        }
    }
}
