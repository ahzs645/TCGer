package com.ahmadjalil.tcger.domain

import java.math.BigDecimal
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/** A missing rate keeps the original currency; it never relabels the amount. */
data class Money(val amount: BigDecimal, val currency: String) {
    fun convert(destination: String, rate: BigDecimal?): Money =
        if (destination == currency || rate == null || rate <= BigDecimal.ZERO) this
        else Money(amount.multiply(rate), destination)

    fun formatted(): String = NumberFormat.getCurrencyInstance(Locale.US).apply {
        currency = Currency.getInstance(this@Money.currency)
    }.format(amount)
}

object CurrencyDisplay {
    @Volatile var currency: String = "USD"
    @Volatile var usdRates: Map<String, BigDecimal> = emptyMap()

    fun money(amount: Double, source: String = "USD", destination: String = currency): Money {
        val native = Money(BigDecimal.valueOf(amount), source.uppercase())
        return native.convert(destination.uppercase(), if (source.equals("USD", true)) usdRates[destination.uppercase()] else null)
    }
    fun format(amount: Double, source: String = "USD", destination: String = currency) = money(amount, source, destination).formatted()
}
