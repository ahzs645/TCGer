package com.ahmadjalil.tcger.feature.libraryoperations

import com.ahmadjalil.tcger.data.preferences.normalizeServerUrl
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface LibraryOperationsRepository {
    suspend fun getStorageContainers(): List<StorageContainer>
    suspend fun createStorageContainer(request: CreateStorageContainerRequest): StorageContainer
    suspend fun updateStorageContainer(containerId: String, request: UpdateStorageContainerRequest): StorageContainer
    suspend fun createStorageCompartment(request: CreateStorageCompartmentRequest): StorageCompartment
    suspend fun updateStorageCompartment(compartmentId: String, request: UpdateStorageCompartmentRequest): StorageCompartment
    suspend fun placeCollectionEntry(request: PlaceCollectionEntryRequest): StoragePlacement
    suspend fun removeStoragePlacement(placementId: String)
    suspend fun getDeckCheckout(deckId: String): DeckCheckoutSession?
    suspend fun checkoutDeck(deckId: String, note: String?): DeckCheckoutSession
    suspend fun checkinDeck(deckId: String): DeckCheckoutSession
    suspend fun resolveRapidCard(tcg: String, setCode: String, collectorNumber: String): RapidCardData
    suspend fun rapidSetEntry(request: RapidSetEntryRequest): RapidSetEntryReceipt
    suspend fun undoRapidSetEntry(auditId: String)
    suspend fun splitAcquisitionCost(request: AcquisitionCostSplitRequest): AcquisitionCostSplitReceipt
    suspend fun lookupPsaCertification(certificationNumber: String): PsaCertificationLookup
    suspend fun intakePsaCertification(request: PsaCertIntakeRequest): PsaIntakeResult
    suspend fun updatePrintedIdentity(binderId: String, entryId: String, request: PrintedIdentityUpdateRequest): PrintedIdentityResult
    suspend fun getTrackedPrice(tcg: String, externalId: String): TrackedPriceResult
}

private interface LibraryOperationsApi {
    @GET("storage/containers")
    suspend fun getStorageContainers(@Header("Authorization") auth: String): List<StorageContainer>

    @POST("storage/containers")
    suspend fun createStorageContainer(
        @Header("Authorization") auth: String,
        @Body request: CreateStorageContainerRequest,
    ): StorageContainer

    @PATCH("storage/containers/{containerId}")
    suspend fun updateStorageContainer(
        @Header("Authorization") auth: String,
        @Path("containerId") containerId: String,
        @Body request: UpdateStorageContainerRequest,
    ): StorageContainer

    @POST("storage/compartments")
    suspend fun createStorageCompartment(
        @Header("Authorization") auth: String,
        @Body request: CreateStorageCompartmentRequest,
    ): StorageCompartment

    @PATCH("storage/compartments/{compartmentId}")
    suspend fun updateStorageCompartment(
        @Header("Authorization") auth: String,
        @Path("compartmentId") compartmentId: String,
        @Body request: UpdateStorageCompartmentRequest,
    ): StorageCompartment

    @POST("storage/placements")
    suspend fun placeCollectionEntry(
        @Header("Authorization") auth: String,
        @Body request: PlaceCollectionEntryRequest,
    ): StoragePlacement

    @DELETE("storage/placements/{placementId}")
    suspend fun removeStoragePlacement(
        @Header("Authorization") auth: String,
        @Path("placementId") placementId: String,
    ): Response<Unit>

    @GET("decks/{deckId}/checkout")
    suspend fun getDeckCheckout(
        @Header("Authorization") auth: String,
        @Path("deckId") deckId: String,
    ): Response<DeckCheckoutSession>

    @POST("decks/{deckId}/checkout")
    suspend fun checkoutDeck(
        @Header("Authorization") auth: String,
        @Path("deckId") deckId: String,
        @Body request: DeckCheckoutRequest,
    ): DeckCheckoutSession

    @POST("decks/{deckId}/checkin")
    suspend fun checkinDeck(
        @Header("Authorization") auth: String,
        @Path("deckId") deckId: String,
    ): DeckCheckoutSession

    @POST("collections/rapid-entry")
    suspend fun rapidSetEntry(
        @Header("Authorization") auth: String,
        @Body request: RapidSetEntryRequest,
    ): RapidSetEntryReceipt

    @POST("collections/history/{auditId}/undo")
    suspend fun undoRapidSetEntry(
        @Header("Authorization") auth: String,
        @Path("auditId") auditId: String,
        @Body request: UndoCollectionMutationRequest,
    ): Response<Unit>

    @GET("cards/search")
    suspend fun searchCards(
        @Header("Authorization") auth: String,
        @Query("query") query: String,
        @Query("tcg") tcg: String,
    ): RapidCardSearchResponse

    @POST("finance/acquisition-cost-split")
    suspend fun splitAcquisitionCost(
        @Header("Authorization") auth: String,
        @Body request: AcquisitionCostSplitRequest,
    ): AcquisitionCostSplitReceipt

