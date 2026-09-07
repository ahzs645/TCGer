package com.ahmadjalil.tcger.data.remote

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import kotlinx.serialization.encodeToString
import com.ahmadjalil.tcger.domain.CollectionDetails
import com.ahmadjalil.tcger.domain.CollectionTag

@Serializable
data class HealthDto(val status: String, val features: Map<String, Boolean> = emptyMap())

@Serializable
data class SignInRequest(val username: String, val password: String)

@Serializable
data class AuthUserDto(val id: String, val email: String, val username: String? = null)

@Serializable
data class SignInResponse(val user: AuthUserDto? = null, val token: String? = null)

@Serializable
data class CardDto(
    val id: String,
    val name: String,
    val tcg: String,
    val setCode: String? = null,
    val setName: String? = null,
    val rarity: String? = null,
    val collectorNumber: String? = null,
    val imageUrl: String? = null,
    val imageUrlSmall: String? = null,
    val artist: String? = null,
    val supertype: String? = null,
    val attributes: JsonObject? = null,
    val setSymbolUrl: String? = null,
    val setLogoUrl: String? = null,
)

@Serializable
data class CardSearchResponse(val cards: List<CardDto> = emptyList(), val total: Int = 0)

@Serializable
data class CardDiscoveryResponse(
    val cards: List<CardDto> = emptyList(),
    val total: Int = 0,
)

@Serializable
data class ScanMatchDto(
    val externalId: String,
    val tcg: String,
    val name: String,
    val setCode: String? = null,
    val setName: String? = null,
    val rarity: String? = null,
    val imageUrl: String? = null,
    val confidence: Double? = null,
)

@Serializable
data class ScanCardResponseDto(
    val match: ScanMatchDto? = null,
    val candidates: List<ScanMatchDto> = emptyList(),
    val meta: ScanMetaDto? = null,
    val debugCapture: ScanDebugCaptureSummaryDto? = null,
    val debugCaptureError: String? = null,
)

@Serializable
data class ScanMetaDto(
    val engine: String? = null,
    val variantUsed: String? = null,
    val thresholdUsed: Int? = null,
    val perspectiveCorrected: Boolean? = null,
    val rerankUsed: Boolean? = null,
    val shortlistSize: Int? = null,
    val catalogDecision: CatalogDecisionDto? = null,
    val timings: ScanTimingDto? = null,
)

@Serializable
data class CatalogDecisionDto(
    val accepted: Boolean,
    val reason: String,
    val topConfidence: Double? = null,
    val runnerUpConfidence: Double? = null,
)

@Serializable
data class ScanTimingDto(
    val preprocessMs: Double? = null,
    val perspectiveCorrectionMs: Double? = null,
    val qualityMs: Double? = null,
    val hashMs: Double? = null,
    val featureHashMs: Double? = null,
    val rankingMs: Double? = null,
    val artworkPrefilterMs: Double? = null,
    val artworkRerankMs: Double? = null,
    val ocrMs: Double? = null,
    val totalMs: Double? = null,
)

@Serializable
data class ScanDebugCaptureSummaryDto(
    val id: String,
    val requestedTcg: String? = null,
    val captureSource: String? = null,
    val sourceImageUrl: String? = null,
    val feedbackStatus: String? = null,
    val reviewTags: List<String> = emptyList(),
    val notes: String? = null,
    val expectedExternalId: String? = null,
    val expectedName: String? = null,
    val expectedTcg: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val artifactImages: ScanArtifactImagesDto = ScanArtifactImagesDto(),
    val bestMatch: ScanDebugBestMatchDto? = null,
)

@Serializable
data class ScanArtifactImagesDto(
    val correctedImageUrl: String? = null,
    val artworkImageUrl: String? = null,
    val titleImageUrl: String? = null,
    val footerImageUrl: String? = null,
)

@Serializable
data class ScanDebugBestMatchDto(
    val externalId: String,
    val name: String? = null,
    val tcg: String? = null,
    val confidence: Double? = null,
    val distance: Double? = null,
)

@Serializable data class ScanDebugCaptureListDto(val captures: List<ScanDebugCaptureSummaryDto> = emptyList())
@Serializable data class ScanDebugCaptureEnvelopeDto(val capture: ScanDebugCaptureSummaryDto)

@Serializable
data class UpdateScanDebugCaptureRequest(
    val feedbackStatus: String? = null,
    val reviewTags: List<String>? = null,
    val notes: String? = null,
)

@Serializable
data class CollectionCardDto(
    val id: String,
    val cardId: String? = null,
    val externalId: String? = null,
    val name: String,
    val tcg: String,
    val setCode: String? = null,
    val setName: String? = null,
    val rarity: String? = null,
    val collectorNumber: String? = null,
    val imageUrl: String? = null,
    val imageUrlSmall: String? = null,
    val quantity: Int = 1,
    val condition: String? = null,
    val price: Double? = null,
    val acquisitionPrice: Double? = null,
    val copies: List<CollectionCopyDto> = emptyList(),
)

@Serializable
data class CollectionCopyDto(
    val id: String,
    val condition: String? = null,
    val price: Double? = null,
    val acquisitionPrice: Double? = null,
    val language: String? = null,
    val notes: String? = null,
    val serialNumber: String? = null,
    val acquiredAt: String? = null,
    val isFoil: Boolean = false,
    val finishCode: String? = null,
    val finishLabel: String? = null,
    val edition: String? = null,
    val stamp: String? = null,
    val isSealedPromo: Boolean = false,
    val isOversized: Boolean = false,
    val isPeelOff: Boolean = false,
    val isSigned: Boolean = false,
    val isAltered: Boolean = false,
    val gradingCompany: String? = null,
    val gradingScore: String? = null,
    val certNumber: String? = null,
    val storageLocation: String? = null,
    val imageUrls: List<String> = emptyList(),
    val tags: List<CollectionTag> = emptyList(),
) {
    fun details(): CollectionDetails = Json { ignoreUnknownKeys = true }.decodeFromJsonElement(Json.encodeToJsonElement(this))
}

