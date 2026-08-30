package com.ahmadjalil.tcger.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.ahmadjalil.tcger.AppContainer
import com.ahmadjalil.tcger.data.backup.CollectionBackupJson
import com.ahmadjalil.tcger.data.backup.toCatalogCard
import com.ahmadjalil.tcger.domain.AccentChoice
import com.ahmadjalil.tcger.domain.AppPreferences
import com.ahmadjalil.tcger.domain.Binder
import com.ahmadjalil.tcger.domain.BinderInput
import com.ahmadjalil.tcger.domain.BinderShareLink
import com.ahmadjalil.tcger.domain.BottomNavigationItem
import com.ahmadjalil.tcger.domain.CardScanCandidate
import com.ahmadjalil.tcger.domain.CardScanEngine
import com.ahmadjalil.tcger.domain.CardScanEncoderVariant
import com.ahmadjalil.tcger.domain.CardScanOptions
import com.ahmadjalil.tcger.domain.CardScanResult
import com.ahmadjalil.tcger.domain.CardScanSource
import com.ahmadjalil.tcger.domain.CatalogCard
import com.ahmadjalil.tcger.domain.DataSourceMode
import com.ahmadjalil.tcger.domain.TCGerRepository
import com.ahmadjalil.tcger.domain.ThemeMode
import com.ahmadjalil.tcger.domain.ScanDebugCapture
import com.ahmadjalil.tcger.domain.ScanDebugFeedbackStatus
import com.ahmadjalil.tcger.domain.ScanDebugReviewTag
import com.ahmadjalil.tcger.domain.SealedInventoryItem
import com.ahmadjalil.tcger.domain.SealedOpeningLedger
import com.ahmadjalil.tcger.domain.SealedProduct
import com.ahmadjalil.tcger.domain.Wishlist
import com.ahmadjalil.tcger.domain.WishlistInput
import com.ahmadjalil.tcger.domain.gameDisableBlockReason
import com.ahmadjalil.tcger.data.scanner.AndroidScannerRequest
import com.ahmadjalil.tcger.data.gamepackage.GamePackageState
import com.ahmadjalil.tcger.data.scanner.ScannerRecognitionEngine
import com.ahmadjalil.tcger.data.scanner.ScannerEncoderVariant
import com.ahmadjalil.tcger.data.scanner.model.ScannerAssetInstallStatus
import com.ahmadjalil.tcger.data.scanner.model.ScannerAssetManifest
import com.ahmadjalil.tcger.data.scanner.model.ScannerAssetStore
import com.ahmadjalil.tcger.ui.packopening.PackOpeningPull
import com.ahmadjalil.tcger.ui.packopening.PackOpeningPullSession
import com.ahmadjalil.tcger.ui.packopening.PackOpeningSaveCheckpoint
import com.ahmadjalil.tcger.ui.packopening.PackOpeningSaveOutcome
import com.ahmadjalil.tcger.ui.packopening.toCatalogCard
import com.ahmadjalil.tcger.domain.dashboardStats
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID

data class AppUiState(
    val preferences: AppPreferences = AppPreferences(),
    val binders: List<Binder> = emptyList(),
    val wishlists: List<Wishlist> = emptyList(),
    val sealedInventory: List<SealedInventoryItem> = emptyList(),
    val sealedProducts: List<SealedProduct> = emptyList(),
    val sealedOpeningLedgers: List<SealedOpeningLedger> = emptyList(),
    val isLoadingSealed: Boolean = false,
    val sealedInventoryError: String? = null,
    val searchQuery: String = "",
    val searchGame: String? = null,
    val searchResults: List<CatalogCard> = emptyList(),
    val isLoading: Boolean = true,
    val isSearching: Boolean = false,
    val isScanning: Boolean = false,
    val scanResult: CardScanResult? = null,
    val scanDebugCaptures: List<ScanDebugCapture> = emptyList(),
    val isLoadingScanDebugCaptures: Boolean = false,
    val scannerAssets: Map<String, ScannerAssetInstallStatus> = emptyMap(),
    val scannerAssetManifests: Map<String, ScannerAssetManifest> = emptyMap(),
    val scannerSupportedGames: List<String> = ScannerAssetStore.supportedDownloadGames,
    val gamePackages: GamePackageState = GamePackageState(),
    val message: String? = null,
) {
    val stats get() = binders.dashboardStats()
}

