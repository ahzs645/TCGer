package com.ahmadjalil.tcger.data.scanner.model

import java.text.Normalizer

data class DinoV2OcrEvidence(
    val fullText: String,
    val titleLines: List<String>,
    val footerText: String,
)

sealed interface DinoV2OcrRescueDecision {
    data class Accepted(
        val match: CardEmbeddingMatch,
        val reason: Reason,
        val recognizedText: String,
    ) : DinoV2OcrRescueDecision {
        enum class Reason { COLLECTOR_NUMBER, EXACT_TITLE_AND_STRONG_EMBEDDING }
    }

    data class Rejected(val reason: Reason) : DinoV2OcrRescueDecision {
        enum class Reason { NO_EXACT_EVIDENCE, TITLE_BELOW_THRESHOLD, TITLE_PRINTING_UNRESOLVED, AMBIGUOUS }
    }
}

/** Pure port of the iOS manual-capture gate override rules. */
object DinoV2ManualOcrRescue {
    fun decide(
        evidence: DinoV2OcrEvidence,
        originalMatches: List<CardEmbeddingMatch>,
        exactTitleMatches: (String) -> Pair<List<CardEmbeddingMatch>, Int>,
    ): DinoV2OcrRescueDecision {
        collectorConfirmed(originalMatches, evidence.footerText)?.let { match ->
            return DinoV2OcrRescueDecision.Accepted(
                match,
                DinoV2OcrRescueDecision.Accepted.Reason.COLLECTOR_NUMBER,
                evidence.fullText,
            )
        }

        val titleCandidates = buildList {
            addAll(evidence.titleLines)
            evidence.titleLines.zipWithNext { first, second -> "$first $second" }.forEach(::add)
        }.map(::normalizedScannerCardName).filter { it.length >= 4 }.distinct().sortedByDescending(String::length)

        titleCandidates.forEach { title ->
            val (ranked, printingCount) = exactTitleMatches(title)
            val primary = ranked.firstOrNull() ?: return@forEach
            collectorConfirmed(ranked, evidence.footerText)?.let { match ->
                return DinoV2OcrRescueDecision.Accepted(
                    match,
                    DinoV2OcrRescueDecision.Accepted.Reason.COLLECTOR_NUMBER,
                    evidence.fullText,
                )
            }
            if (primary.similarity < DinoV2ModelContract.strongAcceptanceScore) {
                return DinoV2OcrRescueDecision.Rejected(DinoV2OcrRescueDecision.Rejected.Reason.TITLE_BELOW_THRESHOLD)
            }
            val runner = ranked.firstOrNull { it.card.cardId != primary.card.cardId }
            if (printingCount > 1 && (
                    primary.similarity < 0.85 || runner == null || primary.similarity - runner.similarity < 0.05
                )) {
                return DinoV2OcrRescueDecision.Rejected(DinoV2OcrRescueDecision.Rejected.Reason.TITLE_PRINTING_UNRESOLVED)
            }
            if (runner != null && primary.similarity - runner.similarity < DinoV2ModelContract.ambiguityMargin) {
                return DinoV2OcrRescueDecision.Rejected(DinoV2OcrRescueDecision.Rejected.Reason.AMBIGUOUS)
            }
            return DinoV2OcrRescueDecision.Accepted(
                primary,
                DinoV2OcrRescueDecision.Accepted.Reason.EXACT_TITLE_AND_STRONG_EMBEDDING,
                evidence.fullText,
            )
        }
        return DinoV2OcrRescueDecision.Rejected(DinoV2OcrRescueDecision.Rejected.Reason.NO_EXACT_EVIDENCE)
    }

    private fun collectorConfirmed(matches: List<CardEmbeddingMatch>, text: String): CardEmbeddingMatch? {
        val pairs = Regex("(\\d{1,4})\\s*/\\s*(\\d{1,4})").findAll(text)
            .map { normalizeCollector(it.groupValues[1]) }.toSet()
        if (pairs.isNotEmpty()) matches.firstOrNull { collectorNumber(it.card.cardId) in pairs }?.let { return it }

        val promos = Regex("\\b([A-Za-z]{2,5})\\s*[-–]?\\s*0*(\\d{1,4})\\b").findAll(text)
            .map { it.groupValues[1].lowercase() + normalizeCollector(it.groupValues[2]) }.toSet()
        if (promos.isNotEmpty()) matches.firstOrNull { match ->
            collectorNumber(match.card.cardId)?.takeIf { number -> number.any(Char::isLetter) } in promos
        }?.let { return it }

        val runs = Regex("\\d{5,8}").findAll(text).map { it.value }.toList()
        val confirmed = matches.filter { match ->
            val number = collectorNumber(match.card.cardId) ?: return@filter false
            number.all(Char::isDigit) && runs.any { run -> Regex("^0{0,3}${Regex.escape(number)}\\d{2,3}$").matches(run) }
        }
        val numbers = confirmed.mapNotNull { collectorNumber(it.card.cardId) }.toSet()
        return confirmed.firstOrNull().takeIf { numbers.size == 1 }
    }

    private fun collectorNumber(cardId: String): String? = cardId.substringAfter('-', "")
        .takeIf(String::isNotEmpty)?.let(::normalizeCollector)

    private fun normalizeCollector(raw: String): String {
        val normalized = raw.trim().lowercase().dropWhile { it == '0' }
        return normalized.ifEmpty { if (raw.isBlank()) "" else "0" }
    }
}

internal fun normalizedScannerCardName(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFD)
    .filterNot { Character.getType(it) == Character.NON_SPACING_MARK.toInt() }
    .filter(Char::isLetterOrDigit)
    .lowercase()
