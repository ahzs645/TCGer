package com.ahmadjalil.tcger.data.remote

import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Multipart
import retrofit2.http.Part
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import kotlinx.serialization.json.JsonObject
import okhttp3.MultipartBody
import okhttp3.RequestBody

interface TCGerApi {
    @GET("setup/setup-required") suspend fun setupStatus(): JsonObject
    @POST("setup/setup") suspend fun finishAdminSetup(@Header("Authorization") auth: String): JsonObject
    @GET("settings") suspend fun appSettings(): JsonObject

    @GET("backups") suspend fun exportBackup(@Header("Authorization") auth: String): JsonObject
    @POST("backups") suspend fun importBackup(@Header("Authorization") auth: String, @Body backup: JsonObject): JsonObject
    @POST("backups/recovery") suspend fun restoreBackup(@Header("Authorization") auth: String): JsonObject

    @GET("users/me") suspend fun profile(@Header("Authorization") auth: String?): kotlinx.serialization.json.JsonObject
    @PATCH("users/me") suspend fun updateProfile(@Header("Authorization") auth: String, @Body body: kotlinx.serialization.json.JsonObject): kotlinx.serialization.json.JsonObject
    @POST("users/me/change-password") suspend fun changePassword(@Header("Authorization") auth: String, @Body body: kotlinx.serialization.json.JsonObject): kotlinx.serialization.json.JsonObject
    @retrofit2.http.HTTP(method = "DELETE", path = "users/me", hasBody = true) suspend fun deleteAccount(@Header("Authorization") auth: String, @Body body: kotlinx.serialization.json.JsonObject): kotlinx.serialization.json.JsonObject
    @POST("auth/sign-up/email") suspend fun signUp(@Body body: kotlinx.serialization.json.JsonObject): SignInResponse
    @GET("users/me/preferences") suspend fun preferences(@Header("Authorization") auth: String): kotlinx.serialization.json.JsonObject
    @PATCH("users/me/preferences") suspend fun updatePreferences(@Header("Authorization") auth: String, @Body body: kotlinx.serialization.json.JsonObject): kotlinx.serialization.json.JsonObject
    @GET("health") suspend fun health(): HealthDto
    @POST("auth/sign-in/username") suspend fun signIn(@Body request: SignInRequest): SignInResponse
    @GET("collections") suspend fun getBinders(@Header("Authorization") auth: String?): List<BinderDto>
    @POST("collections") suspend fun createBinder(@Header("Authorization") auth: String, @Body request: CreateBinderRequest): BinderDto
    @PATCH("collections/{id}") suspend fun updateBinder(
        @Header("Authorization") auth: String,
        @Path("id") id: String,
        @Body request: JsonObject,
    ): BinderDto
    @DELETE("collections/{id}") suspend fun deleteBinder(@Header("Authorization") auth: String, @Path("id") id: String)
    @GET("collections/{id}/share-links") suspend fun getBinderShareLinks(
        @Header("Authorization") auth: String,
        @Path("id") id: String,
    ): List<BinderShareLinkDto>
    @POST("collections/{id}/share-links") suspend fun createBinderShareLink(
        @Header("Authorization") auth: String,
        @Path("id") id: String,
        @Body request: CreateBinderShareLinkRequest,
    ): BinderShareLinkDto
    @DELETE("collections/{id}/share-links/{linkId}") suspend fun revokeBinderShareLink(
        @Header("Authorization") auth: String,
        @Path("id") id: String,
        @Path("linkId") linkId: String,
    )
    @GET("cards/search/all?unique=prints&limit=1000") suspend fun searchCards(
        @Header("Authorization") auth: String,
        @Query("query") query: String,
        @Query("tcg") tcg: String? = null,
    ): CardSearchResponse
    @GET("cards/{tcg}/{id}/prints") suspend fun cardPrints(
        @Header("Authorization") auth: String,
        @Path("tcg") tcg: String,
        @Path("id") id: String,
    ): CardPrintsDto
    @GET("cards/discover") suspend fun discoverCards(
        @Header("Authorization") auth: String,
        @Query("tcg") tcg: String? = null,
        @Query("count") count: Int = 6,
    ): CardDiscoveryResponse
    @Multipart
    @POST("cards/scan")
    suspend fun scanCard(
        @Header("Authorization") auth: String,
        @Query("tcg") tcg: String,
        @Part image: MultipartBody.Part,
        @Part("scanEngine") scanEngine: RequestBody,
        @Part("captureSource") captureSource: RequestBody,
        @Part("saveDebugCapture") saveDebugCapture: RequestBody,
        @Part("captureNotes") captureNotes: RequestBody,
        @Part("setCodeHint") setCodeHint: RequestBody,
    ): ScanCardResponseDto
    @GET("cards/scan/debug-captures")
    suspend fun getScanDebugCaptures(
        @Header("Authorization") auth: String,
        @Query("limit") limit: Int = 12,
    ): ScanDebugCaptureListDto
    @PATCH("cards/scan/debug-captures/{captureId}")
    suspend fun updateScanDebugCapture(
        @Header("Authorization") auth: String,
        @Path("captureId") captureId: String,
        @Body request: UpdateScanDebugCaptureRequest,
    ): ScanDebugCaptureEnvelopeDto
    @POST("collections/{id}/cards") suspend fun addCard(
        @Header("Authorization") auth: String,
        @Path("id") binderId: String,
        @Body request: kotlinx.serialization.json.JsonObject,
    ): AddedCollectionCopyDto
    @PATCH("collections/{binderId}/cards/{cardId}") suspend fun updateCard(
        @Header("Authorization") auth: String,
        @Path("binderId") binderId: String,
        @Path("cardId") cardId: String,
        @Body request: kotlinx.serialization.json.JsonObject,
    ): CollectionCardDto
    @DELETE("collections/{binderId}/cards/{cardId}") suspend fun removeCard(
        @Header("Authorization") auth: String,
        @Path("binderId") binderId: String,
        @Path("cardId") cardId: String,
    )
    @POST("wishlists/{id}/rules") suspend fun addWishlistRule(@Header("Authorization") auth: String, @Path("id") id: String, @Body rule: com.ahmadjalil.tcger.domain.WishlistRule): com.ahmadjalil.tcger.domain.WishlistRule
    @PATCH("wishlists/{id}/rules/{ruleId}") suspend fun updateWishlistRule(@Header("Authorization") auth: String, @Path("id") id: String, @Path("ruleId") ruleId: String, @Body rule: com.ahmadjalil.tcger.domain.WishlistRule): com.ahmadjalil.tcger.domain.WishlistRule
    @DELETE("wishlists/{id}/rules/{ruleId}") suspend fun deleteWishlistRule(@Header("Authorization") auth: String, @Path("id") id: String, @Path("ruleId") ruleId: String)
    @GET suspend fun ruleCards(@Header("Authorization") auth: String, @retrofit2.http.Url url: String): CardSearchResponse
    @GET("wishlists") suspend fun getWishlists(@Header("Authorization") auth: String): List<WishlistDto>
    @POST("wishlists") suspend fun createWishlist(@Header("Authorization") auth: String, @Body request: WishlistRequest): WishlistDto
    @PATCH("wishlists/{id}") suspend fun updateWishlist(
        @Header("Authorization") auth: String,
        @Path("id") id: String,
        @Body request: WishlistRequest,
    ): WishlistDto
    @DELETE("wishlists/{id}") suspend fun deleteWishlist(@Header("Authorization") auth: String, @Path("id") id: String)
    @POST("wishlists/{id}/cards") suspend fun addWishlistCard(
        @Header("Authorization") auth: String,
        @Path("id") id: String,
        @Body request: AddWishlistCardRequest,
    ): WishlistCardDto
    @DELETE("wishlists/{id}/cards/{cardId}") suspend fun removeWishlistCard(
        @Header("Authorization") auth: String,
        @Path("id") id: String,
        @Path("cardId") cardId: String,
    )
    @GET("sealed/inventory")
    suspend fun getSealedInventory(@Header("Authorization") auth: String): List<SealedInventoryItemDto>
    @GET("sealed/products")
    suspend fun getSealedProducts(
        @Header("Authorization") auth: String,
        @Query("tcg") tcg: String? = null,
    ): List<SealedProductDto>
    @GET("sealed/products/barcode/{barcode}")
    suspend fun getSealedProductByBarcode(
        @Header("Authorization") auth: String,
        @Path("barcode") barcode: String,
    ): SealedProductDto
    @POST("sealed/inventory")
    suspend fun addSealedInventory(
        @Header("Authorization") auth: String,
        @Body request: AddSealedInventoryRequest,
    ): SealedInventoryItemDto
    @PATCH("sealed/inventory/{itemId}")
    suspend fun updateSealedInventory(
        @Header("Authorization") auth: String,
        @Path("itemId") itemId: String,
        @Body request: JsonObject,
    ): SealedInventoryItemDto
    @DELETE("sealed/inventory/{itemId}")
    suspend fun deleteSealedInventory(
        @Header("Authorization") auth: String,
        @Path("itemId") itemId: String,
    )
    @GET("sealed/openings")
    suspend fun getSealedOpeningLedgers(@Header("Authorization") auth: String): List<SealedOpeningLedgerDto>
    @POST("sealed/inventory/{itemId}/open")
    suspend fun createSealedOpening(
        @Header("Authorization") auth: String,
        @Path("itemId") itemId: String,
        @Body request: CreateSealedOpeningRequest,
    ): SealedOpeningDto
}
