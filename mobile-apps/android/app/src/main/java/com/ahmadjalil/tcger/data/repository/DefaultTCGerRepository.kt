package com.ahmadjalil.tcger.data.repository

import android.content.Context
import com.ahmadjalil.tcger.data.local.BinderEntity
import com.ahmadjalil.tcger.data.local.BinderWithCards
import com.ahmadjalil.tcger.data.local.OwnedCardEntity
import com.ahmadjalil.tcger.data.local.TCGerDao
import com.ahmadjalil.tcger.data.local.WishlistCardEntity
import com.ahmadjalil.tcger.data.local.WishlistEntity
import com.ahmadjalil.tcger.data.local.WishlistWithCards
import com.ahmadjalil.tcger.data.preferences.PreferencesStore
import com.ahmadjalil.tcger.data.remote.AddCardRequest
import com.ahmadjalil.tcger.data.remote.AddWishlistCardRequest
import com.ahmadjalil.tcger.data.remote.BinderDto
import com.ahmadjalil.tcger.data.remote.CardDataRequest
import com.ahmadjalil.tcger.data.remote.CardDto
import com.ahmadjalil.tcger.data.remote.CreateBinderRequest
import com.ahmadjalil.tcger.data.remote.CreateSealedOpeningRequest
import com.ahmadjalil.tcger.data.remote.CreateWishlistRequest
import com.ahmadjalil.tcger.data.remote.RemoteServiceFactory
import com.ahmadjalil.tcger.data.remote.ScanMatchDto
import com.ahmadjalil.tcger.data.remote.SealedInventoryItemDto
import com.ahmadjalil.tcger.data.remote.SealedOpeningDto
import com.ahmadjalil.tcger.data.remote.ScanDebugCaptureSummaryDto
import com.ahmadjalil.tcger.data.remote.UpdateScanDebugCaptureRequest
import com.ahmadjalil.tcger.data.remote.SignInRequest
import com.ahmadjalil.tcger.data.remote.WishlistDto
import com.ahmadjalil.tcger.data.scanner.CardTitleExtractor
import com.ahmadjalil.tcger.data.scanner.OnDeviceCardTextRecognizer
import com.ahmadjalil.tcger.data.scanner.model.ArcFaceCardRecognizer
import com.ahmadjalil.tcger.data.scanner.model.ArcFaceRecognitionDecision
import com.ahmadjalil.tcger.data.scanner.model.DinoV2CardRecognizer
import com.ahmadjalil.tcger.data.scanner.model.DinoV2ManualOcrRescue
import com.ahmadjalil.tcger.data.scanner.model.DinoV2OcrRescueDecision
import com.ahmadjalil.tcger.data.scanner.model.DinoV2RecognitionDecision
import com.ahmadjalil.tcger.data.scanner.model.DinoV2RecognitionResult
import com.ahmadjalil.tcger.data.scanner.model.LocalEmbeddingDispatch
import com.ahmadjalil.tcger.data.scanner.model.LocalEmbeddingModel
import com.ahmadjalil.tcger.data.scanner.model.CardEmbeddingMetadata
import com.ahmadjalil.tcger.domain.Binder
import com.ahmadjalil.tcger.domain.CardScanCandidate
import com.ahmadjalil.tcger.domain.CardScanEngine
import com.ahmadjalil.tcger.domain.CardScanEncoderVariant
import com.ahmadjalil.tcger.domain.CardScanOptions
import com.ahmadjalil.tcger.domain.CardScanResult
import com.ahmadjalil.tcger.domain.CardScanSource
import com.ahmadjalil.tcger.domain.ScanDebugCapture
import com.ahmadjalil.tcger.domain.ScanDebugFeedbackStatus
import com.ahmadjalil.tcger.domain.ScanDebugReviewTag
import com.ahmadjalil.tcger.domain.CatalogCard
import com.ahmadjalil.tcger.domain.DataSourceMode
import com.ahmadjalil.tcger.domain.OwnedCard
import com.ahmadjalil.tcger.domain.SealedInventoryItem
import com.ahmadjalil.tcger.domain.SealedOpeningRecord
import com.ahmadjalil.tcger.domain.SealedProduct
import com.ahmadjalil.tcger.domain.SignInResult
import com.ahmadjalil.tcger.domain.TCGerRepository
import com.ahmadjalil.tcger.domain.Wishlist
import com.ahmadjalil.tcger.domain.WishlistCard
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

