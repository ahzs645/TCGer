package com.ahmadjalil.tcger.domain

import kotlinx.serialization.Serializable

@Serializable
data class WishlistRule(
    val id: String = "",
    val type: String,
    val tcg: String? = null,
    val query: String? = null,
    val setCode: String? = null,
    val setName: String? = null,
    val includeAllPrintings: Boolean = true,
    val autoSync: Boolean = true,
    val lastSyncedAt: String? = null,
    val lastMatchCount: Int? = null,
) {
    fun validate() {
        require(type in listOf("name", "set", "artist", "tag"))
        require(if (type == "set") !tcg.isNullOrBlank() && !setCode.isNullOrBlank() else !query.isNullOrBlank()) { "Enter the rule's game and search value" }
        if (type == "tag") require(!tcg.isNullOrBlank()) { "Choose a game for tag rules" }
    }
    fun matches(card: CatalogCard): Boolean = (tcg == null || tcg.equals(card.tcg, true)) && when (type) {
        "set" -> card.setCode.equals(setCode, true)
        "artist" -> card.artist?.contains(query.orEmpty(), true) == true
        "tag" -> card.attributes.values.flatten().any { it.equals(query, true) }
        else -> card.name.contains(query.orEmpty(), true)
    }
    val label get() = "$type: ${setName ?: setCode ?: query.orEmpty()}${tcg?.let { " · $it" }.orEmpty()}"
}
