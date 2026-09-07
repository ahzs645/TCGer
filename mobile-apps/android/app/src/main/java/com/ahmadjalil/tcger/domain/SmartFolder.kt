package com.ahmadjalil.tcger.domain

import kotlinx.serialization.Serializable

@Serializable
data class SmartFolderRule(val id: String, val type: String, val value: String) {
    fun matches(copy: OwnedCard): Boolean = when (type) {
        "tcg" -> copy.card.tcg.equals(value, true)
        "rarity" -> copy.card.rarity.equals(value, true)
        "condition" -> copy.condition.equals(value, true)
        "setCode" -> copy.card.setCode.equals(value, true)
        "isFoil" -> copy.details.isFoil == !value.equals("false", true)
        "tag" -> copy.details.tags.any { it.label.equals(value, true) }
        else -> false
    }
}

@Serializable
data class SmartFolder(val id: String, val name: String, val colorHex: String = "315DA8", val matchMode: String = "all", val rules: List<SmartFolderRule>) {
    fun matches(copy: OwnedCard) = if (rules.isEmpty()) true else if (matchMode == "all") rules.all { it.matches(copy) } else rules.any { it.matches(copy) }
}
