package com.ahmadjalil.tcger.ui.catalogparity

import kotlinx.serialization.Serializable

@Serializable
data class CatalogSet(
    val code: String,
    val name: String,
    val tcg: String,
    val releaseDate: String? = null,
    val totalCards: Int? = null,
    val standardCards: Int? = null,
    val setType: String? = null,
    val releaseYear: Int? = null,
    val iconUrl: String? = null,
    val iconFallbackUrl: String? = null,
    val logoUrl: String? = null,
) {
    val id: String get() = "${tcg.lowercase()}::${code.lowercase()}"
}

@Serializable
data class PokedexEntry(val number: Int, val name: String)

@Serializable
data class CatalogParityCard(
    val id: String,
    val name: String,
    val tcg: String,
    val setCode: String? = null,
    val setName: String? = null,
    val rarity: String? = null,
    val collectorNumber: String? = null,
    val artist: String? = null,
    val imageUrl: String? = null,
    val imageUrlSmall: String? = null,
    val dexEntries: List<PokedexEntry> = emptyList(),
)

data class OwnedPrinting(
    val cardId: String,
    val tcg: String,
    val setCode: String? = null,
    val collectorNumber: String? = null,
    val name: String,
    val quantity: Int = 1,
    val dexEntries: List<PokedexEntry> = emptyList(),
)

enum class SetCompletionMode(val title: String, val description: String) {
    STANDARD("Standard set", "Numbered cards in the official checklist"),
    MASTER("Master set", "Every cataloged card, including secrets and alternates"),
}

enum class SetBrowserSort(val title: String) {
    NEWEST("Newest"),
    NAME("Name"),
    COMPLETION("Most complete"),
    CLOSEST("Closest to completion"),
}

enum class SetProgressFilter(val title: String) {
    ALL("All"), STARTED("Started"), COMPLETE("Complete"), NOT_STARTED("New"),
}

data class SetProgress(val owned: Int, val total: Int) {
    val fraction: Float get() = if (total <= 0) 0f else (owned.toFloat() / total).coerceIn(0f, 1f)
    val complete: Boolean get() = total > 0 && owned >= total
}

object SetProgressCalculator {
    fun total(set: CatalogSet, mode: SetCompletionMode): Int = when (mode) {
        SetCompletionMode.STANDARD -> set.standardCards ?: set.totalCards ?: 0
        SetCompletionMode.MASTER -> set.totalCards ?: set.standardCards ?: 0
    }.coerceAtLeast(0)

    fun includes(
        collectorNumber: String?,
        tcg: String,
        standardLimit: Int?,
        mode: SetCompletionMode,
    ): Boolean {
        if (mode != SetCompletionMode.STANDARD || !tcg.equals("pokemon", true) ||
            standardLimit == null || standardLimit <= 0 || collectorNumber == null
        ) return true
        val number = collectorNumber.takeWhile(Char::isDigit).toIntOrNull() ?: return true
        return number <= standardLimit
    }

    fun bySet(
        sets: List<CatalogSet>,
        owned: List<OwnedPrinting>,
        mode: SetCompletionMode,
    ): Map<String, SetProgress> {
        val uniqueBySet = owned.asSequence().filter { it.quantity > 0 }.groupBy {
            "${it.tcg.lowercase()}::${it.setCode.orEmpty().lowercase()}"
        }.mapValues { (_, cards) -> cards.distinctBy { it.cardId.lowercase() } }
        return sets.associate { set ->
            val count = uniqueBySet[set.id].orEmpty().count {
                includes(it.collectorNumber, set.tcg, set.standardCards, mode)
            }
            set.id to SetProgress(count, total(set, mode))
        }
    }
}

enum class PokedexOwnershipFilter(val title: String) { ALL("All"), OWNED("Owned"), MISSING("Missing") }

data class PokedexGeneration(val id: Int, val name: String, val range: IntRange) {
    companion object {
        val all = listOf(
            PokedexGeneration(1, "Kanto", 1..151), PokedexGeneration(2, "Johto", 152..251),
            PokedexGeneration(3, "Hoenn", 252..386), PokedexGeneration(4, "Sinnoh", 387..493),
            PokedexGeneration(5, "Unova", 494..649), PokedexGeneration(6, "Kalos", 650..721),
            PokedexGeneration(7, "Alola", 722..809), PokedexGeneration(8, "Galar", 810..905),
            PokedexGeneration(9, "Paldea", 906..1025),
        )
    }
}

