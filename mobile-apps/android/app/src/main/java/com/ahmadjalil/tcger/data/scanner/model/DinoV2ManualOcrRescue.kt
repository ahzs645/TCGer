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
        strongAcceptanceScore: Double = DinoV2ModelContract.strongAcceptanceScore,
        ambiguityMargin: Double = DinoV2ModelContract.ambiguityMargin,
        uniqueTitleEvidenceScore: Double = strongAcceptanceScore,
        singleEditVisualFloor: Double? = null,
        uniqueTitleRescue: Boolean = true,
        titleAgreementRescue: Boolean = false,
        collectorNumberScope: ScannerAcceptancePolicy.CollectorNumberScope =
            ScannerAcceptancePolicy.CollectorNumberScope.REPRESENTATIVE,
        exactTitleMatches: (String) -> Pair<List<CardEmbeddingMatch>, Int>,
    ): DinoV2OcrRescueDecision {
        collectorConfirmed(originalMatches, evidence.footerText, collectorNumberScope)?.let { match ->
            return DinoV2OcrRescueDecision.Accepted(
                match,
                DinoV2OcrRescueDecision.Accepted.Reason.COLLECTOR_NUMBER,
                evidence.fullText,
            )
        }

        val exactTitleCandidates = buildList {
            addAll(evidence.titleLines)
            evidence.titleLines.zipWithNext { first, second -> "$first $second" }.forEach(::add)
        }.map(::normalizedScannerCardName).filter { it.length >= 4 }.distinct().sortedByDescending(String::length)
        val correctedTitle = singleEditVisualFloor?.let { floor ->
            singleEditCorrection(
                observedTitles = exactTitleCandidates,
                visualMatches = originalMatches.filter { it.similarity >= floor },
            )
        }
        val titleCandidates = (exactTitleCandidates + listOfNotNull(correctedTitle)).distinct()

        // The image's own unconstrained leader, so title evidence can be
        // judged as agreeing with (or contradicting) the picture.
        val visualLeader = originalMatches.firstOrNull()
        val visualRival = visualLeader?.let { leader ->
            originalMatches.firstOrNull {
                normalizedScannerCardName(it.card.name) != normalizedScannerCardName(leader.card.name)
            }
        }

        titleCandidates.forEach { title ->
            val (ranked, printingCount) = exactTitleMatches(title)
            val primary = ranked.firstOrNull() ?: return@forEach
            collectorConfirmed(ranked, evidence.footerText, collectorNumberScope)?.let { match ->
                return DinoV2OcrRescueDecision.Accepted(
                    match,
                    DinoV2OcrRescueDecision.Accepted.Reason.COLLECTOR_NUMBER,
                    evidence.fullText,
                )
            }
            // Two independent signals naming the same card — the printed
            // title and the image's leader — confirm the visual FAMILY from
            // the evidence floor; the printing is resolved downstream.
            val titleAgreesWithVisual = titleAgreementRescue &&
                visualLeader != null &&
                normalizedScannerCardName(visualLeader.card.name) == title &&
                (visualRival == null || visualLeader.similarity - visualRival.similarity >= ambiguityMargin)
            val requiredTitleScore = when {
                printingCount == 1 && uniqueTitleRescue -> uniqueTitleEvidenceScore
                titleAgreesWithVisual -> uniqueTitleEvidenceScore
                else -> strongAcceptanceScore
            }
            if (primary.similarity < requiredTitleScore) {
                return DinoV2OcrRescueDecision.Rejected(DinoV2OcrRescueDecision.Rejected.Reason.TITLE_BELOW_THRESHOLD)
            }
            val runner = ranked.firstOrNull { it.card.cardId != primary.card.cardId }
            if (printingCount > 1 && !titleAgreesWithVisual && (
                    primary.similarity < 0.85 || runner == null || primary.similarity - runner.similarity < 0.05
                )) {
                return DinoV2OcrRescueDecision.Rejected(DinoV2OcrRescueDecision.Rejected.Reason.TITLE_PRINTING_UNRESOLVED)
            }
            if (runner != null && primary.similarity - runner.similarity < ambiguityMargin) {
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

    /**
     * A one-character repair is allowed only when one already-strong visual
     * neighbor supplies one unambiguous catalog spelling. This never searches
     * the catalog fuzzily; it only turns OCR such as `throrsman` into the
     * retrieved `throrsmap` before the normal exact-title lookup.
     */
    private fun singleEditCorrection(
        observedTitles: List<String>,
        visualMatches: List<CardEmbeddingMatch>,
    ): String? {
        val visualNames = visualMatches.map { normalizedScannerCardName(it.card.name) }
            .filter { it.length >= 8 }
            .distinct()
        val corrections = buildSet {
            observedTitles.filter { it.length >= 8 }.forEach { observed ->
                visualNames.filterTo(this) { canonical ->
                    observed != canonical && editDistanceAtMostOne(observed, canonical)
                }
            }
        }
        return corrections.singleOrNull()
    }

    private fun editDistanceAtMostOne(left: String, right: String): Boolean {
        if (kotlin.math.abs(left.length - right.length) > 1) return false
        var leftIndex = 0
        var rightIndex = 0
        var edits = 0
        while (leftIndex < left.length && rightIndex < right.length) {
            if (left[leftIndex] == right[rightIndex]) {
                leftIndex++
                rightIndex++
                continue
            }
            if (++edits > 1) return false
            when {
                left.length > right.length -> leftIndex++
                right.length > left.length -> rightIndex++
                else -> {
                    leftIndex++
                    rightIndex++
                }
            }
        }
        edits += (left.length - leftIndex) + (right.length - rightIndex)
        return edits <= 1
    }

    /**
     * A footer reading proves the PRINTING, so with [ScannerAcceptancePolicy.CollectorNumberScope.FAMILY]
     * it is matched against every printing a family row represents, and the
     * confirmed printing row becomes the match's card (so the caller pins
     * that exact printing). REPRESENTATIVE keeps the legacy single-row check.
     */
    private fun collectorConfirmed(
        matches: List<CardEmbeddingMatch>,
        text: String,
        scope: ScannerAcceptancePolicy.CollectorNumberScope,
    ): CardEmbeddingMatch? {
        val options: List<Pair<CardEmbeddingMatch, String>> = matches.flatMap { match ->
            val rows = when (scope) {
                ScannerAcceptancePolicy.CollectorNumberScope.REPRESENTATIVE -> listOf(match.card)
                ScannerAcceptancePolicy.CollectorNumberScope.FAMILY -> match.card.exactPrintingRows()
            }
            rows.mapNotNull { row -> collectorNumber(row)?.let { match.copy(card = row) to it } }
        }
        val pairs = Regex("(\\d{1,4})\\s*/\\s*(\\d{1,4})").findAll(text)
            .map { normalizeCollector(it.groupValues[1]) }.toSet()
        if (pairs.isNotEmpty()) options.firstOrNull { it.second in pairs }?.let { return it.first }

        val promos = Regex("\\b([A-Za-z]{2,5})\\s*[-–]?\\s*0*(\\d{1,4})\\b").findAll(text)
            .map { it.groupValues[1].lowercase() + normalizeCollector(it.groupValues[2]) }.toSet()
        if (promos.isNotEmpty()) options.firstOrNull { (_, number) ->
            number.any(Char::isLetter) && number in promos
        }?.let { return it.first }

        val runs = Regex("\\d{5,8}").findAll(text).map { it.value }.toList()
        val confirmed = options.filter { (_, number) ->
            number.all(Char::isDigit) && runs.any { run -> Regex("^0{0,3}${Regex.escape(number)}\\d{2,3}$").matches(run) }
        }
        val numbers = confirmed.map { it.second }.toSet()
        return confirmed.firstOrNull()?.first.takeIf { numbers.size == 1 }
    }

    /** Printed collector number of a metadata row, else the `SET-NUM` suffix of legacy ids. */
    private fun collectorNumber(row: CardEmbeddingMetadata): String? =
        row.collectorNumber?.let(::normalizeCollector)?.takeIf(String::isNotEmpty)
            ?: row.cardId.substringAfter('-', "").takeIf(String::isNotEmpty)?.let(::normalizeCollector)

    private fun normalizeCollector(raw: String): String {
        val normalized = raw.trim().lowercase().dropWhile { it == '0' }
        return normalized.ifEmpty { if (raw.isBlank()) "" else "0" }
    }
}

internal fun normalizedScannerCardName(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFD)
    .filterNot { Character.getType(it) == Character.NON_SPACING_MARK.toInt() }
    .filter(Char::isLetterOrDigit)
    .lowercase()
