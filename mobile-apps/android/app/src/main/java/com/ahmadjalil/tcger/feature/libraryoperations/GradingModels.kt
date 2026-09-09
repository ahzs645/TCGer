package com.ahmadjalil.tcger.feature.libraryoperations

import kotlinx.serialization.Serializable
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.max

@Serializable data class GradingHistoryPoint(val date: String, val price: Double)
@Serializable data class GradingOutcome(
    val key: String, val label: String, val grade: Double? = null, val price: Double? = null,
    val population: Long? = null, val salesCount: Long? = null, val confidence: String? = null,
    val source: String = "manual", val history: List<GradingHistoryPoint> = emptyList(),
) {
    companion object {
        fun blank(grader: String): List<GradingOutcome> {
            val grades = (10 downTo 1).map { it.toDouble() } + if (grader in listOf("BGS", "CGC")) (9 downTo 1).map { it + 0.5 } else emptyList()
            val specialty = when (grader) { "BGS" -> listOf("pristine", "perfect"); "CGC" -> listOf("pristine"); else -> emptyList() }
            return specialty.map { GradingOutcome("${grader.lowercase()}$it", "$grader $it") } + grades.sortedDescending().map {
                val label = if (it % 1 == 0.0) it.toInt().toString() else it.toString()
                GradingOutcome("${grader.lowercase()}$label", "$grader $label", it)
            }
        }
    }
}
@Serializable data class GradingSnapshot(
    val tcgPlayerId: String, val name: String, val setName: String, val collectorNumber: String,
    val currency: String, val source: String, val sourceUrl: String, val retrievedAt: String,
    val priceAsOf: String? = null, val warnings: List<String>, val graders: List<Grader>, val rawQuotes: List<RawQuote>,
) {
    @Serializable data class Grader(val grader: String, val gemRate: Double? = null, val outcomes: List<GradingOutcome>)
    @Serializable data class RawQuote(val printing: String, val condition: String, val price: Double)
}
@Serializable data class GradingSnapshotRequest(val tcgPlayerId: String, val language: String = "english")
@Serializable data class GradingScenario(
    val rawValue: Double, val costs: Map<String, Double>, val outcomes: List<GradingOutcome>, val interpolate: Boolean = false,
) {
    companion object {
        val costFields = linkedMapOf("grading" to "Grading fee", "shipping" to "Round-trip shipping", "insurance" to "Insurance",
            "upcharge" to "Possible upcharge", "sellingFeePercent" to "Graded selling fee (%)", "sellingFixed" to "Graded fixed selling cost",
            "rawSellingFeePercent" to "Raw selling fee (%)", "rawSellingFixed" to "Raw fixed selling cost")
    }
    data class Row(val outcome: GradingOutcome, val price: Double?, val estimated: Boolean, val gain: Double?, val probability: Double?)
    data class Result(val totalCost: Double, val rawNet: Double, val population: Long, val pricedPopulation: Long,
        val expectedValue: Double?, val expectedGain: Double?, val verdict: String, val breakEven: String?, val rows: List<Row>)
    fun calculate(): Result? {
        if (!rawValue.isFinite() || rawValue !in 0.0..100_000_000.0 || outcomes.map { it.key }.distinct().size != outcomes.size ||
            costs.any { (key, value) -> !value.isFinite() || value !in 0.0..(if (key.endsWith("Percent")) 100.0 else 100_000_000.0) } ||
            outcomes.any { it.price?.let { p -> !p.isFinite() || p !in 0.0..100_000_000.0 } == true || (it.population ?: 0) !in 0L..1_000_000_000L }) return null
        fun cost(key: String) = costs[key] ?: 0.0
        val totalCost = cost("grading") + cost("shipping") + cost("insurance") + cost("upcharge")
        val rawNet = rawValue * (1 - cost("rawSellingFeePercent") / 100) - cost("rawSellingFixed")
        val population = outcomes.sumOf { it.population ?: 0 }
        val anchors = outcomes.filter { it.grade != null && (it.price ?: 0.0) > 0 }.sortedBy { it.grade }
        val rows = outcomes.map { outcome ->
            var price = outcome.price
            var estimated = false
            if (price == null && interpolate && outcome.grade != null) {
                val lower = anchors.lastOrNull { it.grade!! < outcome.grade }
                val upper = anchors.firstOrNull { it.grade!! > outcome.grade }
                if (lower != null && upper != null) {
                    val position = (outcome.grade - lower.grade!!) / (upper.grade!! - lower.grade)
                    price = exp(ln(lower.price!!) + position * ln(upper.price!! / lower.price))
                    estimated = true
                }
            }
            Row(outcome, price, estimated, price?.let { it * (1 - cost("sellingFeePercent") / 100) - cost("sellingFixed") - totalCost - rawNet },
                if (population > 0) (outcome.population ?: 0).toDouble() / population else null)
        }
        val pricedPopulation = rows.sumOf { if (it.price == null) 0L else it.outcome.population ?: 0L }
        val complete = population > 0 && pricedPopulation == population
        val value = if (complete) rows.sumOf { (it.price ?: 0.0) * (it.probability ?: 0.0) } else null
        val gain = if (complete) rows.sumOf { (it.gain ?: 0.0) * (it.probability ?: 0.0) } else null
        val verdict = when { gain == null -> "insufficient"; abs(gain) <= max(0.01, rawValue * 0.2) -> "borderline"; gain > 0 -> "grade"; else -> "keep" }
        val breakEven = rows.filter { it.outcome.grade != null && (it.gain ?: 0.0) > 0 }.minByOrNull { it.outcome.grade!! }?.outcome?.label
        return Result(totalCost, rawNet, population, pricedPopulation, value, gain, verdict, breakEven, rows)
    }
}

@Serializable data class GradingExpense(val id: String, val cardName: String, val grader: String, val serviceTier: String,
    val currency: String, val paidAt: String, val grading: Double, val shipping: Double, val insurance: Double, val upcharge: Double) {
    val total: Double get() = grading + shipping + insurance + upcharge
}

@Serializable data class GradingSearchRequest(val search: String, val language: String)
@Serializable data class GradingSearchResult(val cards: List<Card>) {
    @Serializable data class Card(val tcgPlayerId: String, val name: String, val setName: String, val collectorNumber: String)
}