class AppViewModel(private val container: AppContainer) : ViewModel() {
    private val repository: TCGerRepository = container.repository
    private val _state = MutableStateFlow(AppUiState())
    val state: StateFlow<AppUiState> = _state.asStateFlow()
    private var searchJob: Job? = null

    init {
        viewModelScope.launch {
            container.gamePackages.state.collectLatest { packages ->
                _state.update { it.copy(gamePackages = packages) }
            }
        }
        viewModelScope.launch {
            container.scannerAssets.statuses.collectLatest { scannerAssets ->
                _state.update { it.copy(scannerAssets = scannerAssets) }
            }
        }
        viewModelScope.launch {
            container.scannerAssets.remoteManifests.collectLatest { manifests ->
                _state.update { it.copy(scannerAssetManifests = manifests) }
            }
        }
        viewModelScope.launch {
            container.preferences.preferences.collectLatest { preferences ->
                _state.update { it.copy(preferences = preferences) }
                if (preferences.dataSourceMode == DataSourceMode.ON_DEVICE || preferences.isSignedIn) refresh()
                else _state.update {
                    it.copy(
                        isLoading = false,
                        binders = emptyList(),
                        wishlists = emptyList(),
                        sealedInventory = emptyList(),
                        sealedInventoryError = null,
                    )
                }
            }
        }
    }

    fun refresh() = viewModelScope.launch {
        _state.update { it.copy(isLoading = true, message = null) }
        runCatching {
            Triple(
                repository.getBinders(),
                repository.getWishlists(),
                runCatching { repository.getSealedInventory() },
            )
        }.onSuccess { (binders, wishlists, sealedInventoryResult) ->
            _state.update {
                it.copy(
                    isLoading = false,
                    binders = binders,
                    wishlists = wishlists,
                    sealedInventory = sealedInventoryResult.getOrDefault(emptyList()),
                    sealedInventoryError = sealedInventoryResult.exceptionOrNull()?.message,
                )
            }
        }.onFailure(::showError)
    }

    fun createBinder(input: BinderInput) = launchMutation {
        if (input.name.isBlank()) return@launchMutation
        repository.createBinder(input)
    }

    fun updateBinder(id: String, input: BinderInput) = launchMutation {
        if (input.name.isBlank()) return@launchMutation
        repository.updateBinder(id, input)
    }

    fun deleteBinder(id: String) = launchMutation { repository.deleteBinder(id) }

    suspend fun getBinderShareLinks(id: String): List<BinderShareLink> =
        repository.getBinderShareLinks(id)

    suspend fun createBinderShareLink(id: String, label: String): BinderShareLink =
        repository.createBinderShareLink(id, label)

    suspend fun revokeBinderShareLink(id: String, linkId: String) =
        repository.revokeBinderShareLink(id, linkId)

    fun createWishlist(input: WishlistInput) = launchMutation {
        if (input.name.isBlank()) return@launchMutation
        repository.createWishlist(input)
    }

    fun updateWishlist(id: String, input: WishlistInput) = launchMutation {
        if (input.name.isBlank()) return@launchMutation
        repository.updateWishlist(id, input)
    }

    fun deleteWishlist(id: String) = launchMutation { repository.deleteWishlist(id) }

