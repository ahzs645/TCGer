package com.ahmadjalil.tcger.domain

data class CatalogCard(
    val id: String,
    val name: String,
    val tcg: String,
    val setCode: String? = null,
    val setName: String? = null,
    val rarity: String? = null,
    val collectorNumber: String? = null,
    val imageUrl: String? = null,
    val recognitionFamilyId: String? = null,
    val exactPrintingId: String? = null,
    val releaseDate: String? = null,
    val artist: String? = null,
    val supertype: String? = null,
    val attributes: Map<String, List<String>> = emptyMap(),
)

enum class CardScanSource { SERVER_IMAGE_MATCH, ON_DEVICE_EMBEDDING, ON_DEVICE_TEXT }

enum class CardScanEncoderVariant { ARCFACE, DINOV2 }

enum class CardScanEngine(val apiValue: String?) {
    AUTOMATIC("automatic"),
    SERVER_PHASH("phash"),
    SERVER_EMBEDDING("embedding"),
    ON_DEVICE_OCR(null),
}

data class CardScanOptions(
    val engine: CardScanEngine = CardScanEngine.AUTOMATIC,
    val encoderVariant: CardScanEncoderVariant = CardScanEncoderVariant.ARCFACE,
    val saveDebugCapture: Boolean = false,
    val captureSource: String = "android-card-scanner",
    val captureNotes: String? = null,
    val setCodeHint: String? = null,
    val printingMode: com.ahmadjalil.tcger.data.scanner.ScannerPrintingMode =
        com.ahmadjalil.tcger.data.scanner.ScannerPrintingMode.QUICK_LATEST,
    val ocrEnabled: Boolean = true,
)

data class CatalogScanDecision(
    val accepted: Boolean,
    val reason: String,
    val topConfidence: Double? = null,
    val runnerUpConfidence: Double? = null,
) {
    val rejectionMessage: String?
        get() = if (accepted) null else when (reason) {
            "no-catalog-match" -> "No card in the selected catalog scope matched this capture."
            "low-confidence" -> "The closest catalog match was below the safe confidence threshold."
            "ambiguous" -> "The scanner found multiple similarly likely catalog matches."
            else -> "The scanner server declined this catalog match ($reason)."
        }
}

data class CardScanCandidate(
    val card: CatalogCard,
    val confidence: Double? = null,
)

data class CardScanResult(
    val candidates: List<CardScanCandidate>,
    val source: CardScanSource,
    val recognizedText: String? = null,
    val engine: String? = null,
    val elapsedMs: Double? = null,
    val debugCaptureId: String? = null,
    val debugCaptureError: String? = null,
    val printingResolutionProvenance: String = "verified",
    val requiresPrintingChoice: Boolean = false,
    val catalogDecision: CatalogScanDecision? = null,
)

enum class ScanDebugFeedbackStatus(val apiValue: String, val displayName: String) {
    UNREVIEWED("unreviewed", "Unreviewed"),
    CORRECT("correct", "Correct"),
    INCORRECT("incorrect", "Wrong"),
    NEEDS_REVIEW("needs_review", "Needs Review"),
}

enum class ScanDebugReviewTag(val apiValue: String, val displayName: String) {
    WRONG_PRINTING("wrong_printing", "Wrong printing"),
    WRONG_SPECIES("wrong_species", "Wrong card"),
    BAD_CROP("bad_crop", "Bad crop"),
    BLUR("blur", "Blur"),
    GLARE("glare", "Glare"),
    MULTIPLE_CARDS("multiple_cards", "Multiple cards"),
    ENERGY_OR_TRAINER("energy_or_trainer", "Energy/trainer"),
    NO_CARD_PRESENT("no_card_present", "No card"),
}

data class ScanDebugCapture(
    val id: String,
    val requestedTcg: String? = null,
    val captureSource: String? = null,
    val sourceImageUrl: String? = null,
    val feedbackStatus: ScanDebugFeedbackStatus = ScanDebugFeedbackStatus.UNREVIEWED,
    val reviewTags: Set<ScanDebugReviewTag> = emptySet(),
    val notes: String? = null,
    val createdAt: String? = null,
    val bestMatchName: String? = null,
    val bestMatchCardId: String? = null,
    val bestMatchConfidence: Double? = null,
    val artifactImageUrls: List<String> = emptyList(),
)

data class OwnedCard(
    val id: String,
    val binderId: String,
    val card: CatalogCard,
    val quantity: Int,
    val condition: String? = null,
    val price: Double? = null,
    val acquisitionPrice: Double? = null,
)

data class Binder(
    val id: String,
    val name: String,
    val description: String? = null,
    val colorHex: String = "315DA8",
    val defaultCondition: String? = null,
    val containerType: String? = null,
    val imageUrl: String? = null,
    val associatedTcg: String? = null,
    val associatedSetCode: String? = null,
    val associatedSetName: String? = null,
    val cards: List<OwnedCard> = emptyList(),
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
) {
    val uniqueCards: Int get() = cards.size
    val totalCopies: Int get() = cards.sumOf(OwnedCard::quantity)
    val totalValue: Double get() = cards.sumOf { (it.price ?: 0.0) * it.quantity }
}