@Serializable
data class BinderDto(
    val id: String,
    val name: String,
    val description: String? = null,
    val colorHex: String? = null,
    val defaultCondition: String? = null,
    val containerType: String? = null,
    val imageUrl: String? = null,
    val associatedTcg: String? = null,
    val associatedSetCode: String? = null,
    val associatedSetName: String? = null,
    val cards: List<CollectionCardDto> = emptyList(),
    val createdAt: String? = null,
    val updatedAt: String? = null,
)

@Serializable
data class BinderShareLinkDto(
    val id: String,
    val label: String,
    val token: String,
    val expiresAt: String? = null,
    val createdAt: String,
    val lastUsedAt: String? = null,
)

@Serializable
data class CreateBinderShareLinkRequest(val label: String, val expiresAt: String? = null)

@Serializable
data class CreateBinderRequest(
    val name: String,
    val description: String? = null,
    val colorHex: String? = null,
    val defaultCondition: String? = null,
    val containerType: String? = null,
    val imageUrl: String? = null,
    val associatedTcg: String? = null,
    val associatedSetCode: String? = null,
    val associatedSetName: String? = null,
)

@Serializable
data class AddCardRequest(
    val cardId: String,
    val quantity: Int = 1,
    val cardData: CardDataRequest? = null,
    val condition: String? = null,
    val price: Double? = null,
    val acquisitionPrice: Double? = null,
    @kotlinx.serialization.Transient val details: CollectionDetails = CollectionDetails(),
) {
    fun payload(): JsonObject {
        val codec = Json { encodeDefaults = true; explicitNulls = false }
        val fields = codec.encodeToJsonElement(this).jsonObject.toMutableMap()
        fields.putAll(codec.encodeToJsonElement(details).jsonObject)
        details.acquiredAt?.takeIf { it.length == 10 }?.let { fields["acquiredAt"] = JsonPrimitive(java.time.LocalDate.parse(it).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toString()) }
        fields["tags"] = JsonArray(details.tags.filter { it.id.isNotBlank() }.map { JsonPrimitive(it.id) })
        fields["newTags"] = JsonArray(details.tags.filter { it.id.isBlank() }.map {
            buildJsonObject { put("label", it.label); put("colorHex", it.colorHex) }
        })
        return JsonObject(fields)
    }
}

@Serializable
data class CardDataRequest(
    val name: String,
    val tcg: String,
    val externalId: String,
    val setCode: String? = null,
    val setName: String? = null,
    val rarity: String? = null,
    val collectorNumber: String? = null,
    val imageUrl: String? = null,
    val imageUrlSmall: String? = null,
)

@Serializable
data class AddedCollectionCopyDto(val id: String? = null, val copies: List<AddedCollectionCopyDto> = emptyList()) {
    val createdCopyId: String? get() = id ?: copies.firstNotNullOfOrNull(AddedCollectionCopyDto::createdCopyId)
}

@Serializable
data class SealedProductDto(
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

@Serializable
data class SealedInventoryItemDto(
    val id: String,
    val product: SealedProductDto,
    val quantity: Int,
    val purchasePrice: Double? = null,
    val purchaseDate: String? = null,
    val notes: String? = null,
    val createdAt: String? = null,
)

@Serializable
data class AddSealedInventoryRequest(
    val productId: String,
    val quantity: Int = 1,
    val purchasePrice: Double? = null,
    val purchaseDate: String? = null,
    val notes: String? = null,
)

@Serializable
data class SealedLedgerCardDto(
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

@Serializable
data class SealedOpeningLedgerDto(
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
    val cards: List<SealedLedgerCardDto> = emptyList(),
)

@Serializable
data class CreateSealedOpeningRequest(
    val openedQuantity: Int,
    val collectionIds: List<String>,
    val openedAt: String? = null,
    val notes: String? = null,
)

@Serializable
data class SealedOpeningDto(
    val id: String,
    val sealedInventoryId: String,
    val openedQuantity: Int,
    val openedAt: String,
    val notes: String? = null,
    val createdAt: String? = null,
)

@Serializable
data class WishlistCardDto(
    val id: String,
    val externalId: String,
    val tcg: String,
    val name: String,
    val setCode: String? = null,
    val setName: String? = null,
    val rarity: String? = null,
    val collectorNumber: String? = null,
    val imageUrl: String? = null,
    val imageUrlSmall: String? = null,
    val notes: String? = null,
    val desiredQuantity: Int = 1,
    val ownedQuantity: Int = 0,
)

@Serializable
data class WishlistDto(
    val id: String,
    val name: String,
    val description: String? = null,
    val colorHex: String? = null,
    val matchAnyPrinting: Boolean = false,
    val cards: List<WishlistCardDto> = emptyList(),
    val rules: List<com.ahmadjalil.tcger.domain.WishlistRule> = emptyList(),
)

@Serializable
data class WishlistRequest(
    val name: String,
    val description: String? = null,
    val colorHex: String? = null,
    val matchAnyPrinting: Boolean = false,
)

@Serializable
data class AddWishlistCardRequest(
    val externalId: String,
    val tcg: String,
    val name: String,
    val setCode: String? = null,
    val setName: String? = null,
    val rarity: String? = null,
    val collectorNumber: String? = null,
    val imageUrl: String? = null,
    val imageUrlSmall: String? = null,
    val desiredQuantity: Int = 1,
)

@Serializable
data class CardPrintsDto(val prints: List<CardDto> = emptyList())