data class PokedexSpeciesProgress(
    val entry: PokedexEntry,
    val printings: List<CatalogParityCard>,
    val ownedCopies: Int,
) {
    val isOwned: Boolean get() = ownedCopies > 0
    val artworkUrl: String get() =
        "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${entry.number}.png"
}

object PokedexProgressBuilder {
    fun build(
        catalogCards: List<CatalogParityCard>,
        ownedCards: List<OwnedPrinting>,
        nationalDex: List<PokedexEntry> = emptyList(),
    ): List<PokedexSpeciesProgress> {
        val entries = nationalDex.associateByTo(linkedMapOf(), PokedexEntry::number)
        val prints = mutableMapOf<Int, MutableMap<String, CatalogParityCard>>()
        catalogCards.filter { it.tcg.equals("pokemon", true) }.forEach { card ->
            card.dexEntries.forEach { entry ->
                if (entry.number in 1..1025) {
                    entries[entry.number] = entry
                    prints.getOrPut(entry.number, ::linkedMapOf)[card.id] = card
                }
            }
        }
        val owned = mutableMapOf<Int, Int>()
        ownedCards.filter { it.quantity > 0 && it.tcg.equals("pokemon", true) }.forEach { card ->
            val explicit = card.dexEntries
            val resolved = if (explicit.isNotEmpty()) explicit else catalogCards.firstOrNull {
                it.id == card.cardId && it.tcg.equals(card.tcg, true)
            }?.dexEntries.orEmpty()
            resolved.forEach { entry ->
                if (entry.number in 1..1025) {
                    entries[entry.number] = entry
                    owned[entry.number] = owned.getOrDefault(entry.number, 0) + card.quantity
                }
            }
        }
        return entries.values.sortedBy(PokedexEntry::number).map { entry ->
            PokedexSpeciesProgress(entry, prints[entry.number].orEmpty().values.toList(), owned[entry.number] ?: 0)
        }
    }
}

@Serializable
enum class GuideCategory(val label: String) {
    @kotlinx.serialization.SerialName("art-style") ART_STYLE("Art style"),
    @kotlinx.serialization.SerialName("artist") ARTIST("Artist"),
    @kotlinx.serialization.SerialName("species") SPECIES("Species"),
    @kotlinx.serialization.SerialName("story") STORY("Story / connected art"),
    @kotlinx.serialization.SerialName("cameo") CAMEO("Cameo"),
    @kotlinx.serialization.SerialName("custom") CUSTOM("Custom"),
}

@Serializable
data class CollectionGuideRule(
    val type: String,
    val tcg: String,
    val query: String? = null,
    val setCode: String? = null,
    val setName: String? = null,
    val includeAllPrintings: Boolean = true,
)

@Serializable
data class CollectionGuide(
    val id: String,
    val slug: String,
    val title: String,
    val description: String,
    val tcg: String,
    val category: GuideCategory,
    val coverImageUrl: String? = null,
    val curatorName: String = "TCGer",
    val tags: List<String> = emptyList(),
    val version: Int = 1,
    val featured: Boolean = false,
    val rule: CollectionGuideRule,
    val cardCountHint: Int? = null,
    val followed: Boolean = false,
    val wishlistId: String? = null,
)

@Serializable
data class GuideCardMembership(
    val guideId: String,
    val slug: String,
    val title: String,
    val category: GuideCategory,
    val tags: List<String> = emptyList(),
    val groupKey: String? = null,
    val groupLabel: String? = null,
    val groupOrder: Int? = null,
    val position: Int? = null,
)

@Serializable
data class GuideCardResult(
    val card: CatalogParityCard,
    val owned: Boolean = false,
    val ownedQuantity: Int = 0,
    val matchedGuides: List<GuideCardMembership> = emptyList(),
)

@Serializable data class GuideCardSearchResponse(
    val results: List<GuideCardResult> = emptyList(),
    val total: Int = 0,
    val failedGuideSlugs: List<String> = emptyList(),
)

@Serializable data class FollowGuideRequest(val wishlistName: String? = null)
@Serializable data class FollowGuideResponse(val guide: CollectionGuide, val wishlistId: String, val created: Boolean)
