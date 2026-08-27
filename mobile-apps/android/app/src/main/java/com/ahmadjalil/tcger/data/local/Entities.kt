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
