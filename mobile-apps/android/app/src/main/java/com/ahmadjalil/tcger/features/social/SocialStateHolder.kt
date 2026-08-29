package com.ahmadjalil.tcger.features.social

import java.io.Closeable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SocialFeatureState(
    val connected: Boolean = false,
    val currentUserId: String? = null,
    val decks: List<Deck> = emptyList(),
    val selectedDeck: Deck? = null,
    val deckValidation: DeckValidation? = null,
    val deckOwnership: DeckOwnership? = null,
    val ydkExport: DeckYdkExport? = null,
    val trades: List<Trade> = emptyList(),
    val tradeMatches: List<TradeMatch> = emptyList(),
    val notifications: List<AppNotification> = emptyList(),
    val loadingDecks: Boolean = false,
    val loadingDeckDetail: Boolean = false,
    val loadingTrades: Boolean = false,
    val loadingMatches: Boolean = false,
    val loadingActivity: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
    val message: String? = null,
) {
    val unreadNotificationCount: Int get() = notifications.count { !it.read }
}

/**
 * Feature-local controller for Decks, Trades and Activity.
 *
 * Pass a null repository when the app is in on-device mode. Existing loaded data stays visible
 * during transient failures, mirroring the iOS screens, while first-load failures show an error.
 */
class SocialFeatureController(
    private val repository: SocialRepository?,
    currentUserId: String? = null,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
) : Closeable {
    private val mutableState = MutableStateFlow(
        SocialFeatureState(connected = repository != null, currentUserId = currentUserId),
    )
    val state: StateFlow<SocialFeatureState> = mutableState.asStateFlow()

    fun dismissNotice() = mutableState.update { it.copy(error = null, message = null) }

    fun loadDecks(): Job = launchConnected {
        mutableState.update { it.copy(loadingDecks = it.decks.isEmpty(), error = null) }
        runCatching { repository!!.getDecks() }
            .onSuccess { decks -> mutableState.update { it.copy(decks = decks, loadingDecks = false) } }
            .onFailure { fail(it, loadingDecks = false) }
    }

    fun loadDeck(id: String): Job = launchConnected {
        mutableState.update { it.copy(loadingDeckDetail = it.selectedDeck?.id != id, error = null) }
        runCatching { repository!!.getDeck(id) }
            .onSuccess { deck -> mutableState.update { it.copy(selectedDeck = deck, loadingDeckDetail = false) } }
            .onFailure { fail(it, loadingDeckDetail = false) }
    }

    fun createDeck(draft: DeckDraft, onDone: (Boolean) -> Unit = {}): Job = launchConnected(onDone) {
        val normalized = draft.normalized()
        if (!normalized.isValid) error("Deck name and game are required")
        busy { repository!!.createDeck(normalized) }.also { deck ->
            mutableState.update { it.copy(decks = listOf(deck) + it.decks.filterNot { old -> old.id == deck.id }) }
        }
    }

    fun updateDeck(deckId: String, update: DeckUpdate, onDone: (Boolean) -> Unit = {}): Job = launchConnected(onDone) {
        busy { repository!!.updateDeck(deckId, update) }.also(::replaceDeck)
    }

    fun deleteDeck(deckId: String, onDone: (Boolean) -> Unit = {}): Job = launchConnected(onDone) {
        busy { repository!!.deleteDeck(deckId) }
        mutableState.update {
            it.copy(
                decks = it.decks.filterNot { deck -> deck.id == deckId },
                selectedDeck = it.selectedDeck?.takeUnless { deck -> deck.id == deckId },
            )
        }
    }

    fun importDeck(request: DeckImportRequest, onDone: (DeckImportResult?) -> Unit = {}): Job = launchConnected {
        runCatching { busy { repository!!.importDeck(request) } }
            .onSuccess { result ->
                replaceDeck(result.deck)
                mutableState.update {
                    it.copy(message = "Imported ${result.importedCount} cards${if (result.skippedCount > 0) "; skipped ${result.skippedCount}" else ""}.")
                }
                onDone(result)
            }
            .onFailure { fail(it); onDone(null) }
    }

    fun addDeckCard(deckId: String, draft: DeckCardDraft, onDone: (Boolean) -> Unit = {}): Job = launchConnected(onDone) {
        val normalized = draft.normalized()
        if (!normalized.isValid) error("Card ID, game, name and quantity are required")
        busy { repository!!.addDeckCard(deckId, normalized) }
        refreshDeck(deckId)
    }

    fun updateDeckCard(deckId: String, cardId: String, update: DeckCardUpdate, onDone: (Boolean) -> Unit = {}): Job = launchConnected(onDone) {
        require(update.quantity > 0) { "Quantity must be at least 1" }
        busy { repository!!.updateDeckCard(deckId, cardId, update) }
        refreshDeck(deckId)
    }

    fun deleteDeckCard(deckId: String, cardId: String): Job = launchConnected {
        runCatching {
            busy { repository!!.deleteDeckCard(deckId, cardId) }
            refreshDeck(deckId)
        }.onFailure(::fail)
    }

    fun runDeckChecks(deckId: String, format: String?): Job = launchConnected {
        mutableState.update { it.copy(busy = true, error = null) }
        runCatching {
            val validation = repository!!.validateDeck(deckId, format)
            val ownership = repository.getDeckOwnership(deckId)
            validation to ownership
        }.onSuccess { (validation, ownership) ->
            mutableState.update { it.copy(deckValidation = validation, deckOwnership = ownership, busy = false) }
        }.onFailure { fail(it, busy = false) }
    }

    fun exportDeck(deckId: String): Job = launchConnected {
        runCatching { busy { repository!!.exportDeckYdk(deckId) } }
            .onSuccess { export -> mutableState.update { it.copy(ydkExport = export, message = "YDK export is ready to copy.") } }
            .onFailure(::fail)
    }

    fun loadTrades(): Job = launchConnected {
        mutableState.update { it.copy(loadingTrades = it.trades.isEmpty(), error = null) }
        runCatching { repository!!.getTrades() }
            .onSuccess { trades -> mutableState.update { it.copy(trades = trades, loadingTrades = false) } }
            .onFailure { fail(it, loadingTrades = false) }
    }

    fun loadTradeMatches(): Job = launchConnected {
        mutableState.update { it.copy(loadingMatches = true, error = null) }
        runCatching { repository!!.getTradeMatches() }
            .onSuccess { matches ->
                mutableState.update {
                    it.copy(
                        tradeMatches = matches,
                        loadingMatches = false,
                        message = if (matches.isEmpty()) "No suggested matches yet. Add wishlist and binder cards to improve matching." else null,
                    )
                }
            }
            .onFailure { fail(it, loadingMatches = false) }
    }

    fun proposeTrade(match: TradeMatch, message: String?, onDone: (Boolean) -> Unit = {}): Job = launchConnected(onDone) {
        require(match.youHave.isNotEmpty()) { "A trade must offer at least one card" }
        busy { repository!!.createTrade(match.toTradeRequest(message)) }.also(::replaceTrade)
        mutableState.update { it.copy(tradeMatches = emptyList()) }
    }

    fun updateTradeStatus(tradeId: String, action: String): Job = launchConnected {
        runCatching {
            require(action in setOf("accept", "decline", "cancel")) { "Unsupported trade action" }
            busy { repository!!.updateTradeStatus(tradeId, action) }.also(::replaceTrade)
        }.onFailure(::fail)
    }

    fun deleteTrade(tradeId: String): Job = launchConnected {
        runCatching {
            busy { repository!!.deleteTrade(tradeId) }
            mutableState.update { it.copy(trades = it.trades.filterNot { trade -> trade.id == tradeId }) }
        }.onFailure(::fail)
    }

    fun loadActivity(): Job = launchConnected {
        mutableState.update { it.copy(loadingActivity = it.notifications.isEmpty(), error = null) }
        runCatching { repository!!.getNotifications() }
            .onSuccess { notifications -> mutableState.update { it.copy(notifications = notifications, loadingActivity = false) } }
            .onFailure { fail(it, loadingActivity = false) }
    }

    fun markNotificationRead(id: String): Job = launchConnected {
        runCatching { repository!!.markNotificationRead(id) }
            .onSuccess { updated ->
                mutableState.update { state ->
                    state.copy(notifications = state.notifications.map { if (it.id == id) updated else it })
                }
            }
            .onFailure(::fail)
    }

    fun markAllNotificationsRead(): Job = launchConnected {
        runCatching {
            mutableState.update { it.copy(busy = true, error = null) }
            repository!!.markAllNotificationsRead()
            mutableState.update { state ->
                state.copy(notifications = state.notifications.map { it.copy(read = true) }, busy = false)
            }
        }.onFailure { fail(it, busy = false) }
    }

    override fun close() = scope.cancel()

    private fun launchConnected(onDone: ((Boolean) -> Unit)? = null, block: suspend () -> Unit): Job = scope.launch {
        if (repository == null) {
            mutableState.update { it.copy(error = "Connect and sign in to a TCGer server to use this feature.") }
            onDone?.invoke(false)
            return@launch
        }
        runCatching { block() }
            .onSuccess { onDone?.invoke(true) }
            .onFailure { fail(it); onDone?.invoke(false) }
    }

    private suspend fun refreshDeck(deckId: String) = replaceDeck(repository!!.getDeck(deckId))

    private fun replaceDeck(deck: Deck) = mutableState.update { state ->
        val decks = if (state.decks.any { it.id == deck.id }) {
            state.decks.map { if (it.id == deck.id) deck else it }
        } else listOf(deck) + state.decks
        state.copy(decks = decks, selectedDeck = deck, error = null)
    }

    private fun replaceTrade(trade: Trade) = mutableState.update { state ->
        val trades = if (state.trades.any { it.id == trade.id }) {
            state.trades.map { if (it.id == trade.id) trade else it }
        } else listOf(trade) + state.trades
        state.copy(trades = trades, error = null)
    }

    private suspend fun <T> busy(block: suspend () -> T): T {
        mutableState.update { it.copy(busy = true, error = null) }
        return try { block() } finally { mutableState.update { it.copy(busy = false) } }
    }

    private fun fail(
        throwable: Throwable,
        loadingDecks: Boolean? = null,
        loadingDeckDetail: Boolean? = null,
        loadingTrades: Boolean? = null,
        loadingMatches: Boolean? = null,
        loadingActivity: Boolean? = null,
        busy: Boolean? = null,
    ) = mutableState.update {
        it.copy(
            loadingDecks = loadingDecks ?: it.loadingDecks,
            loadingDeckDetail = loadingDeckDetail ?: it.loadingDeckDetail,
            loadingTrades = loadingTrades ?: it.loadingTrades,
            loadingMatches = loadingMatches ?: it.loadingMatches,
            loadingActivity = loadingActivity ?: it.loadingActivity,
            busy = busy ?: it.busy,
            error = throwable.message ?: "The server request failed.",
        )
    }
}
