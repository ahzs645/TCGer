package com.ahmadjalil.tcger.features.social

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

interface SocialRepository {
    suspend fun getDecks(): List<Deck>
    suspend fun getDeck(id: String): Deck
    suspend fun createDeck(draft: DeckDraft): Deck
    suspend fun updateDeck(id: String, update: DeckUpdate): Deck
    suspend fun deleteDeck(id: String)
    suspend fun addDeckCard(deckId: String, card: DeckCardDraft): DeckCard
    suspend fun updateDeckCard(deckId: String, cardId: String, update: DeckCardUpdate): DeckCard
    suspend fun deleteDeckCard(deckId: String, cardId: String)
    suspend fun validateDeck(deckId: String, format: String?): DeckValidation
    suspend fun getDeckOwnership(deckId: String): DeckOwnership
    suspend fun exportDeckYdk(deckId: String): DeckYdkExport
    suspend fun importDeck(request: DeckImportRequest): DeckImportResult

    suspend fun getTrades(): List<Trade>
    suspend fun getTradeMatches(): List<TradeMatch>
    suspend fun createTrade(request: CreateTradeRequest): Trade
    suspend fun updateTradeStatus(tradeId: String, action: String): Trade
    suspend fun deleteTrade(tradeId: String)

    suspend fun getNotifications(): List<AppNotification>
    suspend fun markNotificationRead(id: String): AppNotification
    suspend fun markAllNotificationsRead()
}

private interface SocialApi {
    @GET("decks") suspend fun getDecks(@Header("Authorization") auth: String): List<Deck>
    @GET("decks/{id}") suspend fun getDeck(@Header("Authorization") auth: String, @Path("id") id: String): Deck
    @POST("decks") suspend fun createDeck(@Header("Authorization") auth: String, @Body request: DeckDraft): Deck
    @PATCH("decks/{id}") suspend fun updateDeck(@Header("Authorization") auth: String, @Path("id") id: String, @Body request: DeckUpdate): Deck
    @DELETE("decks/{id}") suspend fun deleteDeck(@Header("Authorization") auth: String, @Path("id") id: String): Response<Unit>
    @POST("decks/{id}/cards") suspend fun addDeckCard(@Header("Authorization") auth: String, @Path("id") id: String, @Body request: DeckCardDraft): DeckCard
    @PATCH("decks/{deckId}/cards/{cardId}") suspend fun updateDeckCard(@Header("Authorization") auth: String, @Path("deckId") deckId: String, @Path("cardId") cardId: String, @Body request: DeckCardUpdate): DeckCard
    @DELETE("decks/{deckId}/cards/{cardId}") suspend fun deleteDeckCard(@Header("Authorization") auth: String, @Path("deckId") deckId: String, @Path("cardId") cardId: String): Response<Unit>
    @POST("decks/{id}/validate") suspend fun validateDeck(@Header("Authorization") auth: String, @Path("id") id: String, @Body request: ValidateDeckRequest): DeckValidation
    @GET("decks/{id}/ownership") suspend fun getDeckOwnership(@Header("Authorization") auth: String, @Path("id") id: String): DeckOwnership
    @GET("decks/{id}/ydk") suspend fun exportDeckYdk(@Header("Authorization") auth: String, @Path("id") id: String): DeckYdkExport
    @POST("decks/import") suspend fun importDeck(@Header("Authorization") auth: String, @Body request: DeckImportRequest): DeckImportResult

    @GET("trades") suspend fun getTrades(@Header("Authorization") auth: String): List<Trade>
    @GET("trades/matches") suspend fun getTradeMatches(@Header("Authorization") auth: String): List<TradeMatch>
    @POST("trades") suspend fun createTrade(@Header("Authorization") auth: String, @Body request: CreateTradeRequest): Trade
    @PATCH("trades/{id}/{action}") suspend fun updateTradeStatus(@Header("Authorization") auth: String, @Path("id") id: String, @Path("action") action: String): Trade
    @DELETE("trades/{id}") suspend fun deleteTrade(@Header("Authorization") auth: String, @Path("id") id: String): Response<Unit>

    @GET("notifications") suspend fun getNotifications(@Header("Authorization") auth: String): List<AppNotification>
    @PATCH("notifications/{id}/read") suspend fun markNotificationRead(@Header("Authorization") auth: String, @Path("id") id: String): AppNotification
    @POST("notifications/read-all") suspend fun markAllNotificationsRead(@Header("Authorization") auth: String): Response<Unit>
}

class RemoteSocialRepository private constructor(
    private val api: SocialApi,
    private val authorization: String,
) : SocialRepository {
    companion object {
        fun create(serverUrl: String, authToken: String, client: OkHttpClient = OkHttpClient()): RemoteSocialRepository {
            val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
            val api = Retrofit.Builder()
                .baseUrl(normalizeServerUrl(serverUrl))
                .client(client)
                .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
                .build()
                .create(SocialApi::class.java)
            return RemoteSocialRepository(api, "Bearer $authToken")
        }
    }

    override suspend fun getDecks() = api.getDecks(authorization)
    override suspend fun getDeck(id: String) = api.getDeck(authorization, id)
    override suspend fun createDeck(draft: DeckDraft) = api.createDeck(authorization, draft.normalized())
    override suspend fun updateDeck(id: String, update: DeckUpdate) = api.updateDeck(authorization, id, update)
    override suspend fun deleteDeck(id: String) { api.deleteDeck(authorization, id).requireSuccess() }
    override suspend fun addDeckCard(deckId: String, card: DeckCardDraft) = api.addDeckCard(authorization, deckId, card.normalized())
    override suspend fun updateDeckCard(deckId: String, cardId: String, update: DeckCardUpdate) = api.updateDeckCard(authorization, deckId, cardId, update)
    override suspend fun deleteDeckCard(deckId: String, cardId: String) { api.deleteDeckCard(authorization, deckId, cardId).requireSuccess() }
    override suspend fun validateDeck(deckId: String, format: String?) = api.validateDeck(authorization, deckId, ValidateDeckRequest(format.clean()))
    override suspend fun getDeckOwnership(deckId: String) = api.getDeckOwnership(authorization, deckId)
    override suspend fun exportDeckYdk(deckId: String) = api.exportDeckYdk(authorization, deckId)
    override suspend fun importDeck(request: DeckImportRequest) = api.importDeck(authorization, request)
    override suspend fun getTrades() = api.getTrades(authorization)
    override suspend fun getTradeMatches() = api.getTradeMatches(authorization)
    override suspend fun createTrade(request: CreateTradeRequest) = api.createTrade(authorization, request)
    override suspend fun updateTradeStatus(tradeId: String, action: String) = api.updateTradeStatus(authorization, tradeId, action)
    override suspend fun deleteTrade(tradeId: String) { api.deleteTrade(authorization, tradeId).requireSuccess() }
    override suspend fun getNotifications() = api.getNotifications(authorization)
    override suspend fun markNotificationRead(id: String) = api.markNotificationRead(authorization, id)
    override suspend fun markAllNotificationsRead() { api.markAllNotificationsRead(authorization).requireSuccess() }
}

private fun Response<Unit>.requireSuccess() {
    if (!isSuccessful) error("Server request failed (${code()})")
}