class DefaultTCGerRepository(
    private val applicationContext: Context,
    private val dao: TCGerDao,
    private val preferencesStore: PreferencesStore,
    private val remoteFactory: RemoteServiceFactory,
    private val textRecognizer: OnDeviceCardTextRecognizer,
) : TCGerRepository {
    @Volatile private var arcFaceRecognizer: ArcFaceCardRecognizer? = null
    @Volatile private var dinoV2Recognizer: DinoV2CardRecognizer? = null
    override suspend fun getBinders(): List<Binder> = withSource(
        local = { dao.getBinders().map(BinderWithCards::toDomain) },
        remote = { api, auth -> api.getBinders(auth).map(BinderDto::toDomain) },
    )

    override suspend fun createBinder(name: String, description: String?): Binder = withSource(
        local = {
            val now = System.currentTimeMillis()
            val entity = BinderEntity(UUID.randomUUID().toString(), name.trim(), description, "315DA8", now, now)
            dao.upsertBinder(entity)
            BinderWithCards(entity, emptyList()).toDomain()
        },
        remote = { api, auth -> api.createBinder(auth, CreateBinderRequest(name.trim(), description, "315DA8")).toDomain() },
    )

    override suspend fun deleteBinder(id: String) = withSource(
        local = { dao.deleteBinder(id) },
        remote = { api, auth -> api.deleteBinder(auth, id) },
    )

    override suspend fun searchCards(query: String, tcg: String?): List<CatalogCard> = withSource(
        local = {
            dao.searchOwnedCards(query.trim())
                .asSequence()
                .filter { tcg == null || it.tcg == tcg }
                .distinctBy { it.externalId }
                .map(OwnedCardEntity::toCatalogCard)
                .toList()
        },
        remote = { api, auth -> api.searchCards(auth, query.trim(), tcg).cards.map(CardDto::toDomain) },
    )

    override suspend fun scanCard(imageBytes: ByteArray, tcg: String, options: CardScanOptions): CardScanResult {
        require(imageBytes.isNotEmpty()) { "Capture or choose a card image first" }
        val settings = preferencesStore.current()
        var serverFailure: Throwable? = null

        when (LocalEmbeddingDispatch.select(tcg, options)) {
        LocalEmbeddingModel.ARCFACE -> {
            runCatching {
                withContext(Dispatchers.Default) { getArcFaceRecognizer().recognize(imageBytes) }
            }.onSuccess { local ->
                if (local.decision is ArcFaceRecognitionDecision.Accepted) {
                    return CardScanResult(
                        candidates = local.matches.take(5).map { match ->
                            CardScanCandidate(match.card.toDomain(), match.similarity)
                        },
                        source = CardScanSource.ON_DEVICE_EMBEDDING,
                        engine = "arcface",
                        elapsedMs = local.preprocessMs + local.inferenceMs + local.searchMs,
                    )
                }
            }.onFailure { error ->
                if (options.engine == CardScanEngine.ON_DEVICE_OCR) serverFailure = error
            }
        }
        LocalEmbeddingModel.DINOV2 -> {
            val recognizer = runCatching { getDinoV2Recognizer() }.getOrElse { error ->
                if (options.engine == CardScanEngine.ON_DEVICE_OCR) throw error
                serverFailure = error
                null
            }
            if (recognizer != null) {
                val local = runCatching {
                    withContext(Dispatchers.Default) { recognizer.recognize(imageBytes) }
                }.getOrElse { error ->
                    if (options.engine == CardScanEngine.ON_DEVICE_OCR) throw error
                    serverFailure = error
                    null
                }
                if (local != null) {
                    val accepted = local.decision as? DinoV2RecognitionDecision.Accepted
                    if (accepted != null) {
                        return local.toCardScanResult(engine = "dinov2")
                    }
                    if (LocalEmbeddingDispatch.permitsManualOcrRescue(options)) {
                        val evidence = runCatching { textRecognizer.recognizeDinoV2Evidence(imageBytes) }.getOrElse { error ->
                            if (options.engine == CardScanEngine.ON_DEVICE_OCR) throw error
                            serverFailure = error
                            null
                        }
                        if (evidence != null) {
                            when (val rescue = recognizer.rescueManualCapture(local, evidence)) {
                                is DinoV2OcrRescueDecision.Accepted -> {
                                    val reordered = listOf(rescue.match) + local.matches.filter { it.card.cardId != rescue.match.card.cardId }
                                    return local.copy(matches = reordered).toCardScanResult(
                                        engine = "dinov2-ocr-rescue",
                                        recognizedText = rescue.recognizedText,
                                    )
                                }
                                is DinoV2OcrRescueDecision.Rejected -> Unit
                            }
                        }
                    }
                    if (options.engine == CardScanEngine.ON_DEVICE_OCR) {
                        throw IllegalArgumentException(
                            if (LocalEmbeddingDispatch.permitsManualOcrRescue(options)) {
                                "DINOv2 could not confirm this card with exact title or collector-number OCR."
                            } else {
                                "DINOv2 rejected this automatic frame; capture manually for OCR rescue."
                            },
                        )
                    }
                }
            }
        }
        null -> Unit
        }

        if (options.engine != CardScanEngine.ON_DEVICE_OCR && settings.dataSourceMode == DataSourceMode.SERVER && settings.isSignedIn) {
            runCatching {
                val mediaType = "image/jpeg".toMediaType()
                val imageBody = imageBytes.toRequestBody(mediaType)
                val imagePart = MultipartBody.Part.createFormData("image", "android-card.jpg", imageBody)
                val textBody = "text/plain".toMediaType()
                remoteFactory.create(settings.serverUrl).scanCard(
                    auth = "Bearer ${settings.authToken}",
                    tcg = tcg,
                    image = imagePart,
                    scanEngine = checkNotNull(options.engine.apiValue).toRequestBody(textBody),
                    captureSource = options.captureSource.toRequestBody(textBody),
                    saveDebugCapture = (if (options.saveDebugCapture) "1" else "0").toRequestBody(textBody),
                    captureNotes = options.captureNotes.orEmpty().trim().toRequestBody(textBody),
                )
            }.onSuccess { response ->
                val matches = listOfNotNull(response.match).plus(response.candidates)
                    .distinctBy(ScanMatchDto::externalId)
                if (matches.isNotEmpty()) {
                    return CardScanResult(
                        candidates = matches.map { CardScanCandidate(it.toDomain(), it.confidence) },
                        source = CardScanSource.SERVER_IMAGE_MATCH,
                        engine = response.meta?.engine ?: options.engine.apiValue,
                        elapsedMs = response.meta?.timings?.totalMs,
                        debugCaptureId = response.debugCapture?.id,
                        debugCaptureError = response.debugCaptureError,
                    )
                }
            }.onFailure { serverFailure = it }
        }

        val recognizedText = runCatching { textRecognizer.recognize(imageBytes) }
            .getOrElse { throw serverFailure ?: it }
        val queries = CardTitleExtractor.candidateQueries(recognizedText)
        if (queries.isEmpty()) {
            throw serverFailure ?: IllegalArgumentException(
                "No card title was readable. Fill the frame, avoid glare, and try again.",
            )
        }

        val catalogMatches = mutableListOf<CatalogCard>()
        for (query in queries.take(4)) {
            val matches = runCatching { searchCards(query, tcg) }.getOrDefault(emptyList())
            catalogMatches += matches.take(4)
        }
        val uniqueMatches = catalogMatches.distinctBy(CatalogCard::id).take(5)
        val candidates = if (uniqueMatches.isNotEmpty()) {
            uniqueMatches.map(::CardScanCandidate)
        } else {
            listOf(
                CardScanCandidate(
                    CatalogCard(
                        id = "scan-${tcg}-${queries.first().lowercase().replace(Regex("[^a-z0-9]+"), "-")}",
                        name = queries.first(),
                        tcg = tcg,
                    ),
                ),
            )
        }
        return CardScanResult(
            candidates = candidates,
            source = CardScanSource.ON_DEVICE_TEXT,
            recognizedText = recognizedText,
            engine = CardScanEngine.ON_DEVICE_OCR.name.lowercase(),
        )
    }

    private fun getArcFaceRecognizer(): ArcFaceCardRecognizer = arcFaceRecognizer ?: synchronized(this) {
        arcFaceRecognizer ?: ArcFaceCardRecognizer.load(applicationContext).also { arcFaceRecognizer = it }
    }

    private fun getDinoV2Recognizer(): DinoV2CardRecognizer = dinoV2Recognizer ?: synchronized(this) {
        dinoV2Recognizer ?: DinoV2CardRecognizer.load(applicationContext).also { dinoV2Recognizer = it }
    }

    override suspend fun getScanDebugCaptures(limit: Int): List<ScanDebugCapture> = withServer { api, auth ->
        api.getScanDebugCaptures(auth, limit.coerceIn(1, 50)).captures.map(ScanDebugCaptureSummaryDto::toDomain)
    }

    override suspend fun updateScanDebugCapture(
        captureId: String,
        feedbackStatus: ScanDebugFeedbackStatus?,
        reviewTags: Set<ScanDebugReviewTag>?,
        notes: String?,
    ): ScanDebugCapture = withServer { api, auth ->
        api.updateScanDebugCapture(
            auth,
            captureId,
            UpdateScanDebugCaptureRequest(
                feedbackStatus = feedbackStatus?.apiValue,
                reviewTags = reviewTags?.map(ScanDebugReviewTag::apiValue),
                notes = notes,
            ),
        ).capture.toDomain()
    }

    override suspend fun addCard(binderId: String, card: CatalogCard, quantity: Int) = withSource(
        local = {
            val existing = dao.findOwnedCard(binderId, card.id)
            val copyId = existing?.id ?: UUID.randomUUID().toString()
            dao.upsertOwnedCard(
                OwnedCardEntity(
                    id = copyId,
                    binderId = binderId,
                    externalId = card.id,
                    name = card.name,
                    tcg = card.tcg,
                    setCode = card.setCode,
                    setName = card.setName,
                    rarity = card.rarity,
                    collectorNumber = card.collectorNumber,
                    imageUrl = card.imageUrl,
                    quantity = (existing?.quantity ?: 0) + quantity.coerceAtLeast(1),
                    condition = existing?.condition ?: "Near Mint",
                    price = existing?.price,
                    createdAt = existing?.createdAt ?: System.currentTimeMillis(),
                ),
            )
            copyId
        },
        remote = { api, auth ->
            api.addCard(
                auth,
                binderId,
                AddCardRequest(
                    cardId = card.id,
                    quantity = quantity.coerceAtLeast(1),
                    cardData = CardDataRequest(
                        name = card.name,
                        tcg = card.tcg,
                        externalId = card.id,
                        setCode = card.setCode,
                        setName = card.setName,
                        rarity = card.rarity,
                        collectorNumber = card.collectorNumber,
                        imageUrl = card.imageUrl,
                        imageUrlSmall = card.imageUrl,
                    ),
                ),
            ).createdCopyId
        },
    )

    override suspend fun removeCard(binderId: String, ownedCardId: String) = withSource(
        local = { dao.deleteOwnedCard(binderId, ownedCardId) },
        remote = { api, auth -> api.removeCard(auth, binderId, ownedCardId) },
    )

    override suspend fun getWishlists(): List<Wishlist> = withSource(
        local = { dao.getWishlists().map { it.toDomain(dao) } },
        remote = { api, auth -> api.getWishlists(auth).map(WishlistDto::toDomain) },
    )

    override suspend fun createWishlist(name: String): Wishlist = withSource(
        local = {
            val now = System.currentTimeMillis()
            val entity = WishlistEntity(UUID.randomUUID().toString(), name.trim(), null, "C43D73", now, now)
            dao.upsertWishlist(entity)
            WishlistWithCards(entity, emptyList()).toDomain(dao)
        },
        remote = { api, auth -> api.createWishlist(auth, CreateWishlistRequest(name.trim())).toDomain() },
    )

    override suspend fun deleteWishlist(id: String) = withSource(
        local = { dao.deleteWishlist(id) },
        remote = { api, auth -> api.deleteWishlist(auth, id) },
    )

    override suspend fun addWishlistCard(wishlistId: String, card: CatalogCard) = withSource(
        local = {
            dao.insertWishlistCard(
                WishlistCardEntity(
                    id = UUID.randomUUID().toString(),
                    wishlistId = wishlistId,
                    externalId = card.id,
                    name = card.name,
                    tcg = card.tcg,
                    setCode = card.setCode,
                    setName = card.setName,
                    rarity = card.rarity,
                    collectorNumber = card.collectorNumber,
                    imageUrl = card.imageUrl,
                    desiredQuantity = 1,
                    notes = null,
                    createdAt = System.currentTimeMillis(),
                ),
            )
        },
        remote = { api, auth ->
            api.addWishlistCard(
                auth,
                wishlistId,
                AddWishlistCardRequest(
                    externalId = card.id,
                    tcg = card.tcg,
                    name = card.name,
                    setCode = card.setCode,
                    setName = card.setName,
                    rarity = card.rarity,
                    collectorNumber = card.collectorNumber,
                    imageUrl = card.imageUrl,
                    imageUrlSmall = card.imageUrl,
                ),
            )
            Unit
        },
    )

    override suspend fun getSealedInventory(): List<SealedInventoryItem> = withSource(
        // Sealed inventory is a server ledger. Android deliberately does not fabricate a local ledger.
        local = { emptyList() },
        remote = { api, auth -> api.getSealedInventory(auth).map(SealedInventoryItemDto::toDomain) },
    )

    override suspend fun createSealedOpening(
        inventoryId: String,
        openedQuantity: Int,
        collectionIds: List<String>,
        openedAt: String?,
        notes: String?,
    ): SealedOpeningRecord = withServer { api, auth ->
        api.createSealedOpening(
            auth,
            inventoryId,
            CreateSealedOpeningRequest(
                openedQuantity = openedQuantity.coerceAtLeast(1),
                collectionIds = collectionIds,
                openedAt = openedAt,
                notes = notes,
            ),
        ).toDomain()
    }

    override suspend fun verifyServer(url: String): Result<Unit> = runCatching {
        check(remoteFactory.create(url).health().status == "ok") { "Server did not report a healthy status" }
    }

    override suspend fun signIn(url: String, username: String, password: String): Result<SignInResult> = runCatching {
        val response = remoteFactory.create(url).signIn(SignInRequest(username.trim(), password))
        val token = requireNotNull(response.token) { "Server response did not include a session token" }
        val resolvedName = response.user?.username ?: username.trim()
        preferencesStore.saveSession(token, resolvedName)
        SignInResult(resolvedName, token)
    }

    private suspend fun <T> withSource(
        local: suspend () -> T,
        remote: suspend (com.ahmadjalil.tcger.data.remote.TCGerApi, String) -> T,
    ): T {
        val settings = preferencesStore.current()
        if (settings.dataSourceMode == DataSourceMode.ON_DEVICE) return local()
        val token = requireNotNull(settings.authToken) { "Sign in to the configured server first" }
        return remote(remoteFactory.create(settings.serverUrl), "Bearer $token")
    }

    private suspend fun <T> withServer(
        block: suspend (com.ahmadjalil.tcger.data.remote.TCGerApi, String) -> T,
    ): T {
        val settings = preferencesStore.current()
        val token = requireNotNull(settings.authToken) { "Sign in to the configured server first" }
        require(settings.serverUrl.isNotBlank()) { "Configure a scanner server first" }
        return block(remoteFactory.create(settings.serverUrl), "Bearer $token")
    }
}