data class BinderShareLink(
    val id: String,
    val label: String,
    val token: String,
    val expiresAt: String? = null,
    val createdAt: String,
    val lastUsedAt: String? = null,
)

data class BinderInput(
    val name: String,
    val description: String? = null,
    val colorHex: String = "90CAF9",
    val defaultCondition: String? = null,
    val containerType: String? = null,
    val imageUrl: String? = null,
    val associatedTcg: String? = null,
    val associatedSetCode: String? = null,
    val associatedSetName: String? = null,
) {
    fun normalized(): BinderInput = copy(
        name = name.trim(),
        description = description.trimmedOrNull(),
        colorHex = colorHex.trim().removePrefix("#").uppercase().ifBlank { "90CAF9" },
        defaultCondition = defaultCondition.trimmedOrNull(),
        containerType = containerType.trimmedOrNull(),
        imageUrl = imageUrl.trimmedOrNull(),
        associatedTcg = associatedTcg.trimmedOrNull(),
        associatedSetCode = associatedSetCode.trimmedOrNull(),
        associatedSetName = associatedSetName.trimmedOrNull(),
    )
}

private fun String?.trimmedOrNull(): String? = this?.trim()?.ifBlank { null }

val BinderInput.hasValidCoverUrl: Boolean
    get() = imageUrl.isNullOrBlank() || runCatching {
        val uri = java.net.URI(requireNotNull(imageUrl).trim())
        (uri.scheme.equals("http", ignoreCase = true) || uri.scheme.equals("https", ignoreCase = true)) &&
            !uri.host.isNullOrBlank()
    }.getOrDefault(false)

data class WishlistCard(
    val id: String,
    val card: CatalogCard,
    val desiredQuantity: Int = 1,
    val ownedQuantity: Int = 0,
    val notes: String? = null,
)

data class Wishlist(
    val id: String,
    val name: String,
    val description: String? = null,
    val colorHex: String = "C43D73",
    val matchAnyPrinting: Boolean = false,
    val cards: List<WishlistCard> = emptyList(),
) {
    val ownedCards: Int get() = cards.count { it.ownedQuantity > 0 }
    val completionPercent: Int
        get() = if (cards.isEmpty()) 0 else (ownedCards * 100) / cards.size
}

data class WishlistInput(
    val name: String,
    val description: String? = null,
    val colorHex: String = "C43D73",
    val matchAnyPrinting: Boolean = false,
) {
    fun normalized(): WishlistInput = copy(
        name = name.trim(),
        description = description.trimmedOrNull(),
        colorHex = colorHex.trim().removePrefix("#").uppercase().ifBlank { "C43D73" },
    )
}

data class SealedProduct(
    val id: String,
    val tcg: String,
    val name: String,
    val productType: String,
    val setCode: String? = null,
    val cardsPerPack: Int? = null,
    val packsPerBox: Int? = null,
    val releaseDate: String? = null,
    val imageUrl: String? = null,
    val msrp: Double? = null,
    val upc: String? = null,
    val isCustom: Boolean = false,
)

data class SealedInventoryItem(
    val id: String,
    val product: SealedProduct,
    val quantity: Int,
    val purchasePrice: Double? = null,
    val purchaseDate: String? = null,
    val notes: String? = null,
    val createdAt: String? = null,
)

data class SealedOpeningRecord(
    val id: String,
    val sealedInventoryId: String,
    val openedQuantity: Int,
    val openedAt: String,
    val notes: String? = null,
    val createdAt: String? = null,
)

data class SealedLedgerCard(
    val id: String,
    val collectionId: String? = null,
    val externalId: String,
    val tcg: String,
    val cardName: String,
    val quantity: Int,
    val status: String,
    val liveValue: Double = 0.0,
    val realizedProceeds: Double = 0.0,
    val soldAt: String? = null,
)

data class SealedOpeningLedger(
    val id: String,
    val inventoryId: String,
    val productName: String,
    val openedQuantity: Int,
    val openedAt: String,
    val invested: Double,
    val liveValue: Double,
    val realizedProceeds: Double,
    val profitLoss: Double,
    val activeCopies: Int,
    val soldCopies: Int,
    val cards: List<SealedLedgerCard> = emptyList(),
)

data class DashboardStats(
    val binderCount: Int,
    val uniqueCards: Int,
    val totalCopies: Int,
    val totalValue: Double,
)

fun List<Binder>.dashboardStats() = DashboardStats(
    binderCount = size,
    uniqueCards = sumOf(Binder::uniqueCards),
    totalCopies = sumOf(Binder::totalCopies),
    totalValue = sumOf(Binder::totalValue),
)

enum class DataSourceMode { ON_DEVICE, SERVER }

