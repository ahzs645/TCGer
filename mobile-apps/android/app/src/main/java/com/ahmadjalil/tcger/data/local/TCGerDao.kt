package com.ahmadjalil.tcger.data.local

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
interface TCGerDao {
    @Transaction
    @Query("SELECT * FROM binders ORDER BY updatedAt DESC")
    suspend fun getBinders(): List<BinderWithCards>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertBinder(binder: BinderEntity)

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

    @Transaction
    @Query("SELECT * FROM wishlists ORDER BY updatedAt DESC")
    suspend fun getWishlists(): List<WishlistWithCards>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertWishlist(wishlist: WishlistEntity)

    @Query("DELETE FROM wishlists WHERE id = :id")
    suspend fun deleteWishlist(id: String)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertWishlistCard(card: WishlistCardEntity)
}