private fun OwnedCardEntity.toCatalogCard() = CatalogCard(
    id = externalId,
    name = name,
    tcg = tcg,
    setCode = setCode,
    setName = setName,
    rarity = rarity,
    collectorNumber = collectorNumber,
    imageUrl = imageUrl,
)

private fun BinderWithCards.toDomain() = Binder(
    id = binder.id,
    name = binder.name,
    description = binder.description,
    colorHex = binder.colorHex,
    cards = cards.map { entity ->
        OwnedCard(entity.id, entity.binderId, entity.toCatalogCard(), entity.quantity, entity.condition, entity.price)
    },
    createdAt = binder.createdAt,
    updatedAt = binder.updatedAt,
)

private suspend fun WishlistWithCards.toDomain(dao: TCGerDao) = Wishlist(
    id = wishlist.id,
    name = wishlist.name,
    description = wishlist.description,
    colorHex = wishlist.colorHex,
    cards = cards.map { entity ->
        WishlistCard(
            id = entity.id,
            card = CatalogCard(
                entity.externalId,
                entity.name,
                entity.tcg,
                entity.setCode,
                entity.setName,
                entity.rarity,
                entity.collectorNumber,
                entity.imageUrl,
            ),
            desiredQuantity = entity.desiredQuantity,
            ownedQuantity = dao.ownedQuantity(entity.externalId),
            notes = entity.notes,
        )
    },
)