    @GET("grading/psa/certs/{certificationNumber}")
    suspend fun lookupPsaCertification(
        @Header("Authorization") auth: String,
        @Path("certificationNumber") certificationNumber: String,
    ): PsaCertificationLookup

    @PATCH("collections/{binderId}/cards/{entryId}")
    suspend fun intakePsaCertification(
        @Header("Authorization") auth: String,
        @Path("binderId") binderId: String,
        @Path("entryId") entryId: String,
        @Body request: PsaCertIntakeRequest,
    ): PsaIntakeResult

    @PATCH("collections/{binderId}/cards/{entryId}")
    suspend fun updatePrintedIdentity(
        @Header("Authorization") auth: String,
        @Path("binderId") binderId: String,
        @Path("entryId") entryId: String,
        @Body request: PrintedIdentityUpdateRequest,
    ): PrintedIdentityResult

    @POST("prices/tracked")
    suspend fun getTrackedPrices(
        @Header("Authorization") auth: String,
        @Body request: TrackedPriceRequest,
    ): TrackedPricesEnvelope
}

class RemoteLibraryOperationsRepository private constructor(
    private val api: LibraryOperationsApi,
    private val authorization: String,
) : LibraryOperationsRepository {
    companion object {
        fun create(
            serverUrl: String,
            authToken: String,
            client: OkHttpClient = OkHttpClient(),
        ): RemoteLibraryOperationsRepository {
            val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
            val api = Retrofit.Builder()
                .baseUrl(normalizeServerUrl(serverUrl))
                .client(client)
                .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
                .build()
                .create(LibraryOperationsApi::class.java)
            return RemoteLibraryOperationsRepository(api, "Bearer $authToken")
        }
    }

    override suspend fun getStorageContainers() = api.getStorageContainers(authorization)
    override suspend fun createStorageContainer(request: CreateStorageContainerRequest) =
        api.createStorageContainer(authorization, request)
    override suspend fun updateStorageContainer(containerId: String, request: UpdateStorageContainerRequest) =
        api.updateStorageContainer(authorization, containerId, request)
    override suspend fun createStorageCompartment(request: CreateStorageCompartmentRequest) =
        api.createStorageCompartment(authorization, request)
    override suspend fun updateStorageCompartment(compartmentId: String, request: UpdateStorageCompartmentRequest) =
        api.updateStorageCompartment(authorization, compartmentId, request)
    override suspend fun placeCollectionEntry(request: PlaceCollectionEntryRequest) =
        api.placeCollectionEntry(authorization, request)
    override suspend fun removeStoragePlacement(placementId: String) {
        api.removeStoragePlacement(authorization, placementId).requireSuccess()
    }
    override suspend fun getDeckCheckout(deckId: String): DeckCheckoutSession? {
        val response = api.getDeckCheckout(authorization, deckId)
        if (response.code() == 404) return null
        if (!response.isSuccessful) error("Server request failed (${response.code()})")
        return response.body()
    }
    override suspend fun checkoutDeck(deckId: String, note: String?) =
        api.checkoutDeck(authorization, deckId, DeckCheckoutRequest(note?.trim()?.ifBlank { null }))
    override suspend fun checkinDeck(deckId: String) = api.checkinDeck(authorization, deckId)
    override suspend fun resolveRapidCard(tcg: String, setCode: String, collectorNumber: String): RapidCardData {
        val response = api.searchCards(authorization, collectorNumber, tcg)
        return response.cards.firstOrNull {
            it.setCode.equals(setCode, ignoreCase = true) &&
                it.collectorNumber.equals(collectorNumber, ignoreCase = true)
        } ?: error("No exact card matched set $setCode collector number $collectorNumber")
    }
    override suspend fun rapidSetEntry(request: RapidSetEntryRequest) =
        api.rapidSetEntry(authorization, request)
    override suspend fun undoRapidSetEntry(auditId: String) {
        api.undoRapidSetEntry(
            authorization,
            auditId,
            UndoCollectionMutationRequest("android-rapid-undo-${java.util.UUID.randomUUID()}"),
        ).requireSuccess()
    }
    override suspend fun splitAcquisitionCost(request: AcquisitionCostSplitRequest) =
        api.splitAcquisitionCost(authorization, request)
    override suspend fun lookupPsaCertification(certificationNumber: String) =
        api.lookupPsaCertification(authorization, certificationNumber)
    override suspend fun intakePsaCertification(request: PsaCertIntakeRequest) =
        api.intakePsaCertification(authorization, request.binderId, request.entryId, request)
    override suspend fun updatePrintedIdentity(binderId: String, entryId: String, request: PrintedIdentityUpdateRequest) =
        api.updatePrintedIdentity(authorization, binderId, entryId, request)
    override suspend fun getTrackedPrice(tcg: String, externalId: String): TrackedPriceResult =
        api.getTrackedPrices(
            authorization,
            TrackedPriceRequest(listOf(TrackedPriceItem(tcg, externalId))),
        ).prices.firstOrNull() ?: error("Pricing provider returned no result")
}

private fun Response<Unit>.requireSuccess() {
    if (!isSuccessful) error("Server request failed (${code()})")
}
