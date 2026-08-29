package com.ahmadjalil.tcger.data.local

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update

@Dao
interface TCGerDao {
    @Transaction
    @Query("SELECT * FROM binders ORDER BY updatedAt DESC")
    suspend fun getBinders(): List<BinderWithCards>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertBinder(binder: BinderEntity)

    @Update
    suspend fun updateBinder(binder: BinderEntity)

    @Query("SELECT * FROM binders WHERE id = :id LIMIT 1")
    suspend fun getBinder(id: String): BinderEntity?

    @Query("DELETE FROM binders WHERE id = :id")
    suspend fun deleteBinder(id: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertOwnedCard(card: OwnedCardEntity)

    @Query("SELECT * FROM owned_cards WHERE binderId = :binderId AND externalId = :externalId LIMIT 1")
    suspend fun findOwnedCard(binderId: String, externalId: String): OwnedCardEntity?

    @Query("DELETE FROM owned_cards WHERE id = :id AND binderId = :binderId")
    suspend fun deleteOwnedCard(binderId: String, id: String)

    @Query("SELECT * FROM owned_cards WHERE name LIKE '%' || :query || '%' ORDER BY name LIMIT 100")
    suspend fun searchOwnedCards(query: String): List<OwnedCardEntity>

    @Query("SELECT COALESCE(SUM(quantity), 0) FROM owned_cards WHERE externalId = :externalId")
    suspend fun ownedQuantity(externalId: String): Int

    @Query("SELECT COALESCE(SUM(quantity), 0) FROM owned_cards WHERE tcg = :tcg COLLATE NOCASE AND name = :name COLLATE NOCASE")
    suspend fun ownedQuantityForAnyPrinting(tcg: String, name: String): Int

    @Transaction
    @Query("SELECT * FROM wishlists ORDER BY updatedAt DESC")
    suspend fun getWishlists(): List<WishlistWithCards>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertWishlist(wishlist: WishlistEntity)

    @Query("SELECT * FROM wishlists WHERE id = :id LIMIT 1")
    suspend fun getWishlist(id: String): WishlistEntity?

    @Update
    suspend fun updateWishlist(wishlist: WishlistEntity)

    @Query("DELETE FROM wishlists WHERE id = :id")
    suspend fun deleteWishlist(id: String)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertWishlistCard(card: WishlistCardEntity)

    @Query("DELETE FROM wishlist_cards WHERE wishlistId = :wishlistId AND id = :cardId")
    suspend fun deleteWishlistCard(wishlistId: String, cardId: String)

    @Query("SELECT COUNT(*) FROM sealed_products")
    suspend fun sealedProductCount(): Int

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertSealedProducts(products: List<SealedProductEntity>)

    @Query("SELECT * FROM sealed_products WHERE (:tcg IS NULL OR tcg = :tcg) ORDER BY releaseDate DESC, name")
    suspend fun getSealedProducts(tcg: String? = null): List<SealedProductEntity>

    @Query("SELECT * FROM sealed_products WHERE upc IN (:barcodes) LIMIT 1")
    suspend fun getSealedProductByBarcodes(barcodes: List<String>): SealedProductEntity?

    @Transaction
    @Query("SELECT * FROM sealed_inventory ORDER BY createdAt DESC")
    suspend fun getSealedInventory(): List<SealedInventoryWithProduct>

    @Transaction
    @Query("SELECT * FROM sealed_inventory WHERE id = :id LIMIT 1")
    suspend fun getSealedInventoryItem(id: String): SealedInventoryWithProduct?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertSealedInventory(item: SealedInventoryEntity)

    @Query("DELETE FROM sealed_inventory WHERE id = :id")
    suspend fun deleteSealedInventory(id: String)

    @Query("SELECT * FROM sealed_openings ORDER BY openedAt DESC")
    suspend fun getSealedOpenings(): List<SealedOpeningEntity>

    @Insert
    suspend fun insertSealedOpening(opening: SealedOpeningEntity)

    @Transaction
    suspend fun recordSealedOpening(opening: SealedOpeningEntity) {
        val current = requireNotNull(getSealedInventoryItem(opening.inventoryId)) {
            "Sealed inventory item not found"
        }
        require(opening.openedQuantity in 1..current.inventory.quantity) {
            "Opening quantity exceeds the sealed inventory available"
        }
        upsertSealedInventory(
            current.inventory.copy(quantity = current.inventory.quantity - opening.openedQuantity),
        )
        insertSealedOpening(opening)
    }
}
