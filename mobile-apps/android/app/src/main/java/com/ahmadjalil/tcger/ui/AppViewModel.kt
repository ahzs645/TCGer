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
import com.ahmadjalil.tcger.domain.CatalogScanDecision
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
import com.ahmadjalil.tcger.data.gamepackage.CommunityCatalogCard
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
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import com.ahmadjalil.tcger.domain.identity
import com.ahmadjalil.tcger.domain.CollectionEdit
import com.ahmadjalil.tcger.domain.OwnedCard
import com.ahmadjalil.tcger.domain.edit
import com.ahmadjalil.tcger.domain.WishlistRule
import java.util.UUID
import com.ahmadjalil.tcger.data.repository.toDomain

data class AppUiState(
    val preferences: AppPreferences = AppPreferences(),
    val preferencesLoaded: Boolean = false,
    val isAdmin: Boolean = false,
    val serverSetupRequired: Boolean = false,
    val serverFeatures: Map<String, Boolean> = emptyMap(),
    val publicCollections: Boolean = false,
    val searchCollectionOnly: Boolean = false,
    val currencyRevision: Long = 0,
    val binders: List<Binder> = emptyList(),
    val wishlists: List<Wishlist> = emptyList(),
    val sealedInventory: List<SealedInventoryItem> = emptyList(),
    val sealedProducts: List<SealedProduct> = emptyList(),
    val sealedOpeningLedgers: List<SealedOpeningLedger> = emptyList(),
    val isLoadingSealed: Boolean = false,
    val sealedInventoryError: String? = null,
    val previewCard: CatalogCard? = null,
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
    val currencyRateStatus = container.currencyRates.status
    fun refreshCurrencyRate() = viewModelScope.launch {
        container.currencyRates.select(_state.value.preferences.currency, force = true)
        _state.update { it.copy(currencyRevision = it.currencyRevision + 1) }
    }
    private val repository: TCGerRepository = container.repository
    private val _state = MutableStateFlow(AppUiState())
    val state: StateFlow<AppUiState> = _state.asStateFlow()
    private val latestSearch = LatestSearchRequest(viewModelScope)

    init {
        viewModelScope.launch {
            container.gamePackages.state.collectLatest { packages ->
                container.scannerAssets.setGamePackages(packages.installed)
                _state.update { it.copy(gamePackages = packages, scannerSupportedGames = container.scannerAssets.availableDownloadGames) }
            }
        }
        viewModelScope.launch { container.gamePackages.refreshOfficial() }
        viewModelScope.launch {
            container.preferences.preferences.map { Triple(it.dataSourceMode, it.serverUrl, it.authToken) }.distinctUntilChanged().collectLatest {
                runCatching { refreshServerStatus(); syncAccountPreferences() }.onFailure(::showError)
            }
        }
        viewModelScope.launch {
            container.preferences.preferences.map { it.currency }.distinctUntilChanged().collectLatest { currency ->
                container.currencyRates.select(currency)
                _state.update { it.copy(currencyRevision = it.currencyRevision + 1) }
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
                _state.update { it.copy(preferences = preferences, preferencesLoaded = true) }
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
        if (_state.value.preferences.dataSourceMode == DataSourceMode.SERVER && !_state.value.preferences.isSignedIn) {
            runCatching { refreshServerStatus() }.onFailure(::showError)
            _state.update { it.copy(isLoading = false) }
            return@launch
        }
        _state.update { it.copy(isLoading = true, message = null) }
        runCatching {
            Triple(
                repository.getBinders(),
                repository.getWishlists(),
                runCatching { if (_state.value.preferences.sealedProductsEnabled) repository.getSealedInventory() else emptyList() },
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
        val game = _state.value.searchGame
        latestSearch.launch(
            onStart = { _state.update { it.copy(isSearching = true, message = null) } },
            operation = { repository.discoverCards(game, 6) },
            onSuccess = { cards -> _state.update { it.copy(isSearching = false, searchResults = cards) } },
            onFailure = ::showSearchError,
        )
    }
    suspend fun saveWishlistRule(wishlistId: String, rule: WishlistRule) {
        val saved = repository.saveWishlistRule(wishlistId, rule)
        if (saved.autoSync) syncWishlistRule(wishlistId, saved) else refresh().join()
    }
    suspend fun deleteWishlistRule(wishlistId: String, ruleId: String) {
        repository.deleteWishlistRule(wishlistId, ruleId)
        refresh()
    }
    suspend fun syncWishlistRule(wishlistId: String, rule: WishlistRule) {
        try {
            val packageCards = if (_state.value.preferences.dataSourceMode == DataSourceMode.ON_DEVICE) {
                _state.value.gamePackages.installed.flatMap { installed ->
                    container.gamePackages.cards(installed.id).map { it.toDomainCard(installed.id, installed.manifest.game.id) }
                }.filter(rule::matches)
            } else emptyList()
            val matches = (repository.resolveWishlistRule(rule) + packageCards).distinctBy { it.identity() }.let {
                if (rule.includeAllPrintings) it else it.distinctBy { card -> "${card.tcg}:${card.name.lowercase()}" }
            }
            val owned = repository.getWishlists().first { it.id == wishlistId }.cards.map { it.card.identity() }.toSet()
            matches.filterNot { it.identity() in owned }.forEach { repository.addWishlistCard(wishlistId, it) }
            repository.saveWishlistRule(wishlistId, rule.copy(lastSyncedAt = java.time.Instant.now().toString(), lastMatchCount = matches.size))
        } finally { refresh() }
    }

    fun removeWishlistCard(wishlistId: String, cardId: String) = launchMutation {
        repository.removeWishlistCard(wishlistId, cardId)
    }

    suspend fun exportPortableBackup(): String = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { repository.exportBackup() }

    suspend fun importReviewedBackup(raw: String) { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { repository.importBackup(raw) }; refresh() }

    fun importPortableBackup(raw: String) = launchMutation { repository.importBackup(raw) }
    fun eraseLocalCardsAndBinders() = launchMutation { repository.eraseLocalCardsAndBinders() }
    fun restoreLatestRecoveryPoint() = launchMutation { repository.restoreLatestRecoveryPoint() }

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

    fun openCatalogCard(card: CatalogCard) { _state.update { it.copy(previewCard = card) } }
    fun closeCatalogCard() { _state.update { it.copy(previewCard = null) } }
    suspend fun cardPrints(card: CatalogCard): List<CatalogCard> {
        val packageId = card.id.substringBefore("::", "")
        val source = _state.value.gamePackages.installed.find { it.id == packageId && it.manifest.game.id == card.tcg }
        if (source != null) {
            val cards = container.gamePackages.cards(source.id)
            val original = cards.find { it.id == card.id.substringAfter("::") } ?: return listOf(card)
            return cards.filter { (it.baseExternalId ?: it.id) == (original.baseExternalId ?: original.id) }
                .map { it.toDomainCard(source.id, source.manifest.game.id) }
        }
        return (listOf(card) + repository.cardPrints(card)).distinctBy { it.identity() }
    }

    fun setSearchQuery(query: String) {
        _state.update { it.copy(searchQuery = query) }
        runSearchDebounced()
    }

    fun setSearchCollectionOnly(collectionOnly: Boolean) {
        _state.update { it.copy(searchCollectionOnly = collectionOnly) }
        runSearchDebounced()
    }

    fun setSearchGame(game: String?) {
        _state.update { it.copy(searchGame = game) }
        runSearchDebounced()
    }

    private fun runSearchDebounced() {
        val snapshot = _state.value
        latestSearch.launch(
            delayMillis = 250,
            onStart = { _state.update { it.copy(isSearching = snapshot.searchQuery.trim().length >= 2, message = null) } },
            operation = {
                if (snapshot.searchQuery.trim().length < 2) return@launch emptyList()
                if (snapshot.searchCollectionOnly) {
                    return@launch snapshot.binders.flatMap { it.cards }.map { it.card }
                        .filter { matchesOwnedSearch(it, snapshot.searchQuery, snapshot.searchGame) }
                        .distinctBy { it.identity() }
                }
                val selectedPackageId = snapshot.searchGame
                    ?.takeIf { it.startsWith("package:") }
                    ?.removePrefix("package:")
                val serverResults = if (selectedPackageId == null) {
                    repository.searchCards(snapshot.searchQuery, snapshot.searchGame)
                } else {
                    emptyList()
                }
                val query = snapshot.searchQuery.trim()
                val packageResults = buildList {
                    snapshot.gamePackages.installed
                        .filter { it.manifest.effectiveDefinition.interfaces?.search != false }
                        .filter { matchesSearchLibrary(snapshot.searchGame, it.id, it.manifest.game.id) }
                        .forEach { installed ->
                            addAll(container.gamePackages.cards(installed.id)
                                .filter { card ->
                                    card.name.contains(query, true) ||
                                        card.setName?.contains(query, true) == true ||
                                        card.setCode?.contains(query, true) == true ||
                                        card.collectorNumber?.contains(query, true) == true
                                }
                                .map { it.toDomainCard(installed.id, installed.manifest.game.id) })
                        }
                }
                (serverResults + packageResults).distinctBy { "${it.tcg}:${it.id}" }
            },
            onSuccess = { results -> _state.update { it.copy(searchResults = results, isSearching = false) } },
            onFailure = ::showSearchError,
        )
    }

    private fun showSearchError(error: Throwable) {
        _state.update { it.copy(isSearching = false, message = error.message ?: "Search failed") }
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

    suspend fun saveCopy(card: OwnedCard, edit: CollectionEdit, target: String, extra: Int) {
        repository.updateCard(card.binderId, card.id, edit, target.takeUnless { it == card.binderId })
        if (extra > 0) repository.addCardWithDetails(target, card.card, extra, edit)
        refresh()
    }

    suspend fun bulkEdit(copies: List<OwnedCard>, condition: String?, target: String?, delete: Boolean) {
        try {
            val currentCopies = repository.getBinders().flatMap { it.cards }.associateBy { it.id }
            copies.forEach { selected ->
                val copy = currentCopies[selected.id] ?: return@forEach
                if (delete) repository.removeCard(copy.binderId, copy.id)
                else repository.updateCard(copy.binderId, copy.id, copy.edit().let { if (condition == null) it else it.copy(condition = condition) }, target)
            }
        } finally { refresh() }
    }

    fun addCard(binderId: String, card: CatalogCard) = launchMutation { repository.addCard(binderId, card) }
    fun addCardsToBinder(binderId: String, cards: List<CatalogCard>) = launchMutation {
        cards.groupingBy { it.identity() }.eachCount().forEach { (cardId, quantity) ->
            cards.firstOrNull { it.identity() == cardId }?.let { repository.addCard(binderId, it, quantity) }
        }
    }
    fun removeCard(binderId: String, cardId: String) = launchMutation { repository.removeCard(binderId, cardId) }
    fun addWishlistCard(wishlistId: String, card: CatalogCard) = launchMutation { repository.addWishlistCard(wishlistId, card) }

    fun createWishlistWithCards(name: String, cards: List<CatalogCard>) = launchMutation {
        if (name.isBlank()) return@launchMutation
        val wishlist = repository.createWishlist(
            WishlistInput(name = name, description = "Created from an Android set or collection guide"),
        )
        cards.distinctBy { it.identity() }.forEach { repository.addWishlistCard(wishlist.id, it) }
    }

    suspend fun createGuideWishlist(name: String, cards: List<CatalogCard>): String {
        val wishlist = repository.createWishlist(
            WishlistInput(name = name, description = "Created from a collection guide"),
        )
        cards.distinctBy { it.identity() }.forEach { repository.addWishlistCard(wishlist.id, it) }
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

    fun searchScannerCards(
        query: String,
        game: String,
        done: (Result<List<CatalogCard>>) -> Unit,
    ) = viewModelScope.launch {
        val normalizedQuery = query.trim()
        if (normalizedQuery.length < 2) {
            done(Result.success(emptyList()))
            return@launch
        }
        done(runCatching { repository.searchCards(normalizedQuery, game) })
    }

    fun selectScannerMatch(card: CatalogCard) {
        _state.update { current ->
            val result = current.scanResult ?: return@update current
            val manualCandidate = CardScanCandidate(card = card, confidence = 1.0)
            current.copy(
                scanResult = result.copy(
                    candidates = listOf(manualCandidate) + result.candidates.filterNot { it.card.id == card.id },
                    printingResolutionProvenance = "user_selected",
                    requiresPrintingChoice = false,
                    catalogDecision = CatalogScanDecision(
                        accepted = true,
                        reason = "manual-selection",
                        topConfidence = 1.0,
                    ),
                ),
            )
        }
    }

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

    fun finishSetup(games: Set<String>? = null) = viewModelScope.launch { container.preferences.finishSetup(games) }
    fun setSealedProductsEnabled(enabled: Boolean) = viewModelScope.launch { container.preferences.setSealedProductsEnabled(enabled) }
    fun resetDisplayPreferences() = viewModelScope.launch { container.preferences.resetDisplayPreferences() }

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

    suspend fun refreshServerStatus() {
        val settings = container.preferences.current()
        if (settings.dataSourceMode != DataSourceMode.SERVER) {
            _state.update { it.copy(isAdmin = false, serverSetupRequired = false, serverFeatures = emptyMap(), publicCollections = false) }; return
        }
        val api = com.ahmadjalil.tcger.data.remote.RemoteServiceFactory().create(settings.serverUrl)
        val health = api.health()
        val setup = runCatching { api.setupStatus()["setupRequired"]?.jsonPrimitive?.booleanOrNull == true }.getOrDefault(false)
        val policy = runCatching { api.appSettings() }.getOrNull()
        val public = policy?.get("publicCollections")?.jsonPrimitive?.booleanOrNull == true && policy["requireAuth"]?.jsonPrimitive?.booleanOrNull == false
        val profile = runCatching { api.profile(settings.authToken?.let { "Bearer $it" }) }.getOrNull()
        val current = container.preferences.current()
        if (current.serverUrl != settings.serverUrl || current.authToken != settings.authToken || current.dataSourceMode != settings.dataSourceMode) return
        _state.update { it.copy(isAdmin = profile?.get("isAdmin")?.jsonPrimitive?.booleanOrNull == true, serverSetupRequired = setup, serverFeatures = health.features, publicCollections = public) }
        if (!settings.isSignedIn && public) {
            val binders = api.getBinders(null).map { it.toDomain() }
            if (container.preferences.current().let { it.serverUrl == settings.serverUrl && it.authToken == settings.authToken && it.dataSourceMode == settings.dataSourceMode })
                _state.update { it.copy(binders = binders, isLoading = false) }
        }
    }
    suspend fun finishAdminSetup() {
        val settings = container.preferences.current()
        accountApi().finishAdminSetup("Bearer ${requireNotNull(settings.authToken) { "Sign in or create your first account before finishing setup." }}")
        refreshServerStatus()
    }

    private fun accountApi() = com.ahmadjalil.tcger.data.remote.RemoteServiceFactory().create(_state.value.preferences.serverUrl)
    private fun accountAuth() = "Bearer ${requireNotNull(_state.value.preferences.authToken) { "Sign in first" }}"
    suspend fun loadProfile() = accountApi().profile(accountAuth())
    suspend fun updateProfile(username: String, email: String) {
        accountApi().updateProfile(accountAuth(), buildJsonObject { put("username", username.trim()); put("email", email.trim()) })
    }
    suspend fun changePassword(current: String, replacement: String) {
        require(replacement.length >= 8) { "Use at least eight characters" }
        accountApi().changePassword(accountAuth(), buildJsonObject { put("currentPassword", current); put("newPassword", replacement) })
    }
    suspend fun deleteAccount(password: String) {
        accountApi().deleteAccount(accountAuth(), buildJsonObject { put("password", password) })
        container.preferences.signOut()
        container.preferences.useOnDevice()
    }
    suspend fun signUp(username: String, email: String, password: String) {
        require(username.isNotBlank() && email.contains('@') && password.length >= 8) { "Enter a username, email, and password of at least eight characters" }
        val response = accountApi().signUp(buildJsonObject { put("username", username.trim()); put("name", username.trim()); put("email", email.trim()); put("password", password) })
        if (response.token != null) container.preferences.saveSession(response.token, username.trim(), response.user?.id)
        else repository.signIn(_state.value.preferences.serverUrl, username, password).getOrThrow()
    }
    suspend fun syncAccountPreferences() {
        val settings = container.preferences.current()
        if (settings.dataSourceMode == DataSourceMode.SERVER && settings.isSignedIn) {
            val api = com.ahmadjalil.tcger.data.remote.RemoteServiceFactory().create(settings.serverUrl)
            container.preferences.applyServerPreferences(api.preferences("Bearer ${settings.authToken}"))
        }
    }
    private suspend fun updateAccountPreferences(fields: JsonObject, local: suspend () -> Unit) {
        val settings = _state.value.preferences
        if (settings.dataSourceMode == DataSourceMode.SERVER && settings.isSignedIn) {
            container.preferences.applyServerPreferences(accountApi().updatePreferences(accountAuth(), fields))
        } else local()
    }

    fun signOut() = viewModelScope.launch { container.preferences.signOut() }
    fun setTheme(theme: ThemeMode) = viewModelScope.launch { container.preferences.setTheme(theme) }
    fun setAccent(accent: AccentChoice) = viewModelScope.launch { container.preferences.setAccent(accent) }
    fun setCurrency(currency: String) = viewModelScope.launch { container.preferences.setCurrency(currency) }
    fun setShowPricing(show: Boolean) = launchMutation { updateAccountPreferences(buildJsonObject { put("showPricing", show) }) { container.preferences.setShowPricing(show) } }
    fun setShowCardNumbers(show: Boolean) = launchMutation { updateAccountPreferences(buildJsonObject { put("showCardNumbers", show) }) { container.preferences.setShowCardNumbers(show) } }
    fun setBiometricLockEnabled(enabled: Boolean) = viewModelScope.launch {
        container.preferences.setBiometricLockEnabled(enabled)
    }
    fun setDefaultGame(game: String?) = launchMutation { updateAccountPreferences(buildJsonObject { put("defaultGame", game?.let(::JsonPrimitive) ?: JsonNull) }) { container.preferences.setDefaultGame(game) } }
    fun setGameEnabled(game: String, enabled: Boolean) = viewModelScope.launch {
        if (!enabled) {
            gameDisableBlockReason(game, _state.value.binders, _state.value.wishlists)?.let { reason ->
                _state.update {
                    it.copy(message = "${game.replaceFirstChar(Char::uppercase)} cannot be hidden while it has $reason. Remove those cards first.")
                }
                return@launch
            }
        }
        runCatching {
            val field = mapOf("pokemon" to "enabledPokemon", "magic" to "enabledMagic", "yugioh" to "enabledYugioh", "onepiece" to "enabledOnepiece", "lorcana" to "enabledLorcana", "dragonball" to "enabledDragonball")[game]
            if (field == null) container.preferences.setGameEnabled(game, enabled)
            else updateAccountPreferences(buildJsonObject { put(field, enabled) }) { container.preferences.setGameEnabled(game, enabled) }
        }.onFailure(::showError)
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
    fun installOfficialGamePackage(gameId: String) = viewModelScope.launch {
        container.gamePackages.installOfficial(gameId)
    }
    fun checkGamePackageUpdates() = viewModelScope.launch { container.gamePackages.checkForUpdates() }
    fun updateGamePackage(packageId: String) = viewModelScope.launch { container.gamePackages.update(packageId) }
    fun refreshOfficialGamePackages() = viewModelScope.launch { container.gamePackages.refreshOfficial() }
    fun removeGamePackage(game: String) = container.gamePackages.remove(game)
    suspend fun enableGameCapability(game: String, kind: String) {
        if (kind == "scanner") {
            val installed = _state.value.gamePackages.installed.first { it.id == game }
            container.scannerAssets.install(installed.manifest.game.id)
        } else container.gamePackages.enableCapability(game, kind)
    }
    fun gamePackLibrary(game: String) = container.gamePackages.packLibrary(game)
    fun gamePriceSnapshot(game: String) = container.gamePackages.priceSnapshot(game)
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

fun CommunityCatalogCard.toDomainCard(packageId: String, gameId: String) = CatalogCard(
    id = "$packageId::$id",
    name = name,
    tcg = gameId,
    setCode = setCode,
    setName = setName,
    rarity = rarity,
    collectorNumber = collectorNumber,
    imageUrl = imageUrl,
    exactPrintingId = printingKey,
    releaseDate = releasedAt,
    artist = artist,
    supertype = supertype ?: type,
    setSymbolUrl = setSymbolUrl,
    setLogoUrl = setLogoUrl,
    attributes = effectiveAttributes().mapValues { (_, value) ->
        when (value) {
            is JsonArray -> value.map { (it as? JsonPrimitive)?.content ?: it.toString() }
            is JsonPrimitive -> listOf(value.content)
            else -> listOf(value.toString())
        }
    },
)

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
