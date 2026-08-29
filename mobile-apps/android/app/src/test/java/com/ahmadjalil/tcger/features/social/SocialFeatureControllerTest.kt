package com.ahmadjalil.tcger.features.social

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SocialFeatureControllerTest {
    private val dispatcher = StandardTestDispatcher()
    private val scope = TestScope(dispatcher)
    private val repository = FakeSocialRepository()
    private val controller = SocialFeatureController(repository, "receiver", scope)

    @Test
    fun loadsAndMutatesDecks() = scope.runTest {
        repository.decks += deck("one", "First")
        controller.loadDecks()
        advanceUntilIdle()
        assertEquals(listOf("First"), controller.state.value.decks.map(Deck::name))

        controller.createDeck(DeckDraft(" New ", tcg = "pokemon"))
        advanceUntilIdle()
        assertEquals("New", controller.state.value.decks.first().name)

        val created = controller.state.value.decks.first()
        controller.addDeckCard(created.id, DeckCardDraft("base-1", "pokemon", "Pikachu", 2))
        advanceUntilIdle()
        assertEquals(2, controller.state.value.selectedDeck?.cardCount)

        controller.deleteDeck(created.id)
        advanceUntilIdle()
        assertFalse(controller.state.value.decks.any { it.id == created.id })
    }

    @Test
    fun tradeActionsReplaceTheLoadedTrade() = scope.runTest {
        repository.trades += trade("pending")
        controller.loadTrades()
        advanceUntilIdle()

        controller.updateTradeStatus("trade", "accept")
        advanceUntilIdle()

        assertEquals("accepted", controller.state.value.trades.single().status)
    }

    @Test
    fun activityReadActionsUpdateImmediatelyAfterServerSuccess() = scope.runTest {
        repository.notifications += notification("one", false)
        repository.notifications += notification("two", false)
        controller.loadActivity()
        advanceUntilIdle()
        assertEquals(2, controller.state.value.unreadNotificationCount)

        controller.markNotificationRead("one")
        advanceUntilIdle()
        assertEquals(1, controller.state.value.unreadNotificationCount)

        controller.markAllNotificationsRead()
        advanceUntilIdle()
        assertEquals(0, controller.state.value.unreadNotificationCount)
    }

    @Test
    fun disconnectedControllerReportsActionableMessage() = scope.runTest {
        val disconnected = SocialFeatureController(null, scope = this)
        disconnected.loadDecks()
        advanceUntilIdle()

        assertFalse(disconnected.state.value.connected)
        assertTrue(disconnected.state.value.error!!.contains("Connect and sign in"))
        assertNull(disconnected.state.value.selectedDeck)
    }

    private fun deck(id: String, name: String, cards: List<DeckCard> = emptyList()) = Deck(
        id = id,
        name = name,
        tcg = "pokemon",
        cards = cards,
        cardCount = cards.sumOf(DeckCard::quantity),
    )

    private fun trade(status: String) = Trade(
        id = "trade",
        senderId = "sender",
        receiverId = "receiver",
        status = status,
        createdAt = "2026-01-01T00:00:00Z",
        updatedAt = "2026-01-01T00:00:00Z",
    )

    private fun notification(id: String, read: Boolean) = AppNotification(
        id, "receiver", "trade", "Trade", "Update", read, createdAt = "2026-01-01T00:00:00Z",
    )

    private inner class FakeSocialRepository : SocialRepository {
        val decks = mutableListOf<Deck>()
        val trades = mutableListOf<Trade>()
        val notifications = mutableListOf<AppNotification>()
        private var nextId = 2

        override suspend fun getDecks() = decks.toList()
        override suspend fun getDeck(id: String) = decks.first { it.id == id }
        override suspend fun createDeck(draft: DeckDraft): Deck = deck((nextId++).toString(), draft.name).also { decks.add(0, it) }
        override suspend fun updateDeck(id: String, update: DeckUpdate): Deck = getDeck(id).copy(
            name = update.name ?: getDeck(id).name,
            description = update.description ?: getDeck(id).description,
            format = update.format ?: getDeck(id).format,
            colorHex = update.colorHex ?: getDeck(id).colorHex,
            isPublic = update.isPublic ?: getDeck(id).isPublic,
        ).also { replaceDeck(it) }
        override suspend fun deleteDeck(id: String) { decks.removeAll { it.id == id } }
        override suspend fun addDeckCard(deckId: String, card: DeckCardDraft): DeckCard {
            val added = DeckCard("card-${nextId++}", card.externalId, card.tcg, card.name, card.quantity, card.zone)
            val deck = getDeck(deckId)
            replaceDeck(deck.copy(cards = deck.cards + added, cardCount = deck.cardCount + card.quantity))
            return added
        }
        override suspend fun updateDeckCard(deckId: String, cardId: String, update: DeckCardUpdate): DeckCard {
            val deck = getDeck(deckId)
            val card = deck.cards.first { it.id == cardId }.copy(quantity = update.quantity, zone = update.zone)
            val cards = deck.cards.map { if (it.id == cardId) card else it }
            replaceDeck(deck.copy(cards = cards, cardCount = cards.sumOf(DeckCard::quantity)))
            return card
        }
        override suspend fun deleteDeckCard(deckId: String, cardId: String) {
            val deck = getDeck(deckId)
            val cards = deck.cards.filterNot { it.id == cardId }
            replaceDeck(deck.copy(cards = cards, cardCount = cards.sumOf(DeckCard::quantity)))
        }
        override suspend fun validateDeck(deckId: String, format: String?) = DeckValidation(true)
        override suspend fun getDeckOwnership(deckId: String) = DeckOwnership()
        override suspend fun exportDeckYdk(deckId: String) = DeckYdkExport("#main")
        override suspend fun importDeck(request: DeckImportRequest) = DeckImportResult(createDeck(DeckDraft(request.name ?: "Imported", tcg = request.tcg ?: "yugioh")), 0, 0)
        override suspend fun getTrades() = trades.toList()
        override suspend fun getTradeMatches() = emptyList<TradeMatch>()
        override suspend fun createTrade(request: CreateTradeRequest): Trade = trade("pending").copy(id = (nextId++).toString()).also { trades.add(0, it) }
        override suspend fun updateTradeStatus(tradeId: String, action: String): Trade {
            val status = mapOf("accept" to "accepted", "decline" to "declined", "cancel" to "cancelled").getValue(action)
            return trades.first { it.id == tradeId }.copy(status = status).also(::replaceTrade)
        }
        override suspend fun deleteTrade(tradeId: String) { trades.removeAll { it.id == tradeId } }
        override suspend fun getNotifications() = notifications.toList()
        override suspend fun markNotificationRead(id: String): AppNotification = notifications.first { it.id == id }.copy(read = true).also(::replaceNotification)
        override suspend fun markAllNotificationsRead() { notifications.indices.forEach { notifications[it] = notifications[it].copy(read = true) } }

        private fun replaceDeck(deck: Deck) { decks[decks.indexOfFirst { it.id == deck.id }] = deck }
        private fun replaceTrade(trade: Trade) { trades[trades.indexOfFirst { it.id == trade.id }] = trade }
        private fun replaceNotification(notification: AppNotification) { notifications[notifications.indexOfFirst { it.id == notification.id }] = notification }
    }
}
