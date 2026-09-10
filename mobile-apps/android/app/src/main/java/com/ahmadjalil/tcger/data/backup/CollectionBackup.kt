package com.ahmadjalil.tcger.data.backup

import com.ahmadjalil.tcger.domain.CollectionDetails
import com.ahmadjalil.tcger.domain.CollectionEdit
import com.ahmadjalil.tcger.domain.Binder
import com.ahmadjalil.tcger.domain.BinderInput
import com.ahmadjalil.tcger.domain.CatalogCard
import com.ahmadjalil.tcger.domain.SealedInventoryItem
import com.ahmadjalil.tcger.domain.Wishlist
import com.ahmadjalil.tcger.domain.WishlistInput
import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*

@Serializable
data class PortableCollectionBackup(
    val formatVersion: Int = 2,
    val format: String = "com.tcger.portable-backup",
    val sections: JsonObject = JsonObject(emptyMap()),
    val exportedAt: String,
    val binders: List<PortableBinder>,
    val wishlists: List<PortableWishlist>,
    val sealedInventory: List<PortableSealedInventory>,
)

@Serializable
data class PortableCard(
    val id: String,
    val name: String,
    val tcg: String,
    val setCode: String? = null,
    val setName: String? = null,
    val rarity: String? = null,
    val collectorNumber: String? = null,
    val imageUrl: String? = null,
)

@Serializable
data class PortableOwnedCard(
    val card: PortableCard,
    val quantity: Int,
    val condition: String? = null,
    val price: Double? = null,
    val acquisitionPrice: Double? = null,
    val details: CollectionDetails = CollectionDetails(),
    val id: String? = null,
)

@Serializable
data class PortableBinder(
    val name: String,
    val description: String? = null,
    val colorHex: String,
    val defaultCondition: String? = null,
    val containerType: String? = null,
    val imageUrl: String? = null,
    val cards: List<PortableOwnedCard>,
    val id: String? = null,
    val associatedTcg: String? = null,
    val associatedSetCode: String? = null,
    val associatedSetName: String? = null,
) {
    fun input() = BinderInput(name, description, colorHex, defaultCondition, containerType, imageUrl, associatedTcg, associatedSetCode, associatedSetName)
}

@Serializable
data class PortableWishlistCard(
    val card: PortableCard,
    val desiredQuantity: Int = 1,
    val notes: String? = null,
    val id: String? = null,
)

@Serializable
data class PortableWishlist(
    val name: String,
    val description: String? = null,
    val colorHex: String,
    val matchAnyPrinting: Boolean,
    val cards: List<PortableWishlistCard>,
    val rules: List<com.ahmadjalil.tcger.domain.WishlistRule> = emptyList(),
    val id: String? = null,
    val excludedCardKeys: List<String> = emptyList(),
) {
    fun input() = WishlistInput(name, description, colorHex, matchAnyPrinting)
}

@Serializable
data class PortableSealedInventory(
    val productId: String,
    val productName: String,
    val quantity: Int,
    val purchasePrice: Double? = null,
    val purchaseDate: String? = null,
    val notes: String? = null,
    val id: String? = null,
    val product: JsonObject? = null,
)

object CollectionBackupJson {
    private val codec = Json { encodeDefaults = true; explicitNulls = false; ignoreUnknownKeys = true; prettyPrint = true }

    fun create(
        binders: List<Binder>,
        wishlists: List<Wishlist>,
        sealedInventory: List<SealedInventoryItem>,
        exportedAt: String = Instant.now().toString(),
    ) = PortableCollectionBackup(
        exportedAt = exportedAt,
        binders = binders.map { binder ->
            PortableBinder(
                binder.name,
                binder.description,
                binder.colorHex,
                binder.defaultCondition,
                binder.containerType,
                binder.imageUrl,
                binder.cards.map { PortableOwnedCard(it.card.portable(), it.quantity, it.condition, it.price, it.acquisitionPrice, it.details, it.id) },
                binder.id, binder.associatedTcg, binder.associatedSetCode, binder.associatedSetName,
            )
        },
        wishlists = wishlists.map { wishlist ->
            PortableWishlist(
                wishlist.name,
                wishlist.description,
                wishlist.colorHex,
                wishlist.matchAnyPrinting,
                wishlist.cards.map { PortableWishlistCard(it.card.portable(), it.desiredQuantity, it.notes, it.id) },
                wishlist.rules, wishlist.id, wishlist.excludedCardKeys,
            )
        },
        sealedInventory = sealedInventory.map {
            PortableSealedInventory(
                it.product.id,
                it.product.name,
                it.quantity,
                it.purchasePrice,
                it.purchaseDate,
                it.notes,
                it.id,
                codec.encodeToJsonElement(it.product).jsonObject,
            )
        },
    )

