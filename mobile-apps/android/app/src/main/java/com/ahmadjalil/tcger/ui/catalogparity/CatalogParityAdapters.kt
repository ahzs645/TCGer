package com.ahmadjalil.tcger.ui.catalogparity

import com.ahmadjalil.tcger.data.gamepackage.CommunityCatalogCard
import com.ahmadjalil.tcger.domain.CatalogCard
import com.ahmadjalil.tcger.domain.OwnedCard
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

fun CatalogCard.asCatalogParityCard(dexEntries: List<PokedexEntry> = emptyList()): CatalogParityCard =
    CatalogParityCard(
        id = id, name = name, tcg = tcg, setCode = setCode, setName = setName,
        rarity = rarity, collectorNumber = collectorNumber, imageUrl = imageUrl,
        dexEntries = dexEntries,
    )

fun OwnedCard.asOwnedPrinting(dexEntries: List<PokedexEntry> = emptyList()): OwnedPrinting =
    OwnedPrinting(
        cardId = card.id, tcg = card.tcg, setCode = card.setCode,
        collectorNumber = card.collectorNumber, name = card.name,
        quantity = quantity, dexEntries = dexEntries,
    )

/** Adapts installed community catalogs, including optional dex metadata stored in attributes. */
fun CommunityCatalogCard.asCatalogParityCard(tcg: String, setName: String? = null): CatalogParityCard =
    CatalogParityCard(
        id = id, name = name, tcg = tcg, setCode = setCode, setName = setName,
        rarity = rarity, collectorNumber = collectorNumber, artist = artist,
        imageUrl = imageUrl, imageUrlSmall = imageUrlSmall,
        dexEntries = dexEntries.toPokedexEntries().ifEmpty { attributes.dexEntries() },
    )

private fun List<kotlinx.serialization.json.JsonElement>.toPokedexEntries(): List<PokedexEntry> =
    mapNotNull { value ->
        val item = value as? JsonObject ?: return@mapNotNull null
        val number = item["number"]?.jsonPrimitive?.intOrNull ?: return@mapNotNull null
        val name = item["name"]?.jsonPrimitive?.content.orEmpty().ifBlank { "#$number" }
        PokedexEntry(number, name)
    }

private fun Map<String, kotlinx.serialization.json.JsonElement>.dexEntries(): List<PokedexEntry> {
    val element = this["dexEntries"]
    if (element is JsonArray) return element.mapNotNull { value ->
        val item = value as? JsonObject ?: return@mapNotNull null
        val number = item["number"]?.jsonPrimitive?.intOrNull ?: return@mapNotNull null
        val name = item["name"]?.jsonPrimitive?.content.orEmpty()
        PokedexEntry(number, name)
    }
    val number = this["pokedexNumber"]?.jsonPrimitive?.intOrNull ?: return emptyList()
    return listOf(PokedexEntry(number, name = "#${number}"))
}