private fun CardDto.toDomain() = CatalogCard(
    id, name, tcg, setCode, setName, rarity, collectorNumber, imageUrlSmall ?: imageUrl,
)

private fun ScanMatchDto.toDomain() = CatalogCard(
    id = externalId,
    name = name,
    tcg = tcg,
    setCode = setCode,
    setName = setName,
    rarity = rarity,
    imageUrl = imageUrl,
)

private fun CardEmbeddingMetadata.toDomain() = CatalogCard(
    id = cardId,
    name = name,
    tcg = game ?: "pokemon",
    setCode = setCode,
    setName = setName,
    rarity = rarity,
    collectorNumber = cardId.substringAfter('-', "").ifBlank { null },
    imageUrl = imageURL,
)

private fun DinoV2RecognitionResult.toCardScanResult(
    engine: String,
    recognizedText: String? = null,
) = CardScanResult(
    candidates = matches.take(5).map { match -> CardScanCandidate(match.card.toDomain(), match.similarity) },
    source = CardScanSource.ON_DEVICE_EMBEDDING,
    recognizedText = recognizedText,
    engine = engine,
    elapsedMs = preprocessMs + inferenceMs + searchMs,
)

private fun ScanDebugCaptureSummaryDto.toDomain() = ScanDebugCapture(
    id = id,
    requestedTcg = requestedTcg,
    captureSource = captureSource,
    sourceImageUrl = sourceImageUrl,
    feedbackStatus = ScanDebugFeedbackStatus.entries.firstOrNull { it.apiValue == feedbackStatus }
        ?: ScanDebugFeedbackStatus.UNREVIEWED,
    reviewTags = reviewTags.mapNotNull { value ->
        ScanDebugReviewTag.entries.firstOrNull { it.apiValue == value }
    }.toSet(),
    notes = notes,
    createdAt = createdAt,
    bestMatchName = bestMatch?.name,
    bestMatchCardId = bestMatch?.externalId,
    bestMatchConfidence = bestMatch?.confidence,
    artifactImageUrls = listOfNotNull(
        artifactImages.correctedImageUrl,
        artifactImages.artworkImageUrl,
        artifactImages.titleImageUrl,
        artifactImages.footerImageUrl,
    ).distinct(),
)

