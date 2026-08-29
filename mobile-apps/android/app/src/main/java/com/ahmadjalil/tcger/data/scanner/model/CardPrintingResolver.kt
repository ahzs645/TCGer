package com.ahmadjalil.tcger.data.scanner.model

import com.ahmadjalil.tcger.data.scanner.ScannerPrintingMode

enum class PrintingResolutionProvenance(val transportValue: String) {
    VERIFIED("verified"),
    SINGLE_PRINTING("single_printing"),
    LATEST_FALLBACK("latest_fallback"),
    USER_SELECTED("user_selected"),
    UNRESOLVED("unresolved"),
}

data class CardPrintingDecision(
    val selected: CardEmbeddingMatch?,
    val candidates: List<CardEmbeddingMatch>,
    val provenance: PrintingResolutionProvenance,
) {
    val requiresSelection: Boolean get() = selected == null && candidates.size > 1
}

object CardPrintingResolver {
    fun resolve(
        primary: CardEmbeddingMatch,
        candidates: List<CardEmbeddingMatch>,
        mode: ScannerPrintingMode,
        verifiedExactPrintingId: String? = null,
    ): CardPrintingDecision {
        val familyId = primary.card.recognitionFamilyId
        val expandedPrimary = primary.card.exactPrintingRows().map { printing ->
            primary.copy(card = printing)
        }
        val family = (expandedPrimary + primary + candidates)
            .distinctBy { it.card.exactPrintingId ?: it.card.cardId }
            .filter { candidate ->
                if (familyId == null) candidate.card.cardId == primary.card.cardId
                else candidate.card.recognitionFamilyId == familyId
            }
            .sortedWith(
                compareByDescending<CardEmbeddingMatch> { it.card.releaseDate.orEmpty() }
                    .thenByDescending { it.card.exactPrintingId ?: it.card.cardId },
            )

        verifiedExactPrintingId?.let { verifiedId ->
            family.firstOrNull { (it.card.exactPrintingId ?: it.card.cardId) == verifiedId }?.let {
                return CardPrintingDecision(it, family, PrintingResolutionProvenance.VERIFIED)
            }
        }
        if (family.size <= 1) {
            return CardPrintingDecision(
                family.firstOrNull() ?: primary,
                family,
                PrintingResolutionProvenance.SINGLE_PRINTING,
            )
        }
        return when (mode) {
            ScannerPrintingMode.QUICK_LATEST -> CardPrintingDecision(
                family.first(),
                family,
                PrintingResolutionProvenance.LATEST_FALLBACK,
            )
            ScannerPrintingMode.EXACT_PRINTING -> CardPrintingDecision(
                null,
                family,
                PrintingResolutionProvenance.UNRESOLVED,
            )
        }
    }
}