    fun discoverCards() {
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            _state.update { it.copy(isSearching = true, message = null) }
            runCatching { repository.discoverCards(_state.value.searchGame, 6) }
                .onSuccess { cards ->
                    _state.update { it.copy(isSearching = false, searchResults = cards) }
                }
                .onFailure(::showError)
        }
    }
    fun removeWishlistCard(wishlistId: String, cardId: String) = launchMutation {
        repository.removeWishlistCard(wishlistId, cardId)
    }

    fun importPortableBackup(raw: String) = viewModelScope.launch {
        _state.update { it.copy(isLoading = true, message = null) }
        runCatching {
            val backup = CollectionBackupJson.decode(raw)
            backup.binders.forEach { portable ->
                val binder = repository.createBinder(portable.input())
                portable.cards.forEach { owned ->
                    repository.addCard(binder.id, owned.card.toCatalogCard(), owned.quantity)
                }
            }
            backup.wishlists.forEach { portable ->
                val wishlist = repository.createWishlist(portable.input())
                portable.cards.forEach { wanted ->
                    repository.addWishlistCard(
                        wishlist.id,
                        wanted.card.toCatalogCard(),
                        wanted.desiredQuantity,
                        wanted.notes,
                    )
                }
            }
            val sealedFailures = backup.sealedInventory.count { sealed ->
                runCatching {
                    repository.addSealedInventory(
                        sealed.productId,
                        sealed.quantity,
                        sealed.purchasePrice,
                        sealed.purchaseDate,
                        sealed.notes,
                    )
                }.isFailure
            }
            backup to sealedFailures
        }.onSuccess { (backup, sealedFailures) ->
            refresh()
            _state.update {
                it.copy(
                    message = buildString {
                        append("Imported ${backup.binders.size} binders and ${backup.wishlists.size} wishlists.")
                        if (sealedFailures > 0) append(" $sealedFailures sealed items could not be matched to the current catalog.")
                    },
                )
            }
        }.onFailure(::showError)
    }

    fun loadSealedData() = viewModelScope.launch {
        _state.update { it.copy(isLoadingSealed = true, sealedInventoryError = null) }
        runCatching {
            Triple(
                repository.getSealedProducts(),
                repository.getSealedInventory(),
                runCatching { repository.getSealedOpeningLedgers() },
            )
        }.onSuccess { (products, inventory, ledgersResult) ->
            _state.update {
                it.copy(
                    isLoadingSealed = false,
                    sealedProducts = products,
                    sealedInventory = inventory,
                    sealedOpeningLedgers = ledgersResult.getOrDefault(emptyList()),
                )
            }
        }.onFailure { error ->
            _state.update {
                it.copy(
                    isLoadingSealed = false,
                    sealedInventoryError = error.message ?: "Sealed inventory could not be loaded",
                )
            }
        }
    }

    fun addSealedInventory(
        productId: String,
        quantity: Int,
        purchasePrice: Double?,
        notes: String? = null,
        done: (Boolean) -> Unit = {},
    ) = sealedMutation(done) {
        repository.addSealedInventory(productId, quantity, purchasePrice, notes = notes)
    }

    fun updateSealedInventory(
        itemId: String,
        quantity: Int,
        purchasePrice: Double?,
        purchaseDate: String?,
        notes: String?,
        done: (Boolean) -> Unit = {},
    ) = sealedMutation(done) {
        repository.updateSealedInventory(itemId, quantity, purchasePrice, purchaseDate, notes)
    }

    fun deleteSealedInventory(itemId: String, done: (Boolean) -> Unit = {}) = sealedMutation(done) {
        repository.deleteSealedInventory(itemId)
    }

    fun recordSealedOpening(
        inventoryId: String,
        quantity: Int,
        collectionIds: List<String>,
        notes: String?,
        done: (Boolean) -> Unit = {},
    ) = sealedMutation(done) {
        repository.createSealedOpening(inventoryId, quantity, collectionIds, notes = notes)
    }

    fun findSealedProductByBarcode(barcode: String, done: (Result<SealedProduct>) -> Unit) = viewModelScope.launch {
        val result = runCatching { repository.getSealedProductByBarcode(barcode) }
        result.exceptionOrNull()?.let(::showError)
        done(result)
    }

    fun setSearchQuery(query: String) {
        _state.update { it.copy(searchQuery = query) }
        runSearchDebounced()
    }

    fun setSearchGame(game: String?) {
        _state.update { it.copy(searchGame = game) }
        runSearchDebounced()
    }

    private fun runSearchDebounced() {
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(250)
            val snapshot = _state.value
            if (snapshot.searchQuery.trim().length < 2) {
                _state.update { it.copy(searchResults = emptyList(), isSearching = false) }
                return@launch
            }
            _state.update { it.copy(isSearching = true) }
            runCatching { repository.searchCards(snapshot.searchQuery, snapshot.searchGame) }
                .onSuccess { results -> _state.update { it.copy(searchResults = results, isSearching = false) } }
                .onFailure(::showError)
        }
    }

    fun manualCard(): CatalogCard? {
        val snapshot = _state.value
        val name = snapshot.searchQuery.trim()
        if (name.isBlank()) return null
        return CatalogCard(
            id = "manual-${UUID.randomUUID()}",
            name = name,
            tcg = snapshot.searchGame ?: snapshot.preferences.enabledGames.firstOrNull() ?: "pokemon",
        )
    }

    fun addCard(binderId: String, card: CatalogCard) = launchMutation { repository.addCard(binderId, card) }
    fun addCardsToBinder(binderId: String, cards: List<CatalogCard>) = launchMutation {
        cards.groupingBy(CatalogCard::id).eachCount().forEach { (cardId, quantity) ->
            cards.firstOrNull { it.id == cardId }?.let { repository.addCard(binderId, it, quantity) }
        }
    }
    fun removeCard(binderId: String, cardId: String) = launchMutation { repository.removeCard(binderId, cardId) }
    fun addWishlistCard(wishlistId: String, card: CatalogCard) = launchMutation { repository.addWishlistCard(wishlistId, card) }

    fun createWishlistWithCards(name: String, cards: List<CatalogCard>) = launchMutation {
        if (name.isBlank()) return@launchMutation
        val wishlist = repository.createWishlist(
            WishlistInput(name = name, description = "Created from an Android set or collection guide"),
        )
        cards.distinctBy(CatalogCard::id).forEach { repository.addWishlistCard(wishlist.id, it) }
    }

    suspend fun createGuideWishlist(name: String, cards: List<CatalogCard>): String {
        val wishlist = repository.createWishlist(
            WishlistInput(name = name, description = "Created from a collection guide"),
        )
        cards.distinctBy(CatalogCard::id).forEach { repository.addWishlistCard(wishlist.id, it) }
        refresh()
        return wishlist.id
    }

    fun favoritePackPull(pull: PackOpeningPull) = viewModelScope.launch {
        runCatching {
            val favorites = _state.value.binders.firstOrNull { it.name.equals("Favorites", ignoreCase = true) }
                ?: repository.createBinder("Favorites", "Favorite cards")
            repository.addCard(favorites.id, pull.toCatalogCard(), quantity = 1)
            repository.getBinders()
        }.onSuccess { binders ->
            _state.update { it.copy(binders = binders, message = "Added ${pull.name} to Favorites.") }
        }.onFailure(::showError)
    }

    fun scanCard(imageBytes: ByteArray, tcg: String) = viewModelScope.launch {
        scanCardInternal(imageBytes, tcg, CardScanOptions())
    }

    fun scanCard(request: AndroidScannerRequest) = viewModelScope.launch {
        scanCardInternal(
            request.imageBytes,
            request.game,
            request.toDomainScanOptions(),
        )
    }

    fun scanCardForGuidedCapture(
        request: AndroidScannerRequest,
        done: (Result<CardScanResult>) -> Unit,
    ) = viewModelScope.launch {
        done(runCatching { repository.scanCard(request.imageBytes, request.game, request.toDomainScanOptions()) })
    }

    fun scanCards(requests: List<AndroidScannerRequest>) = viewModelScope.launch {
        if (requests.isEmpty()) return@launch
        _state.update { it.copy(isScanning = true, scanResult = null, message = null) }
        val results = mutableListOf<CardScanResult>()
        runCatching {
            requests.forEach { request ->
                results += repository.scanCard(
                    request.imageBytes,
                    request.game,
                    request.toDomainScanOptions(),
                )
            }
            CardScanResult(
                candidates = results.flatMap(CardScanResult::candidates).distinctBy { it.card.id },
                source = results.lastOrNull()?.source ?: CardScanSource.ON_DEVICE_TEXT,
                recognizedText = results.mapNotNull(CardScanResult::recognizedText).joinToString("\n").ifBlank { null },
                engine = results.mapNotNull(CardScanResult::engine).distinct().joinToString(" + ").ifBlank { null },
                elapsedMs = results.mapNotNull(CardScanResult::elapsedMs).sum().takeIf { it > 0.0 },
                debugCaptureId = results.mapNotNull(CardScanResult::debugCaptureId).lastOrNull(),
                debugCaptureError = results.mapNotNull(CardScanResult::debugCaptureError).joinToString("; ").ifBlank { null },
            )
        }.onSuccess { result -> _state.update { it.copy(isScanning = false, scanResult = result) } }
            .onFailure(::showError)
    }

    private suspend fun scanCardInternal(imageBytes: ByteArray, tcg: String, options: CardScanOptions) {
        _state.update { it.copy(isScanning = true, scanResult = null, message = null) }
        runCatching { repository.scanCard(imageBytes, tcg, options) }
            .onSuccess { result -> _state.update { it.copy(isScanning = false, scanResult = result) } }
            .onFailure(::showError)
    }

    fun resetScanner() = _state.update { it.copy(isScanning = false, scanResult = null) }

    fun loadScanDebugCaptures() = viewModelScope.launch {
        _state.update { it.copy(isLoadingScanDebugCaptures = true, message = null) }
        runCatching { repository.getScanDebugCaptures() }
            .onSuccess { captures ->
                _state.update { it.copy(scanDebugCaptures = captures, isLoadingScanDebugCaptures = false) }
            }
            .onFailure { error ->
                _state.update { it.copy(isLoadingScanDebugCaptures = false) }
                showError(error)
            }
    }

    fun updateScanDebugCapture(
        captureId: String,
        status: ScanDebugFeedbackStatus? = null,
        tags: Set<ScanDebugReviewTag>? = null,
        notes: String? = null,
    ) = viewModelScope.launch {
        runCatching { repository.updateScanDebugCapture(captureId, status, tags, notes) }
            .onSuccess { updated ->
                _state.update { current ->
                    current.copy(scanDebugCaptures = current.scanDebugCaptures.map {
                        if (it.id == updated.id) updated else it
                    })
                }
            }
            .onFailure(::showError)
    }

    fun savePackPulls(
        binderId: String,
        session: PackOpeningPullSession,
        sealedInventoryId: String? = null,
        checkpoint: PackOpeningSaveCheckpoint = PackOpeningSaveCheckpoint(),
        done: (PackOpeningSaveOutcome) -> Unit,
    ) = viewModelScope.launch {
        var current = checkpoint.copy(savedPullCount = checkpoint.savedPullCount.coerceIn(0, session.pulls.size))
        val collectionIdsBeforeSave = _state.value.binders
            .firstOrNull { it.id == binderId }
            ?.cards
            ?.map { it.id }
            .orEmpty()
            .toSet()
        runCatching {
            session.pulls.drop(current.savedPullCount).forEach { pull ->
                val copyId = repository.addCard(binderId, pull.toCatalogCard(), quantity = 1)
                current = current.copy(
                    savedPullCount = current.savedPullCount + 1,
                    collectionCopyIds = current.collectionCopyIds + listOfNotNull(copyId),
                )
            }

            val opening = sealedInventoryId?.let { inventoryId ->
                if (current.collectionCopyIds.size < session.pulls.size) {
                    val inferredIds = repository.getBinders()
                        .firstOrNull { it.id == binderId }
                        ?.cards
                        .orEmpty()
                        .map { it.id }
                        .filterNot { it in collectionIdsBeforeSave || it in current.collectionCopyIds }
                    current = current.copy(
                        collectionCopyIds = (current.collectionCopyIds + inferredIds)
                            .distinct()
                            .take(session.pulls.size),
                    )
                }
                check(current.collectionCopyIds.size == session.pulls.size) {
                    "The server saved the cards but did not return every collection-copy ID needed for the sealed ledger."
                }
                repository.createSealedOpening(
                    inventoryId = inventoryId,
                    openedQuantity = session.packs.size,
                    collectionIds = current.collectionCopyIds,
                    openedAt = session.openedAt,
                    notes = "Opened from ${session.packLabel} via Pack Opening",
                )
            }
            PackOpeningSaveOutcome(current, completed = true, sealedOpening = opening)
        }.onSuccess { outcome ->
            refresh()
            done(outcome)
        }.onFailure { error ->
            showError(error)
            done(PackOpeningSaveOutcome(current, completed = false, error = error))
        }
    }

    fun useScannerTestCard() {
        _state.update {
            it.copy(
                isScanning = false,
                scanResult = CardScanResult(
                    candidates = listOf(
                        CardScanCandidate(CatalogCard("parity-pikachu", "Pikachu", "pokemon", setName = "Scanner fixture")),
                    ),
                    source = CardScanSource.ON_DEVICE_TEXT,
                    recognizedText = "Pikachu",
                ),
            )
        }
    }

    fun useOnDevice() = viewModelScope.launch { container.preferences.useOnDevice() }

    fun configureServer(url: String, done: (Boolean) -> Unit) = viewModelScope.launch {
        _state.update { it.copy(isLoading = true, message = null) }
        repository.verifyServer(url).onSuccess {
            container.preferences.configureServer(url)
            done(true)
        }.onFailure {
            showError(it)
            done(false)
        }
    }

    fun signIn(username: String, password: String, done: (Boolean) -> Unit) = viewModelScope.launch {
        val url = _state.value.preferences.serverUrl
        _state.update { it.copy(isLoading = true, message = null) }
        repository.signIn(url, username, password).onSuccess {
            done(true)
        }.onFailure {
            showError(it)
            done(false)
        }
    }

    fun signOut() = viewModelScope.launch { container.preferences.signOut() }
    fun setTheme(theme: ThemeMode) = viewModelScope.launch { container.preferences.setTheme(theme) }
    fun setAccent(accent: AccentChoice) = viewModelScope.launch { container.preferences.setAccent(accent) }
    fun setCurrency(currency: String) = viewModelScope.launch { container.preferences.setCurrency(currency) }
    fun setShowPricing(show: Boolean) = viewModelScope.launch { container.preferences.setShowPricing(show) }
    fun setShowCardNumbers(show: Boolean) = viewModelScope.launch { container.preferences.setShowCardNumbers(show) }
    fun setBiometricLockEnabled(enabled: Boolean) = viewModelScope.launch {
        container.preferences.setBiometricLockEnabled(enabled)
    }
    fun setDefaultGame(game: String?) = viewModelScope.launch { container.preferences.setDefaultGame(game) }
    fun setGameEnabled(game: String, enabled: Boolean) = viewModelScope.launch {
        if (!enabled) {
            gameDisableBlockReason(game, _state.value.binders, _state.value.wishlists)?.let { reason ->
                _state.update {
                    it.copy(message = "${game.replaceFirstChar(Char::uppercase)} cannot be hidden while it has $reason. Remove those cards first.")
                }
                return@launch
            }
        }
        container.preferences.setGameEnabled(game, enabled)
    }
    fun setBottomNavigationItemVisible(item: BottomNavigationItem, visible: Boolean) = viewModelScope.launch {
        container.preferences.setBottomNavigationItemVisible(item, visible)
    }
    fun moveBottomNavigationItem(item: BottomNavigationItem, offset: Int) = viewModelScope.launch {
        val order = _state.value.preferences.bottomNavigationOrder.toMutableList()
        val oldIndex = order.indexOf(item)
        val newIndex = (oldIndex + offset).coerceIn(order.indices)
        if (oldIndex >= 0 && oldIndex != newIndex) {
            order.removeAt(oldIndex)
            order.add(newIndex, item)
            container.preferences.setBottomNavigationOrder(order)
        }
    }
    fun resetBottomNavigation() = viewModelScope.launch { container.preferences.resetBottomNavigation() }
    fun installScannerAssets(game: String) = viewModelScope.launch { container.scannerAssets.install(game) }
    fun refreshScannerAssets(game: String) = viewModelScope.launch {
        runCatching { container.scannerAssets.refreshManifest(game) }
    }
    fun removeScannerAssets(game: String) = container.scannerAssets.remove(game)
    fun installGamePackage(url: String) = viewModelScope.launch { container.gamePackages.install(url) }
    fun removeGamePackage(game: String) = container.gamePackages.remove(game)
    suspend fun communityGameCards(game: String) = container.gamePackages.cards(game)
    fun clearMessage() = _state.update { it.copy(message = null) }

    private fun launchMutation(block: suspend () -> Unit) = viewModelScope.launch {
        runCatching { block() }.onSuccess { refresh() }.onFailure(::showError)
    }

    private fun sealedMutation(done: (Boolean) -> Unit, block: suspend () -> Unit) = viewModelScope.launch {
        runCatching { block() }
            .onSuccess {
                loadSealedData()
                done(true)
            }
            .onFailure { error ->
                showError(error)
                done(false)
            }
    }

    private fun showError(error: Throwable) {
        _state.update {
            it.copy(
                isLoading = false,
                isSearching = false,
                isScanning = false,
                message = error.message ?: "Something went wrong",
            )
        }
    }

    companion object {
        fun factory(container: AppContainer): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = AppViewModel(container) as T
        }
    }
}

private fun AndroidScannerRequest.toDomainScanOptions() = CardScanOptions(
    engine = when (options.recognitionEngine) {
        ScannerRecognitionEngine.AUTOMATIC -> CardScanEngine.AUTOMATIC
        ScannerRecognitionEngine.SERVER_PHASH -> CardScanEngine.SERVER_PHASH
        ScannerRecognitionEngine.SERVER_EMBEDDING -> CardScanEngine.SERVER_EMBEDDING
        ScannerRecognitionEngine.ON_DEVICE_OCR -> CardScanEngine.ON_DEVICE_OCR
    },
    encoderVariant = when (options.encoderVariant) {
        ScannerEncoderVariant.ARCFACE -> CardScanEncoderVariant.ARCFACE
        ScannerEncoderVariant.DINOV2 -> CardScanEncoderVariant.DINOV2
    },
    saveDebugCapture = options.saveServerDebugCapture,
    captureSource = debugCapture.source,
    captureNotes = debugCapture.notes,
    setCodeHint = options.setCodeHint.trim().ifBlank { null },
    printingMode = options.printingMode,
    ocrEnabled = options.ocrEnabled,
)
