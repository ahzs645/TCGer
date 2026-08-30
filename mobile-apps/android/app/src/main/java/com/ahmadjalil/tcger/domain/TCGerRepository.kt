package com.ahmadjalil.tcger.domain

interface TCGerRepository {
    suspend fun getBinders(): List<Binder>
    suspend fun createBinder(input: BinderInput): Binder
    suspend fun createBinder(name: String, description: String? = null): Binder =
        createBinder(BinderInput(name = name, description = description))
    suspend fun updateBinder(id: String, input: BinderInput): Binder
    suspend fun deleteBinder(id: String)
    suspend fun getBinderShareLinks(id: String): List<BinderShareLink>
    suspend fun createBinderShareLink(id: String, label: String): BinderShareLink
    suspend fun revokeBinderShareLink(id: String, linkId: String)
    suspend fun searchCards(query: String, tcg: String? = null): List<CatalogCard>
    suspend fun discoverCards(tcg: String? = null, count: Int = 6): List<CatalogCard>
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
    suspend fun createWishlist(input: WishlistInput): Wishlist
    suspend fun createWishlist(name: String): Wishlist = createWishlist(WishlistInput(name = name))
    suspend fun updateWishlist(id: String, input: WishlistInput): Wishlist
    suspend fun deleteWishlist(id: String)
    suspend fun addWishlistCard(
        wishlistId: String,
        card: CatalogCard,
        desiredQuantity: Int = 1,
        notes: String? = null,
    )
    suspend fun removeWishlistCard(wishlistId: String, wishlistCardId: String)
    suspend fun getSealedProducts(tcg: String? = null): List<SealedProduct>
    suspend fun getSealedProductByBarcode(barcode: String): SealedProduct
    suspend fun getSealedInventory(): List<SealedInventoryItem>
    suspend fun addSealedInventory(
        productId: String,
        quantity: Int = 1,
        purchasePrice: Double? = null,
        purchaseDate: String? = null,
        notes: String? = null,
    ): SealedInventoryItem
    suspend fun updateSealedInventory(
        itemId: String,
        quantity: Int,
        purchasePrice: Double?,
        purchaseDate: String?,
        notes: String?,
    ): SealedInventoryItem
    suspend fun deleteSealedInventory(itemId: String)
    suspend fun getSealedOpeningLedgers(): List<SealedOpeningLedger>
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
