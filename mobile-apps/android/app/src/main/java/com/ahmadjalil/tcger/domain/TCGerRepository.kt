package com.ahmadjalil.tcger.domain

interface TCGerRepository {
    suspend fun getBinders(): List<Binder>
    suspend fun createBinder(name: String, description: String? = null): Binder
    suspend fun deleteBinder(id: String)
    suspend fun searchCards(query: String, tcg: String? = null): List<CatalogCard>
    suspend fun scanCard(imageBytes: ByteArray, tcg: String, options: CardScanOptions = CardScanOptions()): CardScanResult
    suspend fun getScanDebugCaptures(limit: Int = 12): List<ScanDebugCapture>
    suspend fun updateScanDebugCapture(
        captureId: String,
        feedbackStatus: ScanDebugFeedbackStatus? = null,
        reviewTags: Set<ScanDebugReviewTag>? = null,
        notes: String? = null,
    ): ScanDebugCapture
    /** Returns the created collection-copy ID when the active data source exposes one. */
    suspend fun addCard(binderId: String, card: CatalogCard, quantity: Int = 1): String?
    suspend fun removeCard(binderId: String, ownedCardId: String)
    suspend fun getWishlists(): List<Wishlist>
    suspend fun createWishlist(name: String): Wishlist
    suspend fun deleteWishlist(id: String)
    suspend fun addWishlistCard(wishlistId: String, card: CatalogCard)
    suspend fun getSealedInventory(): List<SealedInventoryItem>
    suspend fun createSealedOpening(
        inventoryId: String,
        openedQuantity: Int,
        collectionIds: List<String>,
        openedAt: String? = null,
        notes: String? = null,
    ): SealedOpeningRecord
    suspend fun verifyServer(url: String): Result<Unit>
    suspend fun signIn(url: String, username: String, password: String): Result<SignInResult>
}