    fun encode(backup: PortableCollectionBackup): String = codec.encodeToString(backup)

    fun decode(raw: String): PortableCollectionBackup = codec.decodeFromJsonElement<PortableCollectionBackup>(normalizeBackupDocument(codec.parseToJsonElement(raw).jsonObject)).also {
        require(it.formatVersion == 2) { "Unsupported backup version ${it.formatVersion}" }
        val ids = mutableSetOf<String>()
        fun unique(id: String?) { if (id != null) require(id.isNotBlank() && ids.add(id)) { "Duplicate or empty backup ID: $id" } }
        it.binders.forEach { binder ->
            unique(binder.id)
            require(binder.name.isNotBlank()) { "Every binder needs a name" }
            binder.cards.forEach { card ->
                unique(card.id)
                require(card.card.name.isNotBlank())
                require(card.quantity in 1..10000 && card.card.id.isNotBlank() && card.card.tcg.isNotBlank()) { "Invalid collection card" }
                CollectionEdit(card.condition, card.price, card.acquisitionPrice, card.details).validate()
            }
        }
        it.wishlists.forEach { wishlist ->
            unique(wishlist.id)
            wishlist.cards.forEach { card -> unique(card.id) }
            require(wishlist.name.isNotBlank())
            wishlist.cards.forEach { card -> require(card.desiredQuantity in 1..99 && card.card.id.isNotBlank() && card.card.tcg.isNotBlank()) }
        }
        it.sealedInventory.forEach { sealed -> require(sealed.quantity >= 0 && (sealed.purchasePrice == null || sealed.purchasePrice.isFinite() && sealed.purchasePrice >= 0)) }
    }

    fun collectionCsv(binders: List<Binder>): String = buildString {
        appendLine("binder,externalId,name,tcg,setCode,collectorNumber,quantity,condition,price,acquisitionPrice,language,notes,serialNumber,acquiredAt,isFoil,finishCode,finishLabel,edition,stamp,isSealedPromo,isOversized,isPeelOff,isSigned,isAltered,gradingCompany,gradingScore,certNumber,storageLocation,tags")
        binders.forEach { binder ->
            binder.cards.forEach { owned ->
                appendLine(
                    listOf(
                        binder.name,
                        owned.card.id,
                        owned.card.name,
                        owned.card.tcg,
                        owned.card.setCode.orEmpty(),
                        owned.card.collectorNumber.orEmpty(),
                        owned.quantity.toString(),
                        owned.condition.orEmpty(),
                        owned.price?.toString().orEmpty(),
                        owned.acquisitionPrice?.toString().orEmpty(),
                        owned.details.language.orEmpty(), owned.details.notes.orEmpty(), owned.details.serialNumber.orEmpty(), owned.details.acquiredAt.orEmpty(),
                        owned.details.isFoil.toString(), owned.details.finishCode.orEmpty(), owned.details.finishLabel.orEmpty(), owned.details.edition.orEmpty(), owned.details.stamp.orEmpty(),
                        owned.details.isSealedPromo.toString(), owned.details.isOversized.toString(), owned.details.isPeelOff.toString(), owned.details.isSigned.toString(), owned.details.isAltered.toString(),
                        owned.details.gradingCompany.orEmpty(), owned.details.gradingScore.orEmpty(), owned.details.certNumber.orEmpty(), owned.details.storageLocation.orEmpty(),
                        owned.details.tags.joinToString("|") { it.label },
                    ).joinToString(",", transform = ::csvCell),
                )
            }
        }
    }

    private fun CatalogCard.portable() = PortableCard(id, name, tcg, setCode, setName, rarity, collectorNumber, imageUrl)
    private fun csvCell(value: String): String = "\"${value.replace("\"", "\"\"")}\""
}

fun PortableCard.toCatalogCard() = CatalogCard(id, name, tcg, setCode, setName, rarity, collectorNumber, imageUrl)
