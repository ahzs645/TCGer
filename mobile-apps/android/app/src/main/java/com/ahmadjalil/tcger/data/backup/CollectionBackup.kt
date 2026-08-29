package com.ahmadjalil.tcger.data.backup

import com.ahmadjalil.tcger.domain.Binder
import com.ahmadjalil.tcger.domain.BinderInput
import com.ahmadjalil.tcger.domain.CatalogCard
import com.ahmadjalil.tcger.domain.SealedInventoryItem
import com.ahmadjalil.tcger.domain.Wishlist
import com.ahmadjalil.tcger.domain.WishlistInput
import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class PortableCollectionBackup(
    val formatVersion: Int = 1,
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
) {
    fun input() = BinderInput(name, description, colorHex, defaultCondition, containerType, imageUrl)
}

@Serializable
data class PortableWishlistCard(
    val card: PortableCard,
    val desiredQuantity: Int,
    val notes: String? = null,
)

@Serializable
data class PortableWishlist(
    val name: String,
    val description: String? = null,
    val colorHex: String,
    val matchAnyPrinting: Boolean,
    val cards: List<PortableWishlistCard>,
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
                binder.cards.map { PortableOwnedCard(it.card.portable(), it.quantity, it.condition, it.price) },
            )
        },
        wishlists = wishlists.map { wishlist ->
            PortableWishlist(
                wishlist.name,
                wishlist.description,
                wishlist.colorHex,
                wishlist.matchAnyPrinting,
                wishlist.cards.map { PortableWishlistCard(it.card.portable(), it.desiredQuantity, it.notes) },
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
            )
        },
    )

    fun encode(backup: PortableCollectionBackup): String = codec.encodeToString(backup)

    fun decode(raw: String): PortableCollectionBackup = codec.decodeFromString<PortableCollectionBackup>(raw).also {
        require(it.formatVersion == 1) { "Unsupported backup version ${it.formatVersion}" }
    }

    fun collectionCsv(binders: List<Binder>): String = buildString {
        appendLine("binder,card,game,set,collector_number,quantity,condition,price")
        binders.forEach { binder ->
            binder.cards.forEach { owned ->
                appendLine(
                    listOf(
                        binder.name,
                        owned.card.name,
                        owned.card.tcg,
                        owned.card.setName.orEmpty(),
                        owned.card.collectorNumber.orEmpty(),
                        owned.quantity.toString(),
                        owned.condition.orEmpty(),
                        owned.price?.toString().orEmpty(),
                    ).joinToString(",", transform = ::csvCell),
                )
            }
        }
    }

    private fun CatalogCard.portable() = PortableCard(id, name, tcg, setCode, setName, rarity, collectorNumber, imageUrl)
    private fun csvCell(value: String): String = "\"${value.replace("\"", "\"\"")}\""
}

fun PortableCard.toCatalogCard() = CatalogCard(id, name, tcg, setCode, setName, rarity, collectorNumber, imageUrl)
