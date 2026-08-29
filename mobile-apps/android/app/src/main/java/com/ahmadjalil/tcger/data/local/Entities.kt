package com.ahmadjalil.tcger.data.local

import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.Relation

@Entity(tableName = "binders")
data class BinderEntity(
    @PrimaryKey val id: String,
    val name: String,
    val description: String?,
    val colorHex: String,
    val defaultCondition: String?,
    val containerType: String?,
    val imageUrl: String?,
    val associatedTcg: String?,
    val associatedSetCode: String?,
    val associatedSetName: String?,
    val createdAt: Long,
    val updatedAt: Long,
)

@Entity(
    tableName = "owned_cards",
    foreignKeys = [
        ForeignKey(
            entity = BinderEntity::class,
            parentColumns = ["id"],
            childColumns = ["binderId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index("binderId"), Index("name"), Index(value = ["externalId", "binderId"])],
)
data class OwnedCardEntity(
    @PrimaryKey val id: String,
    val binderId: String,
    val externalId: String,
    val name: String,
    val tcg: String,
    val setCode: String?,
    val setName: String?,
    val rarity: String?,
    val collectorNumber: String?,
    val imageUrl: String?,
    val quantity: Int,
    val condition: String?,
    val price: Double?,
    val createdAt: Long,
)

data class BinderWithCards(
    @Embedded val binder: BinderEntity,
    @Relation(parentColumn = "id", entityColumn = "binderId")
    val cards: List<OwnedCardEntity>,
)

@Entity(tableName = "wishlists")
data class WishlistEntity(
    @PrimaryKey val id: String,
    val name: String,
    val description: String?,
    val colorHex: String,
    val matchAnyPrinting: Boolean,
    val createdAt: Long,
    val updatedAt: Long,
)

@Entity(
    tableName = "wishlist_cards",
    foreignKeys = [
        ForeignKey(
            entity = WishlistEntity::class,
            parentColumns = ["id"],
            childColumns = ["wishlistId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index("wishlistId"), Index(value = ["externalId", "wishlistId"], unique = true)],
)
data class WishlistCardEntity(
    @PrimaryKey val id: String,
    val wishlistId: String,
    val externalId: String,
    val name: String,
    val tcg: String,
    val setCode: String?,
    val setName: String?,
    val rarity: String?,
    val collectorNumber: String?,
    val imageUrl: String?,
    val desiredQuantity: Int,
    val notes: String?,
    val createdAt: Long,
)

data class WishlistWithCards(
    @Embedded val wishlist: WishlistEntity,
    @Relation(parentColumn = "id", entityColumn = "wishlistId")
    val cards: List<WishlistCardEntity>,
)

@Entity(tableName = "sealed_products", indices = [Index("tcg"), Index("name"), Index("upc")])
data class SealedProductEntity(
    @PrimaryKey val id: String,
    val tcg: String,
    val name: String,
    val productType: String,
    val setCode: String?,
    val cardsPerPack: Int?,
    val packsPerBox: Int?,
    val releaseDate: String?,
    val imageUrl: String?,
    val msrp: Double?,
    val upc: String?,
    val isCustom: Boolean,
)

@Entity(
    tableName = "sealed_inventory",
    foreignKeys = [
        ForeignKey(
            entity = SealedProductEntity::class,
            parentColumns = ["id"],
            childColumns = ["productId"],
            onDelete = ForeignKey.RESTRICT,
        ),
    ],
    indices = [Index("productId"), Index("createdAt")],
)
data class SealedInventoryEntity(
    @PrimaryKey val id: String,
    val productId: String,
    val quantity: Int,
    val purchasePrice: Double?,
    val purchaseDate: String?,
    val notes: String?,
    val createdAt: String,
)

data class SealedInventoryWithProduct(
    @Embedded val inventory: SealedInventoryEntity,
    @Relation(parentColumn = "productId", entityColumn = "id")
    val product: SealedProductEntity,
)

@Entity(
    tableName = "sealed_openings",
    foreignKeys = [
        ForeignKey(
            entity = SealedProductEntity::class,
            parentColumns = ["id"],
            childColumns = ["productId"],
            onDelete = ForeignKey.RESTRICT,
        ),
    ],
    indices = [Index("productId"), Index("openedAt")],
)
data class SealedOpeningEntity(
    @PrimaryKey val id: String,
    val inventoryId: String,
    val productId: String,
    val productName: String,
    val openedQuantity: Int,
    val openedAt: String,
    val notes: String?,
    val invested: Double,
    val linkedCollectionIds: String,
    val createdAt: String,
)
