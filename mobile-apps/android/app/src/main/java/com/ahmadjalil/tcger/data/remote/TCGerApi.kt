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
import okhttp3.MultipartBody
import okhttp3.RequestBody

interface TCGerApi {
    @GET("health") suspend fun health(): HealthDto
    @POST("auth/sign-in/username") suspend fun signIn(@Body request: SignInRequest): SignInResponse
    @GET("collections") suspend fun getBinders(@Header("Authorization") auth: String): List<BinderDto>
    @POST("collections") suspend fun createBinder(@Header("Authorization") auth: String, @Body request: CreateBinderRequest): BinderDto
    @DELETE("collections/{id}") suspend fun deleteBinder(@Header("Authorization") auth: String, @Path("id") id: String)
    @GET("cards/search") suspend fun searchCards(
        @Header("Authorization") auth: String,
        @Query("query") query: String,
        @Query("tcg") tcg: String? = null,
    ): CardSearchResponse
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
        @Body request: AddCardRequest,
    ): AddedCollectionCopyDto
    @DELETE("collections/{binderId}/cards/{cardId}") suspend fun removeCard(
        @Header("Authorization") auth: String,
        @Path("binderId") binderId: String,
        @Path("cardId") cardId: String,
    )
    @GET("wishlists") suspend fun getWishlists(@Header("Authorization") auth: String): List<WishlistDto>
    @POST("wishlists") suspend fun createWishlist(@Header("Authorization") auth: String, @Body request: CreateWishlistRequest): WishlistDto
    @DELETE("wishlists/{id}") suspend fun deleteWishlist(@Header("Authorization") auth: String, @Path("id") id: String)
    @POST("wishlists/{id}/cards") suspend fun addWishlistCard(
        @Header("Authorization") auth: String,
        @Path("id") id: String,
        @Body request: AddWishlistCardRequest,
    ): WishlistCardDto
    @GET("sealed/inventory")
    suspend fun getSealedInventory(@Header("Authorization") auth: String): List<SealedInventoryItemDto>
    @POST("sealed/inventory/{itemId}/open")
    suspend fun createSealedOpening(
        @Header("Authorization") auth: String,
        @Path("itemId") itemId: String,
        @Body request: CreateSealedOpeningRequest,
    ): SealedOpeningDto
}