private fun BinderDto.toDomain() = Binder(
    id = id,
    name = name,
    description = description,
    colorHex = colorHex ?: "315DA8",
    cards = cards.map { remote ->
        val catalog = CatalogCard(
            remote.externalId ?: remote.cardId ?: remote.id,
            remote.name,
            remote.tcg,
            remote.setCode,
            remote.setName,
            remote.rarity,
            remote.collectorNumber,
            remote.imageUrlSmall ?: remote.imageUrl,
        )
        OwnedCard(remote.id, id, catalog, remote.quantity, remote.condition, remote.price)
    },
)

private fun WishlistDto.toDomain() = Wishlist(
    id = id,
    name = name,
    description = description,
    colorHex = colorHex ?: "C43D73",
    cards = cards.map { remote ->
        WishlistCard(
            id = remote.id,
            card = CatalogCard(
                remote.externalId,
                remote.name,
                remote.tcg,
                remote.setCode,
                remote.setName,
                remote.rarity,
                remote.collectorNumber,
                remote.imageUrlSmall ?: remote.imageUrl,
            ),
            desiredQuantity = remote.desiredQuantity,
            ownedQuantity = remote.ownedQuantity,
            notes = remote.notes,
        )
    },
)

private fun SealedInventoryItemDto.toDomain() = SealedInventoryItem(
    id = id,
    product = SealedProduct(
        id = product.id,
        tcg = product.tcg,
        name = product.name,
        productType = product.productType,
        setCode = product.setCode,
        cardsPerPack = product.cardsPerPack,
        packsPerBox = product.packsPerBox,
        releaseDate = product.releaseDate,
        imageUrl = product.imageUrl,
        msrp = product.msrp,
        upc = product.upc,
        isCustom = product.isCustom,
    ),
    quantity = quantity,
    purchasePrice = purchasePrice,
    purchaseDate = purchaseDate,
    notes = notes,
    createdAt = createdAt,
)

private fun SealedOpeningDto.toDomain() = SealedOpeningRecord(
    id = id,
    sealedInventoryId = sealedInventoryId,
    openedQuantity = openedQuantity,
    openedAt = openedAt,
    notes = notes,
    createdAt = createdAt,
)
