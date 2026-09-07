package com.ahmadjalil.tcger.ui

import com.ahmadjalil.tcger.domain.CatalogCard

/** A game groups every publisher's library; a publisher selection narrows to one package. */
fun matchesSearchLibrary(selection: String?, packageId: String, gameId: String): Boolean = when {
    selection == null -> true
    selection.startsWith("package:") -> packageId == selection.removePrefix("package:")
    else -> gameId.equals(selection, ignoreCase = true)
}

fun matchesOwnedSearch(card: CatalogCard, query: String, selection: String?): Boolean {
    val matchesGame = when {
        selection == null -> true
        selection.startsWith("package:") -> card.id.startsWith("${selection.removePrefix("package:")}::")
        else -> card.tcg.equals(selection, true)
    }
    return matchesGame && listOfNotNull(card.name, card.setName, card.setCode, card.collectorNumber)
        .any { it.contains(query.trim(), true) }
}
