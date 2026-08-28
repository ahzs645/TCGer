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
    val printingMode: com.ahmadjalil.tcger.data.scanner.ScannerPrintingMode =
        com.ahmadjalil.tcger.data.scanner.ScannerPrintingMode.QUICK_LATEST,
)

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
)

data class Binder(
    val id: String,
    val name: String,
    val description: String? = null,
    val colorHex: String = "315DA8",
    val cards: List<OwnedCard> = emptyList(),
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
) {
    val uniqueCards: Int get() = cards.size
    val totalCopies: Int get() = cards.sumOf(OwnedCard::quantity)
    val totalValue: Double get() = cards.sumOf { (it.price ?: 0.0) * it.quantity }
}

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
    val cards: List<WishlistCard> = emptyList(),
) {
    val ownedCards: Int get() = cards.count { it.ownedQuantity > 0 }
    val completionPercent: Int
        get() = if (cards.isEmpty()) 0 else (ownedCards * 100) / cards.size
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
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val accent: AccentChoice = AccentChoice.BLUE,
    val currency: String = "USD",
    val showPricing: Boolean = true,
    val enabledGames: Set<String> = setOf("pokemon", "magic", "yugioh"),
) {
    val isSignedIn: Boolean get() = !authToken.isNullOrBlank()
}

enum class ThemeMode { SYSTEM, LIGHT, DARK }
enum class AccentChoice { BLUE, GREEN, ORANGE, PURPLE, RED, TEAL }

data class SignInResult(val username: String, val token: String)
