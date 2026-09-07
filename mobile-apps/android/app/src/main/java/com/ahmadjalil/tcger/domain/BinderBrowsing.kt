package com.ahmadjalil.tcger.domain

enum class BinderSort(val label: String) { NAME("Name"), NUMBER("Card number"), VALUE("Value"), CONDITION("Condition") }

fun browseCopies(cards: List<OwnedCard>, query: String, condition: String?, tag: String?, sort: BinderSort): List<OwnedCard> {
    val needle = query.trim()
    val matches = cards.filter { owned ->
        (condition == null || owned.condition.orEmpty().equals(condition, true)) &&
            (tag == null || owned.details.tags.any { it.label.equals(tag, true) }) &&
            (needle.isEmpty() || listOfNotNull(owned.card.name, owned.card.collectorNumber, owned.card.setName, owned.details.notes, owned.details.storageLocation)
                .any { it.contains(needle, true) })
    }
    return when (sort) {
        BinderSort.NAME -> matches.sortedWith(compareBy<OwnedCard> { it.card.name.lowercase() }.thenBy { it.id })
        BinderSort.NUMBER -> matches.sortedWith(compareBy<OwnedCard> { it.card.collectorNumber?.substringBefore('/')?.toIntOrNull() ?: Int.MAX_VALUE }.thenBy { it.card.collectorNumber }.thenBy { it.card.name })
        BinderSort.VALUE -> matches.sortedByDescending { (it.price ?: 0.0) * it.quantity }
        BinderSort.CONDITION -> matches.sortedWith(compareBy<OwnedCard> { it.condition.orEmpty() }.thenBy { it.card.name })
    }
}