data class AppPreferences(
    val dataSourceMode: DataSourceMode = DataSourceMode.ON_DEVICE,
    val serverUrl: String = "",
    val authToken: String? = null,
    val username: String? = null,
    val userId: String? = null,
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val accent: AccentChoice = AccentChoice.BLUE,
    val currency: String = "USD",
    val showPricing: Boolean = true,
    val showCardNumbers: Boolean = true,
    val biometricLockEnabled: Boolean = false,
    val enabledGames: Set<String> = setOf("pokemon", "magic", "yugioh"),
    val defaultGame: String? = null,
    val bottomNavigationOrder: List<BottomNavigationItem> = BottomNavigationItem.defaultOrder,
    val hiddenBottomNavigationItems: Set<BottomNavigationItem> = emptySet(),
) {
    val isSignedIn: Boolean get() = !authToken.isNullOrBlank()

    val visibleBottomNavigationItems: List<BottomNavigationItem>
        get() = bottomNavigationOrder.filter { item ->
            item.isPinned || item !in hiddenBottomNavigationItems
        }
}

fun gameDisableBlockReason(game: String, binders: List<Binder>, wishlists: List<Wishlist>): String? {
    val normalizedGame = game.trim().lowercase()
    val ownedCopies = binders.sumOf { binder ->
        binder.cards.filter { it.card.tcg.equals(normalizedGame, ignoreCase = true) }.sumOf(OwnedCard::quantity)
    }
    val wishlistEntries = wishlists.sumOf { wishlist ->
        wishlist.cards.count { it.card.tcg.equals(normalizedGame, ignoreCase = true) }
    }
    if (ownedCopies == 0 && wishlistEntries == 0) return null
    return buildList {
        if (ownedCopies > 0) add("$ownedCopies collection ${if (ownedCopies == 1) "card" else "cards"}")
        if (wishlistEntries > 0) add("$wishlistEntries wishlist ${if (wishlistEntries == 1) "entry" else "entries"}")
    }.joinToString(" and ")
}

/**
 * Destinations Android can currently render as a bottom-navigation item.
 *
 * Keep the persisted value independent from labels and routes so translations and navigation
 * refactors do not invalidate a user's layout. New destinations are appended by [normalizedOrder]
 * when an older install starts a newer build.
 */
enum class BottomNavigationItem {
    HOME,
    COLLECTIONS,
    SETS,
    POKEDEX,
    DECKS,
    SEARCH,
    WISHLISTS,
    GUIDES,
    SCAN,
    SEALED,
    CODES,
    PRICES,
    ANALYTICS,
    TRADES,
    ACTIVITY,
    PACK_OPENING,
    SETTINGS;

    val isPinned: Boolean get() = this == SETTINGS

    companion object {
        val defaultOrder: List<BottomNavigationItem> = entries.toList()

        fun normalizedOrder(rawValues: Iterable<String>): List<BottomNavigationItem> {
            val seen = mutableSetOf<BottomNavigationItem>()
            val order = rawValues.mapNotNull { raw ->
                runCatching { valueOf(raw) }.getOrNull()?.takeIf(seen::add)
            }.toMutableList()
            defaultOrder.filterNot(seen::contains).forEach(order::add)
            return order
        }

        fun normalizedHidden(rawValues: Iterable<String>): Set<BottomNavigationItem> =
            rawValues.mapNotNull { raw -> runCatching { valueOf(raw) }.getOrNull() }
                .filterNot(BottomNavigationItem::isPinned)
                .toSet()

        fun encodeOrder(order: Iterable<BottomNavigationItem>): String =
            normalizedOrder(order.map(BottomNavigationItem::name))
                .joinToString(",", transform = BottomNavigationItem::name)

        fun encodeHidden(hidden: Iterable<BottomNavigationItem>): String =
            hidden.filterNot(BottomNavigationItem::isPinned)
                .distinct()
                .sortedBy(BottomNavigationItem::ordinal)
                .joinToString(",", transform = BottomNavigationItem::name)
    }
}

data class BottomNavigationLayout(val items: List<BottomNavigationItem>) {
    val primaryItems: List<BottomNavigationItem> = if (items.size > MAX_VISIBLE_ITEMS) {
        items.take(MAX_VISIBLE_ITEMS - 1)
    } else {
        items
    }
    val overflowItems: List<BottomNavigationItem> = if (items.size > MAX_VISIBLE_ITEMS) {
        items.drop(MAX_VISIBLE_ITEMS - 1)
    } else {
        emptyList()
    }
    val usesOverflow: Boolean get() = overflowItems.isNotEmpty()

    companion object {
        const val MAX_VISIBLE_ITEMS = 5
    }
}

enum class ThemeMode { SYSTEM, LIGHT, DARK }
enum class AccentChoice { BLUE, GREEN, ORANGE, PURPLE, RED, TEAL }

data class SignInResult(val username: String, val token: String, val userId: String? = null)
