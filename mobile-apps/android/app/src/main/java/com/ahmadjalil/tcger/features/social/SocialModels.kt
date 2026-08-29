package com.ahmadjalil.tcger.features.social

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class DeckCard(
    val id: String,
    val externalId: String,
    val tcg: String,
    val name: String,
    val quantity: Int,
    val zone: String,
    val isCommander: Boolean = false,
    val isSideboard: Boolean = false,
    val imageUrl: String? = null,
    val imageUrlSmall: String? = null,
    val setCode: String? = null,
    val setName: String? = null,
    val cardData: Map<String, JsonElement>? = null,
)

@Serializable
data class Deck(
    val id: String,
    val name: String,
    val description: String? = null,
    val tcg: String,
    val format: String? = null,
    val colorHex: String? = null,
    val isPublic: Boolean = false,
    val cards: List<DeckCard> = emptyList(),
    val cardCount: Int = cards.sumOf(DeckCard::quantity),
    val createdAt: String = "",
    val updatedAt: String = "",
)

@Serializable
data class DeckDraft(
    val name: String,
    val description: String? = null,
    val tcg: String,
    val format: String? = null,
    val colorHex: String? = null,
    val isPublic: Boolean = false,
) {
    fun normalized() = copy(
        name = name.trim(),
        description = description.clean(),
        tcg = tcg.trim().lowercase(),
        format = format.clean(),
        colorHex = colorHex.clean()?.removePrefix("#")?.uppercase(),
    )

    val isValid: Boolean get() = name.isNotBlank() && tcg.isNotBlank()
}

@Serializable
data class DeckUpdate(
    val name: String? = null,
    val description: String? = null,
    val format: String? = null,
    val colorHex: String? = null,
    val isPublic: Boolean? = null,
)

@Serializable
data class DeckCardDraft(
    val externalId: String,
    val tcg: String,
    val name: String,
    val quantity: Int = 1,
    val zone: String = "main",
    val isCommander: Boolean = false,
    val isSideboard: Boolean = zone == "side",
    val imageUrl: String? = null,
    val imageUrlSmall: String? = null,
    val setCode: String? = null,
    val setName: String? = null,
) {
    fun normalized() = copy(
        externalId = externalId.trim(),
        tcg = tcg.trim().lowercase(),
        name = name.trim(),
        quantity = quantity.coerceAtLeast(1),
        zone = zone.trim().lowercase().ifBlank { "main" },
        imageUrl = imageUrl.clean(),
        imageUrlSmall = imageUrlSmall.clean(),
        setCode = setCode.clean(),
        setName = setName.clean(),
    )

    val isValid: Boolean get() = externalId.isNotBlank() && tcg.isNotBlank() && name.isNotBlank() && quantity > 0
}

@Serializable
data class DeckCardUpdate(
    val quantity: Int,
    val zone: String,
    val isCommander: Boolean? = null,
    val isSideboard: Boolean = zone == "side",
)

@Serializable data class ValidateDeckRequest(val format: String? = null)

@Serializable
data class DeckValidation(
    val valid: Boolean,
    val errors: List<String> = emptyList(),
    val warnings: List<String> = emptyList(),
    val format: String? = null,
    val points: Double? = null,
    val violations: List<DeckViolation>? = null,
)

@Serializable data class DeckViolation(
    val externalId: String? = null,
    val name: String? = null,
    val zone: String? = null,
    val message: String,
)

@Serializable
data class DeckOwnership(
    val owned: List<OwnedDeckCard> = emptyList(),
    val missing: List<MissingDeckCard> = emptyList(),
    val missingCount: Int = 0,
)

@Serializable data class OwnedDeckCard(val externalId: String, val quantity: Int)
@Serializable data class MissingDeckCard(val externalId: String, val name: String, val quantity: Int, val zone: String)

@Serializable
data class DeckImportRequest(
    val source: String,
    val data: String,
    val name: String? = null,
    val tcg: String? = null,
    val format: String? = null,
)

@Serializable
data class DeckImportResult(
    val deck: Deck,
    val importedCount: Int,
    val skippedCount: Int,
    val skippedCards: List<String> = emptyList(),
)

@Serializable data class DeckYdkExport(val content: String, val skipped: List<SkippedDeckCard> = emptyList())
@Serializable data class SkippedDeckCard(val externalId: String, val name: String, val reason: String)

@Serializable
data class TradeCard(
    val id: String,
    val side: String,
    val externalId: String,
    val tcg: String,
    val name: String,
    val quantity: Int,
    val imageUrl: String? = null,
    val estimatedValue: Double? = null,
)

@Serializable
data class Trade(
    val id: String,
    val senderId: String,
    val receiverId: String,
    val status: String,
    val message: String? = null,
    val cards: List<TradeCard> = emptyList(),
    val createdAt: String,
    val updatedAt: String,
) {
    fun giving(currentUserId: String?) = cards.filter {
        it.side == if (senderId == currentUserId) "sender" else "receiver"
    }

    fun receiving(currentUserId: String?) = cards.filter {
        it.side == if (senderId == currentUserId) "receiver" else "sender"
    }

    fun canAccept(currentUserId: String?) = status == "pending" && receiverId == currentUserId
    fun canCancel(currentUserId: String?) = status == "pending" && senderId == currentUserId
    fun canDelete(currentUserId: String?) = senderId == currentUserId
}

@Serializable data class TradeMatchCard(val externalId: String, val tcg: String, val name: String)

@Serializable
data class TradeMatch(
    val userId: String,
    val username: String? = null,
    val theyHave: List<TradeMatchCard> = emptyList(),
    val youHave: List<TradeMatchCard> = emptyList(),
    val matchScore: Double = 0.0,
)

@Serializable
data class TradeCardRequest(
    val externalId: String,
    val tcg: String,
    val name: String,
    val quantity: Int = 1,
    val imageUrl: String? = null,
    val estimatedValue: Double? = null,
)

@Serializable
data class CreateTradeRequest(
    val receiverId: String,
    val message: String? = null,
    val senderCards: List<TradeCardRequest>,
    val receiverCards: List<TradeCardRequest> = emptyList(),
)

fun TradeMatch.toTradeRequest(message: String?): CreateTradeRequest = CreateTradeRequest(
    receiverId = userId,
    message = message.clean(),
    senderCards = youHave.map { TradeCardRequest(it.externalId, it.tcg, it.name) },
    receiverCards = theyHave.map { TradeCardRequest(it.externalId, it.tcg, it.name) },
)

@Serializable
data class AppNotification(
    val id: String,
    val userId: String,
    val type: String,
    val title: String,
    val body: String,
    val read: Boolean,
    val data: JsonElement? = null,
    val createdAt: String,
) {
    val category: NotificationCategory get() = NotificationCategory.from(type)
}

enum class NotificationCategory { TRADE, PRICE, IMPORT, NEWS, GENERAL;
    companion object {
        fun from(raw: String): NotificationCategory {
            val type = raw.lowercase()
            return when {
                "trade" in type -> TRADE
                "price" in type || "market" in type -> PRICE
                "import" in type || "scan" in type -> IMPORT
                "news" in type || "release" in type -> NEWS
                else -> GENERAL
            }
        }
    }
}

internal fun String?.clean(): String? = this?.trim()?.ifBlank { null }
