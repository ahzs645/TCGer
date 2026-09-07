package com.ahmadjalil.tcger.data.preferences

import android.content.Context
import com.ahmadjalil.tcger.domain.CurrencyDisplay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request

data class CurrencyRateStatus(val currency: String = "USD", val rate: String? = null, val date: String? = null,
    val source: String? = null, val refreshing: Boolean = false, val error: String? = null)

class CurrencyRates(context: Context) {
    private val cache = context.getSharedPreferences("currency_rates", Context.MODE_PRIVATE)
    private val client = OkHttpClient.Builder().callTimeout(java.time.Duration.ofSeconds(10)).build()
    private val _status = MutableStateFlow(CurrencyRateStatus())
    val status = _status.asStateFlow()

    suspend fun select(currency: String, force: Boolean = false) = withContext(Dispatchers.IO) {
        java.util.Currency.getInstance(currency)
        CurrencyDisplay.currency = currency
        if (currency == "USD") { _status.value = CurrencyRateStatus(); return@withContext }
        val cachedRate = cache.getString(currency, null)?.toBigDecimalOrNull()?.takeIf { it.signum() > 0 }
        cachedRate?.let { CurrencyDisplay.usdRates = CurrencyDisplay.usdRates + (currency to it) }
        _status.value = CurrencyRateStatus(currency, cachedRate?.toPlainString(), cache.getString("$currency.date", null), cache.getString("$currency.source", null))
        if (!force && cachedRate != null && System.currentTimeMillis() - cache.getLong("$currency.time", 0) < 86_400_000) return@withContext
        _status.value = _status.value.copy(refreshing = true)
        fun fetch(provider: String?): CurrencyRateStatus {
            val url = "https://api.frankfurter.dev/v2/rate/USD/$currency" + if (provider == null) "" else "?providers=$provider"
            return client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                check(response.isSuccessful) { "Exchange rate unavailable for $currency" }
                val quote = Json.parseToJsonElement(requireNotNull(response.body).string()).jsonObject
                require(quote["base"]?.jsonPrimitive?.content == "USD" && quote["quote"]?.jsonPrimitive?.content == currency)
                val rate = requireNotNull(quote["rate"]?.jsonPrimitive?.content?.toBigDecimalOrNull()); require(rate.signum() > 0)
                CurrencyRateStatus(currency, rate.toPlainString(), quote["date"]?.jsonPrimitive?.content, if (provider == "BOC") "Bank of Canada via Frankfurter" else "Frankfurter")
            }
        }
        try {
            val result = if (currency == "CAD") runCatching { fetch("BOC") }.getOrElse { fetch(null) } else fetch(null)
            CurrencyDisplay.usdRates = CurrencyDisplay.usdRates + (currency to requireNotNull(result.rate).toBigDecimal())
            cache.edit().putString(currency, result.rate).putString("$currency.date", result.date).putString("$currency.source", result.source).putLong("$currency.time", System.currentTimeMillis()).apply()
            _status.value = result
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) {
            _status.value = _status.value.copy(refreshing = false, error = if (cachedRate != null) "Could not refresh. Using the saved rate." else "No rate available. Amounts stay in their original currency.")
        }
    }
}
