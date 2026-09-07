package com.ahmadjalil.tcger.data.repository

import android.content.Context
import com.ahmadjalil.tcger.data.local.BinderEntity
import com.ahmadjalil.tcger.data.local.BinderWithCards
import com.ahmadjalil.tcger.data.local.OwnedCardEntity
import com.ahmadjalil.tcger.data.local.SealedInventoryEntity
import com.ahmadjalil.tcger.data.local.SealedInventoryWithProduct
import com.ahmadjalil.tcger.data.local.SealedOpeningEntity
import com.ahmadjalil.tcger.data.local.SealedProductEntity
import com.ahmadjalil.tcger.data.local.TCGerDao
import com.ahmadjalil.tcger.data.local.WishlistCardEntity
import com.ahmadjalil.tcger.data.local.WishlistEntity
import com.ahmadjalil.tcger.data.local.WishlistWithCards
import com.ahmadjalil.tcger.data.preferences.PreferencesStore
import com.ahmadjalil.tcger.data.remote.AddCardRequest
import com.ahmadjalil.tcger.data.remote.AddSealedInventoryRequest
import com.ahmadjalil.tcger.data.remote.AddWishlistCardRequest
import com.ahmadjalil.tcger.data.remote.BinderDto
import com.ahmadjalil.tcger.data.remote.BinderShareLinkDto
import com.ahmadjalil.tcger.data.remote.CreateBinderShareLinkRequest
import com.ahmadjalil.tcger.data.remote.CardDataRequest
import com.ahmadjalil.tcger.data.remote.CardDto
import com.ahmadjalil.tcger.data.remote.CreateBinderRequest
import com.ahmadjalil.tcger.data.remote.CreateSealedOpeningRequest
import com.ahmadjalil.tcger.data.remote.WishlistRequest
import com.ahmadjalil.tcger.data.remote.RemoteServiceFactory
import com.ahmadjalil.tcger.data.remote.ScanMatchDto
import com.ahmadjalil.tcger.data.remote.SealedInventoryItemDto
import com.ahmadjalil.tcger.data.remote.SealedOpeningDto
import com.ahmadjalil.tcger.data.remote.SealedOpeningLedgerDto
import com.ahmadjalil.tcger.data.remote.SealedProductDto
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
import com.ahmadjalil.tcger.data.scanner.model.CardEmbeddingMatch
import com.ahmadjalil.tcger.data.scanner.model.CardPrintingResolver
import com.ahmadjalil.tcger.data.scanner.model.ScannerAssetStore
import com.ahmadjalil.tcger.data.scanner.model.normalizeScannerGame
import com.ahmadjalil.tcger.domain.Binder
import com.ahmadjalil.tcger.domain.BinderInput
import com.ahmadjalil.tcger.domain.BinderShareLink
import com.ahmadjalil.tcger.domain.hasValidCoverUrl
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
import com.ahmadjalil.tcger.domain.CatalogScanDecision
import com.ahmadjalil.tcger.domain.DataSourceMode
import com.ahmadjalil.tcger.domain.OwnedCard
import com.ahmadjalil.tcger.domain.SealedInventoryItem
import com.ahmadjalil.tcger.domain.SealedOpeningRecord
import com.ahmadjalil.tcger.domain.SealedOpeningLedger
import com.ahmadjalil.tcger.domain.SealedLedgerCard
import com.ahmadjalil.tcger.domain.SealedProduct
import com.ahmadjalil.tcger.domain.SignInResult
import com.ahmadjalil.tcger.domain.TCGerRepository
import com.ahmadjalil.tcger.domain.Wishlist
import com.ahmadjalil.tcger.domain.WishlistCard
import com.ahmadjalil.tcger.domain.WishlistInput
import com.ahmadjalil.tcger.domain.WishlistRule
import com.ahmadjalil.tcger.domain.CollectionEdit
import com.ahmadjalil.tcger.domain.CollectionDetails
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import com.ahmadjalil.tcger.data.backup.*
import java.util.UUID
import java.time.Instant
import kotlinx.coroutines.async
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import kotlinx.serialization.json.JsonNull
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

class DefaultTCGerRepository(
    private val applicationContext: Context,
    private val dao: TCGerDao,
    private val preferencesStore: PreferencesStore,
    private val remoteFactory: RemoteServiceFactory,
    private val textRecognizer: OnDeviceCardTextRecognizer,
    private val scannerAssetStore: ScannerAssetStore,
) : TCGerRepository {
    private val recoveryFile get() = java.io.File(applicationContext.filesDir, "collection-recovery.json")

    private val backupSections by lazy { BackupSectionsStore(applicationContext) }
    private val backupMutex = kotlinx.coroutines.sync.Mutex()
    private val importJournal get() = java.io.File(applicationContext.filesDir, "collection-import-journal.json")
    private val startupRecovery by lazy {
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + Dispatchers.IO).async {
            if (importJournal.exists()) {
                restoreLocalSnapshot(Json.decodeFromString<LocalCollectionSnapshot>(importJournal.readText()))
                check(importJournal.delete()) { "Could not finish interrupted import recovery" }
            }
        }
    }
    private suspend fun restoreLocalSnapshot(snapshot: LocalCollectionSnapshot) {
        backupSections.apply(snapshot.sections, merge = false)
        dao.restoreSnapshot(snapshot)
        snapshot.sections["androidPreferences"]?.jsonObject?.let { preferencesStore.restorePortablePreferences(it) }
    }
    private fun writeSnapshot(file: java.io.File, snapshot: LocalCollectionSnapshot) {
        val temp = java.io.File(file.path + ".tmp")
        java.io.FileOutputStream(temp).use { output ->
            output.write(Json.encodeToString(snapshot).toByteArray()); output.fd.sync()
        }
        check(temp.renameTo(file)) { "Could not create a recovery point; no data was imported" }
    }

    override suspend fun eraseLocalCardsAndBinders() = backupMutex.withLock {
        startupRecovery.await()
        check(preferencesStore.current().dataSourceMode == DataSourceMode.ON_DEVICE) { "Switch to on-device storage before erasing local cards." }
        val before = dao.snapshot().copy(sections = withContext(Dispatchers.IO) { JsonObject(backupSections.snapshot() + ("androidPreferences" to preferencesStore.portablePreferences())) })
        withContext(Dispatchers.IO) { writeSnapshot(recoveryFile, before); writeSnapshot(importJournal, before) }
        try { dao.clearBinders(); withContext(Dispatchers.IO) { check(importJournal.delete()) } }
        catch (error: Throwable) { withContext(kotlinx.coroutines.NonCancellable + Dispatchers.IO) { restoreLocalSnapshot(before); check(importJournal.delete()) }; throw error }
    }

    override suspend fun exportBackup(): String = withSource(
        local = {
            val sections = withContext(Dispatchers.IO) { backupSections.snapshot() }
            val allSections = kotlinx.serialization.json.JsonObject(sections + ("androidPreferences" to preferencesStore.portablePreferences()) + ("androidSealedOpenings" to Json.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(SealedOpeningEntity.serializer()), dao.getSealedOpenings())))
            CollectionBackupJson.encode(CollectionBackupJson.create(getBinders(), getWishlists(), getSealedInventory()).copy(sections = allSections))
        },
        remote = { api, auth -> api.exportBackup(auth).toString() },
    )

    override suspend fun importBackup(raw: String) = backupMutex.withLock {
        startupRecovery.await()
        val backup = if (raw.trimStart().startsWith("{")) CollectionBackupJson.decode(raw) else parseCollectionCsv(raw)
        if (preferencesStore.current().dataSourceMode == DataSourceMode.SERVER) {
            withSource(local = { Unit }, remote = { api, auth -> api.importBackup(auth, Json.parseToJsonElement(CollectionBackupJson.encode(backup)).jsonObject); Unit })
            return@withLock
        }
        withContext(Dispatchers.IO) { backupSections.validate(backup.sections) }
        ensureLocalSealedCatalog()
        val plan = backup.importPlan(dao.getSealedProducts())
        val before = dao.snapshot().copy(sections = withContext(Dispatchers.IO) { backupSections.snapshot() }.let { kotlinx.serialization.json.JsonObject(it + ("androidPreferences" to preferencesStore.portablePreferences())) })
        withContext(Dispatchers.IO) { writeSnapshot(recoveryFile, before); writeSnapshot(importJournal, before) }
        try {
            withContext(Dispatchers.IO) { backupSections.apply(backup.sections) }
            dao.mergeSnapshot(plan)
            backup.sections["preferences"]?.jsonObject?.let { preferencesStore.applyServerPreferences(it) }
            backup.sections["androidPreferences"]?.jsonObject?.let { preferencesStore.restorePortablePreferences(it) }
            withContext(Dispatchers.IO) { check(importJournal.delete()) { "Could not finish import" } }
        } catch (error: Throwable) {
            withContext(kotlinx.coroutines.NonCancellable + Dispatchers.IO) { restoreLocalSnapshot(before); check(importJournal.delete()) { "Recovery journal could not be cleared" } }
            throw error
        }
    }

    override suspend fun restoreLatestRecoveryPoint() = backupMutex.withLock {
        startupRecovery.await()
        if (preferencesStore.current().dataSourceMode == DataSourceMode.SERVER) {
            withSource(local = { Unit }, remote = { api, auth -> api.restoreBackup(auth); Unit })
            return@withLock
        }
        val snapshot = withContext(Dispatchers.IO) { Json.decodeFromString<LocalCollectionSnapshot>(recoveryFile.readText()) }
        val previous = dao.snapshot().copy(sections = withContext(Dispatchers.IO) { JsonObject(backupSections.snapshot() + ("androidPreferences" to preferencesStore.portablePreferences())) })
        withContext(Dispatchers.IO) { writeSnapshot(importJournal, previous) }
        try {
            withContext(Dispatchers.IO) { restoreLocalSnapshot(snapshot); check(importJournal.delete()) }
        } catch (error: Throwable) {
            withContext(kotlinx.coroutines.NonCancellable + Dispatchers.IO) { restoreLocalSnapshot(previous); check(importJournal.delete()) }
            throw error
        }
    }

    private val downloadedArcFaceRecognizers = mutableMapOf<String, ArcFaceCardRecognizer>()
    @Volatile private var dinoV2Recognizer: DinoV2CardRecognizer? = null
    override suspend fun getBinders(): List<Binder> = withSource(
        local = { dao.getBinders().map(BinderWithCards::toDomain) },
        remote = { api, auth -> api.getBinders(auth).map(BinderDto::toDomain) },
    )

    override suspend fun createBinder(input: BinderInput): Binder {
        val details = input.normalized()
        require(details.name.isNotBlank()) { "Binder name is required" }
        require(details.hasValidCoverUrl) { "Cover image URL must start with http or https" }
        return withSource(
            local = {
                val now = System.currentTimeMillis()
                val entity = BinderEntity(
                    id = UUID.randomUUID().toString(),
                    name = details.name,
                    description = details.description,
                    colorHex = details.colorHex,
                    defaultCondition = details.defaultCondition,
                    containerType = details.containerType,
                    imageUrl = details.imageUrl,
                    associatedTcg = details.associatedTcg,
                    associatedSetCode = details.associatedSetCode,
                    associatedSetName = details.associatedSetName,
                    createdAt = now,
                    updatedAt = now,
                )
                dao.upsertBinder(entity)
                BinderWithCards(entity, emptyList()).toDomain()
            },
            remote = { api, auth ->
                api.createBinder(
                    auth,
                    CreateBinderRequest(
                        name = details.name,
                        description = details.description,
                        colorHex = details.colorHex,
                        defaultCondition = details.defaultCondition,
                        containerType = details.containerType,
                        imageUrl = details.imageUrl,
                        associatedTcg = details.associatedTcg,
                        associatedSetCode = details.associatedSetCode,
                        associatedSetName = details.associatedSetName,
                    ),
                ).toDomain()
            },
        )
    }

    override suspend fun updateBinder(id: String, input: BinderInput): Binder {
        val details = input.normalized()
        require(details.name.isNotBlank()) { "Binder name is required" }
        require(details.hasValidCoverUrl) { "Cover image URL must start with http or https" }
        return withSource(
            local = {
                val existing = requireNotNull(dao.getBinder(id)) { "Binder not found" }
                val entity = existing.copy(
                    name = details.name,
                    description = details.description,
                    colorHex = details.colorHex,
                    defaultCondition = details.defaultCondition,
                    containerType = details.containerType,
                    imageUrl = details.imageUrl,
                    associatedTcg = details.associatedTcg,
                    associatedSetCode = details.associatedSetCode,
                    associatedSetName = details.associatedSetName,
                    updatedAt = System.currentTimeMillis(),
                )
                dao.updateBinder(entity)
                dao.getBinders().first { it.binder.id == id }.toDomain()
            },
            remote = { api, auth ->
                api.updateBinder(
                    auth,
                    id,
                    buildJsonObject {
                        put("name", JsonPrimitive(details.name))
                        details.description?.let { put("description", JsonPrimitive(it)) }
                        put("colorHex", JsonPrimitive(details.colorHex))
                        put("defaultCondition", JsonPrimitive(details.defaultCondition.orEmpty()))
                        put("containerType", details.containerType?.let(::JsonPrimitive) ?: JsonNull)
                        put("imageUrl", details.imageUrl?.let(::JsonPrimitive) ?: JsonNull)
                    },
                ).toDomain()
            },
        )
    }

    override suspend fun deleteBinder(id: String) = withSource(
        local = {
            val now = System.currentTimeMillis()
            dao.archiveBinder(
                id,
                BinderEntity(
                    id = "__library__",
                    name = "Unsorted Library",
                    description = "Cards not yet assigned to a binder",
                    colorHex = "#9E9E9E",
                    defaultCondition = null,
                    containerType = null,
                    imageUrl = null,
                    associatedTcg = null,
                    associatedSetCode = null,
                    associatedSetName = null,
                    createdAt = now,
                    updatedAt = now,
                ),
            )
        },
        remote = { api, auth -> api.deleteBinder(auth, id) },
    )

    override suspend fun getBinderShareLinks(id: String): List<BinderShareLink> = withSource(
        local = { emptyList() },
        remote = { api, auth -> api.getBinderShareLinks(auth, id).map(BinderShareLinkDto::toDomain) },
    )

    override suspend fun createBinderShareLink(id: String, label: String): BinderShareLink = withSource(
        local = { error("Share links require a connected server") },
        remote = { api, auth -> api.createBinderShareLink(auth, id, CreateBinderShareLinkRequest(label.trim())).toDomain() },
    )

    override suspend fun revokeBinderShareLink(id: String, linkId: String) = withSource(
        local = { error("Share links require a connected server") },
        remote = { api, auth -> api.revokeBinderShareLink(auth, id, linkId) },
    )

    override suspend fun searchCards(query: String, tcg: String?): List<CatalogCard> = withSource(
        local = {
            dao.searchOwnedCards(query.trim())
                .asSequence()
                .filter { tcg == null || it.tcg == tcg }
                .distinctBy { "${it.tcg}:${it.externalId}" }
                .map(OwnedCardEntity::toCatalogCard)
                .toList()
        },
        remote = { api, auth -> api.searchCards(auth, query.trim(), tcg).cards.map(CardDto::toDomain) },
    )

    override suspend fun cardPrints(card: CatalogCard): List<CatalogCard> = withSource(
        local = { searchCards(card.name, card.tcg).filter { it.name.equals(card.name, true) } },
        remote = { api, auth -> api.cardPrints(auth, card.tcg, card.id).prints.map(CardDto::toDomain) },
    )

    override suspend fun discoverCards(tcg: String?, count: Int): List<CatalogCard> = withSource(
        local = {
            dao.getBinders()
                .flatMap { it.cards }
                .asSequence()
                .filter { tcg == null || it.tcg == tcg }
                .distinctBy { "${it.tcg}:${it.externalId}" }
                .map(OwnedCardEntity::toCatalogCard)
                .shuffled()
                .take(count.coerceIn(1, 24))
                .toList()
        },
        remote = { api, auth -> api.discoverCards(auth, tcg, count.coerceIn(1, 24)).cards.map(CardDto::toDomain) },
    )

    override suspend fun scanCard(imageBytes: ByteArray, tcg: String, options: CardScanOptions): CardScanResult {
        require(imageBytes.isNotEmpty()) { "Capture or choose a card image first" }
        val settings = preferencesStore.current()
        var serverFailure: Throwable? = null

        when (LocalEmbeddingDispatch.select(tcg, options)) {
        LocalEmbeddingModel.ARCFACE -> {
            var localResult: com.ahmadjalil.tcger.data.scanner.model.ArcFaceRecognitionResult? = null
            var localRecognizer: ArcFaceCardRecognizer? = null
            runCatching {
                getArcFaceRecognizer(tcg).also { localRecognizer = it }.let { recognizer ->
                    withContext(Dispatchers.Default) {
                        recognizer.recognize(imageBytes, setCode = options.setCodeHint)
                    }
                }
            }.onSuccess { local ->
                localResult = local
                if (local.decision is ArcFaceRecognitionDecision.Accepted) {
                    val printing = resolvePrintingMatches(local.matches, options.printingMode)
                    return CardScanResult(
                        candidates = printing.matches.take(5).map { match ->
                            CardScanCandidate(match.card.toDomain(), match.similarity)
                        },
                        source = CardScanSource.ON_DEVICE_EMBEDDING,
                        engine = "arcface",
                        elapsedMs = local.preprocessMs + local.inferenceMs + local.searchMs,
                        printingResolutionProvenance = printing.provenance,
                        requiresPrintingChoice = printing.requiresChoice,
                    )
                }
            }.onFailure { error ->
                if (options.engine == CardScanEngine.ON_DEVICE_OCR) serverFailure = error
            }
            val hubRejected = (localResult?.decision as? ArcFaceRecognitionDecision.Rejected)?.reason ==
                ArcFaceRecognitionDecision.Rejected.Reason.HUB
            if (localRecognizer?.acceptancePolicy?.permitsManualOcrRescue == true &&
                localResult?.decision !is ArcFaceRecognitionDecision.Accepted &&
                !hubRejected &&
                LocalEmbeddingDispatch.permitsManualOcrRescue(options)
            ) {
                val evidence = runCatching { textRecognizer.recognizeEmbeddingEvidence(imageBytes) }
                    .getOrElse { error ->
                        if (options.engine == CardScanEngine.ON_DEVICE_OCR) throw error
                        serverFailure = error
                        null
                    }
                if (evidence != null) {
                    when (val rescue = localRecognizer?.rescueManualCapture(
                        checkNotNull(localResult),
                        evidence,
                    )) {
                        is DinoV2OcrRescueDecision.Accepted -> {
                            val local = checkNotNull(localResult)
                            val reordered = listOf(rescue.match) + local.matches.filter {
                                it.card.cardId != rescue.match.card.cardId
                            }
                            val printing = resolvePrintingMatches(
                                reordered,
                                options.printingMode,
                                rescue.match.card.exactPrintingId ?: rescue.match.card.cardId,
                            )
                            return CardScanResult(
                                candidates = printing.matches.take(5).map { match ->
                                    CardScanCandidate(match.card.toDomain(), match.similarity)
                                },
                                source = CardScanSource.ON_DEVICE_EMBEDDING,
                                engine = "arcface-ocr-rescue",
                                recognizedText = rescue.recognizedText,
                                printingResolutionProvenance = printing.provenance,
                                requiresPrintingChoice = printing.requiresChoice,
                            )
                        }
                        is DinoV2OcrRescueDecision.Rejected, null -> Unit
                    }
                }
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
                    withContext(Dispatchers.Default) {
                        recognizer.recognize(imageBytes, setCode = options.setCodeHint)
                    }
                }.getOrElse { error ->
                    if (options.engine == CardScanEngine.ON_DEVICE_OCR) throw error
                    serverFailure = error
                    null
                }
                if (local != null) {
                    val accepted = local.decision as? DinoV2RecognitionDecision.Accepted
                    if (accepted != null) {
                        return local.toCardScanResult(
                            engine = "dinov2",
                            printingMode = options.printingMode,
                        )
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
                                        printingMode = options.printingMode,
                                        verifiedExactPrintingId = rescue.match.card.exactPrintingId
                                            ?: rescue.match.card.cardId,
                                    )
                                }
                                is DinoV2OcrRescueDecision.Rejected -> Unit
                            }
                        }
                    }
                    if (options.engine == CardScanEngine.ON_DEVICE_OCR) {
                        throw IllegalArgumentException(
                            if (!options.ocrEnabled) {
                                "DINOv2 could not accept a visual match. OCR is disabled in Settings."
                            } else if (LocalEmbeddingDispatch.permitsManualOcrRescue(options)) {
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
                    setCodeHint = options.setCodeHint.orEmpty().trim().toRequestBody(textBody),
                )
            }.onSuccess { response ->
                val catalogDecision = response.meta?.catalogDecision?.let {
                    CatalogScanDecision(
                        accepted = it.accepted,
                        reason = it.reason,
                        topConfidence = it.topConfidence,
                        runnerUpConfidence = it.runnerUpConfidence,
                    )
                }
                if (catalogDecision?.accepted == false) {
                    return CardScanResult(
                        candidates = emptyList(),
                        source = CardScanSource.SERVER_IMAGE_MATCH,
                        engine = response.meta?.engine ?: options.engine.apiValue,
                        elapsedMs = response.meta?.timings?.totalMs,
                        debugCaptureId = response.debugCapture?.id,
                        debugCaptureError = response.debugCaptureError,
                        catalogDecision = catalogDecision,
                    )
                }
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
                        catalogDecision = catalogDecision,
                    )
                }
            }.onFailure { serverFailure = it }
        }

        if (!options.ocrEnabled) {
            throw serverFailure ?: IllegalArgumentException(
                "No visual scanner match was accepted. OCR is disabled in Settings.",
            )
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

    private fun getArcFaceRecognizer(game: String): ArcFaceCardRecognizer {
        val normalized = normalizeScannerGame(game)
        val runtime = scannerAssetStore.installedRuntime(normalized)
        requireNotNull(runtime) {
            "Install the ${normalized.replaceFirstChar(Char::uppercase)} offline scanner model first"
        }
        val existing = synchronized(downloadedArcFaceRecognizers) {
            downloadedArcFaceRecognizers[normalized]
        }
        if (existing?.artifactVersion == runtime.contract.version) return existing
        return synchronized(downloadedArcFaceRecognizers) {
            val current = downloadedArcFaceRecognizers[normalized]
            if (current?.artifactVersion == runtime.contract.version) {
                current
            } else {
                current?.close()
                ArcFaceCardRecognizer.load(applicationContext, normalized, scannerAssetStore).also {
                    downloadedArcFaceRecognizers[normalized] = it
                }
            }
        }
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

    override suspend fun addCard(binderId: String, card: CatalogCard, quantity: Int): String? {
        val condition = if (preferencesStore.current().dataSourceMode == DataSourceMode.ON_DEVICE) dao.getBinder(binderId)?.defaultCondition else null
        return addCardWithDetails(binderId, card, quantity, CollectionEdit(condition = condition))
    }

    override suspend fun addCardWithDetails(binderId: String, card: CatalogCard, quantity: Int, edit: CollectionEdit): String? {
        edit.validate()
        require(quantity in 1..10000) { "Quantity must be between 1 and 10000" }
        return withSource(
        local = {
            val binder = requireNotNull(dao.getBinder(binderId)) { "Binder not found" }
            val copies = List(quantity) {
                OwnedCardEntity(
                    id = UUID.randomUUID().toString(), binderId = binderId,
                    externalId = card.id, name = card.name, tcg = card.tcg,
                    setCode = card.setCode, setName = card.setName, rarity = card.rarity,
                    collectorNumber = card.collectorNumber, imageUrl = card.imageUrl,
                    quantity = 1, condition = edit.condition,
                    price = edit.price, acquisitionPrice = edit.acquisitionPrice,
                    detailsJson = Json.encodeToString(edit.details), createdAt = System.currentTimeMillis(),
                )
            }
            dao.insertCopies(copies)
            copies.first().id
        },
        remote = { api, auth ->
            api.addCard(
                auth,
                binderId,
                AddCardRequest(
                    cardId = card.id,
                    quantity = quantity,
                    condition = edit.condition, price = edit.price, acquisitionPrice = edit.acquisitionPrice,
                    details = edit.details,
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
                ).payload(),
            ).createdCopyId
        },
    )
    }

    override suspend fun updateCard(binderId: String, copyId: String, edit: CollectionEdit, targetBinderId: String?) {
        edit.validate()
        withSource(
            local = {
                val existing = requireNotNull(dao.getOwnedCard(binderId, copyId)) { "Collection copy not found" }
                val destination = targetBinderId ?: binderId
                requireNotNull(dao.getBinder(destination)) { "Destination binder not found" }
                dao.upsertOwnedCard(existing.copy(binderId = destination, condition = edit.condition,
                    price = edit.price, acquisitionPrice = edit.acquisitionPrice, detailsJson = Json.encodeToString(edit.details)))
            },
            remote = { api, auth ->
                val codec = Json { encodeDefaults = true; explicitNulls = true }
                val payload = codec.encodeToJsonElement(edit.details).jsonObject.toMutableMap()
                edit.details.acquiredAt?.takeIf { it.length == 10 }?.let { payload["acquiredAt"] = JsonPrimitive(java.time.LocalDate.parse(it).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toString()) }
                payload.remove("imageUrls") // images are managed by the dedicated upload endpoint
                payload["condition"] = edit.condition?.let(::JsonPrimitive) ?: JsonNull
                payload["acquisitionPrice"] = edit.acquisitionPrice?.let(::JsonPrimitive) ?: JsonNull
                payload["tags"] = JsonArray(edit.details.tags.filter { it.id.isNotBlank() }.map { JsonPrimitive(it.id) })
                payload["newTags"] = JsonArray(edit.details.tags.filter { it.id.isBlank() }.map {
                    buildJsonObject { put("label", it.label); put("colorHex", it.colorHex) }
                })
                targetBinderId?.let { payload["targetBinderId"] = JsonPrimitive(it) }
                payload["scope"] = JsonPrimitive("copy")
                api.updateCard(auth, binderId, copyId, JsonObject(payload))
                Unit
            },
        )
    }

    override suspend fun removeCard(binderId: String, ownedCardId: String) = withSource(
        local = { dao.deleteOwnedCard(binderId, ownedCardId) },
        remote = { api, auth -> api.removeCard(auth, binderId, ownedCardId) },
    )

    override suspend fun saveWishlistRule(wishlistId: String, rule: WishlistRule): WishlistRule {
        rule.validate()
        return withSource(
            local = {
                val wishlist = requireNotNull(dao.getWishlist(wishlistId))
                val rules = Json.decodeFromString<List<WishlistRule>>(wishlist.rulesJson)
                val saved = if (rule.id.isBlank()) rule.copy(id = UUID.randomUUID().toString()) else rule
                dao.updateWishlist(wishlist.copy(rulesJson = Json.encodeToString(rules.filterNot { it.id == saved.id } + saved)))
                saved
            },
            remote = { api, auth -> if (rule.id.isBlank()) api.addWishlistRule(auth, wishlistId, rule) else api.updateWishlistRule(auth, wishlistId, rule.id, rule) },
        )
    }

    override suspend fun deleteWishlistRule(wishlistId: String, ruleId: String) = withSource(
        local = {
            val wishlist = requireNotNull(dao.getWishlist(wishlistId))
            val rules = Json.decodeFromString<List<WishlistRule>>(wishlist.rulesJson)
            dao.updateWishlist(wishlist.copy(rulesJson = Json.encodeToString(rules.filterNot { it.id == ruleId })))
        }, remote = { api, auth -> api.deleteWishlistRule(auth, wishlistId, ruleId) },
    )

    override suspend fun resolveWishlistRule(rule: WishlistRule): List<CatalogCard> = withSource(
        local = { dao.getBinders().flatMap { it.cards }.map(OwnedCardEntity::toCatalogCard).filter(rule::matches) },
        remote = { api, auth ->
            fun encode(value: String?) = java.net.URLEncoder.encode(value.orEmpty(), "UTF-8")
            val unique = if (rule.includeAllPrintings) "prints" else "cards"
            val path = when (rule.type) {
                "set" -> "cards/sets/${encode(rule.tcg)}/${encode(rule.setCode)}"
                "artist" -> "cards/search/artist?artist=${encode(rule.query)}&tcg=${encode(rule.tcg)}&unique=$unique&limit=1000"
                "tag" -> "cards/search/tag?tag=${encode(rule.query)}&tcg=${encode(rule.tcg)}"
                else -> "cards/search/all?query=${encode(rule.query)}&unique=$unique&limit=1000" + (rule.tcg?.let { "&tcg=${encode(it)}" } ?: "")
            }
            api.ruleCards(auth, path).cards.map(CardDto::toDomain)
        },
    )

    override suspend fun getWishlists(): List<Wishlist> = withSource(
        local = { dao.getWishlists().map { it.toDomain(dao) } },
        remote = { api, auth -> api.getWishlists(auth).map(WishlistDto::toDomain) },
    )

    override suspend fun createWishlist(input: WishlistInput): Wishlist {
        val normalized = input.normalized()
        require(normalized.name.isNotBlank()) { "Wishlist name is required" }
        return withSource(
            local = {
                val now = System.currentTimeMillis()
                val entity = WishlistEntity(
                    id = UUID.randomUUID().toString(),
                    name = normalized.name,
                    description = normalized.description,
                    colorHex = normalized.colorHex,
                    matchAnyPrinting = normalized.matchAnyPrinting,
                    createdAt = now,
                    updatedAt = now,
                )
                dao.upsertWishlist(entity)
                WishlistWithCards(entity, emptyList()).toDomain(dao)
            },
            remote = { api, auth -> api.createWishlist(auth, normalized.toRemoteRequest()).toDomain() },
        )
    }

    override suspend fun updateWishlist(id: String, input: WishlistInput): Wishlist {
        val normalized = input.normalized()
        require(normalized.name.isNotBlank()) { "Wishlist name is required" }
        return withSource(
            local = {
                val current = requireNotNull(dao.getWishlist(id)) { "Wishlist not found" }
                val updated = current.copy(
                    name = normalized.name,
                    description = normalized.description,
                    colorHex = normalized.colorHex,
                    matchAnyPrinting = normalized.matchAnyPrinting,
                    updatedAt = System.currentTimeMillis(),
                )
                dao.updateWishlist(updated)
                requireNotNull(dao.getWishlists().firstOrNull { it.wishlist.id == id }) { "Wishlist not found" }
                    .toDomain(dao)
            },
            remote = { api, auth -> api.updateWishlist(auth, id, normalized.toRemoteRequest()).toDomain() },
        )
    }

    override suspend fun deleteWishlist(id: String) = withSource(
        local = { dao.deleteWishlist(id) },
        remote = { api, auth -> api.deleteWishlist(auth, id) },
    )

    override suspend fun addWishlistCard(
        wishlistId: String,
        card: CatalogCard,
        desiredQuantity: Int,
        notes: String?,
    ) = withSource(
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
                    desiredQuantity = desiredQuantity.coerceIn(1, 99),
                    notes = notes?.trim()?.ifBlank { null },
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
                    desiredQuantity = desiredQuantity.coerceIn(1, 99),
                ),
            )
            Unit
        },
    )

    override suspend fun removeWishlistCard(wishlistId: String, wishlistCardId: String) = withSource(
        local = { dao.deleteWishlistCard(wishlistId, wishlistCardId) },
        remote = { api, auth -> api.removeWishlistCard(auth, wishlistId, wishlistCardId) },
    )

    override suspend fun getSealedProducts(tcg: String?): List<SealedProduct> = withSource(
        local = {
            ensureLocalSealedCatalog()
            dao.getSealedProducts(tcg).map(SealedProductEntity::toDomain)
        },
        remote = { api, auth -> api.getSealedProducts(auth, tcg).map(SealedProductDto::toDomain) },
    )

    override suspend fun getSealedProductByBarcode(barcode: String): SealedProduct {
        val normalized = barcode.filter(Char::isDigit)
        require(normalized.length in 8..14) { "Barcode must contain 8 to 14 digits" }
        val equivalents = barcodeEquivalents(normalized)
        return withSource(
            local = {
                ensureLocalSealedCatalog()
                requireNotNull(dao.getSealedProductByBarcodes(equivalents)?.toDomain()) {
                    "No sealed product matches this barcode"
                }
            },
            // The current server contract exposes catalog listing consistently;
            // resolve the UPC locally so Android works against both server implementations.
            remote = { api, auth ->
                requireNotNull(api.getSealedProducts(auth).firstOrNull { product ->
                    product.upc?.filter(Char::isDigit) in equivalents
                }?.toDomain()) { "No sealed product matches this barcode" }
            },
        )
    }

    override suspend fun getSealedInventory(): List<SealedInventoryItem> = withSource(
        local = {
            ensureLocalSealedCatalog()
            dao.getSealedInventory().map(SealedInventoryWithProduct::toDomain)
        },
        remote = { api, auth -> api.getSealedInventory(auth).map(SealedInventoryItemDto::toDomain) },
    )

    override suspend fun addSealedInventory(
        productId: String,
        quantity: Int,
        purchasePrice: Double?,
        purchaseDate: String?,
        notes: String?,
    ): SealedInventoryItem {
        require(quantity > 0) { "Quantity must be at least 1" }
        require(purchasePrice == null || purchasePrice >= 0.0) { "Purchase price cannot be negative" }
        return withSource(
            local = {
                ensureLocalSealedCatalog()
                val product = dao.getSealedProducts().firstOrNull { it.id == productId }
                    ?: error("Sealed product not found")
                val now = Instant.now().toString()
                val entity = SealedInventoryEntity(
                    id = UUID.randomUUID().toString(),
                    productId = productId,
                    quantity = quantity,
                    purchasePrice = purchasePrice,
                    purchaseDate = purchaseDate,
                    notes = notes?.trim()?.ifBlank { null },
                    createdAt = now,
                )
                dao.upsertSealedInventory(entity)
                SealedInventoryWithProduct(entity, product).toDomain()
            },
            remote = { api, auth ->
                api.addSealedInventory(
                    auth,
                    AddSealedInventoryRequest(productId, quantity, purchasePrice, purchaseDate, notes?.trim()?.ifBlank { null }),
                ).toDomain()
            },
        )
    }

    override suspend fun updateSealedInventory(
        itemId: String,
        quantity: Int,
        purchasePrice: Double?,
        purchaseDate: String?,
        notes: String?,
    ): SealedInventoryItem {
        require(quantity > 0) { "Quantity must be at least 1" }
        require(purchasePrice == null || purchasePrice >= 0.0) { "Purchase price cannot be negative" }
        return withSource(
            local = {
                val current = requireNotNull(dao.getSealedInventoryItem(itemId)) { "Sealed inventory item not found" }
                val updated = current.inventory.copy(
                    quantity = quantity,
                    purchasePrice = purchasePrice,
                    purchaseDate = purchaseDate,
                    notes = notes?.trim()?.ifBlank { null },
                )
                dao.upsertSealedInventory(updated)
                current.copy(inventory = updated).toDomain()
            },
            remote = { api, auth ->
                val request = sealedInventoryUpdateJson(quantity, purchasePrice, purchaseDate, notes)
                api.updateSealedInventory(auth, itemId, request).toDomain()
            },
        )
    }

    override suspend fun deleteSealedInventory(itemId: String) = withSource(
        local = { dao.deleteSealedInventory(itemId) },
        remote = { api, auth -> api.deleteSealedInventory(auth, itemId) },
    )

    override suspend fun getSealedOpeningLedgers(): List<SealedOpeningLedger> = withSource(
        local = { dao.getSealedOpenings().map(SealedOpeningEntity::toDomain) },
        remote = { api, auth -> api.getSealedOpeningLedgers(auth).map(SealedOpeningLedgerDto::toDomain) },
    )

    override suspend fun createSealedOpening(
        inventoryId: String,
        openedQuantity: Int,
        collectionIds: List<String>,
        openedAt: String?,
        notes: String?,
    ): SealedOpeningRecord {
        require(openedQuantity > 0) { "Opening quantity must be at least 1" }
        return withSource(
            local = {
                val current = requireNotNull(dao.getSealedInventoryItem(inventoryId)) {
                    "Sealed inventory item not found"
                }
                require(openedQuantity <= current.inventory.quantity) {
                    "Opening quantity exceeds the sealed inventory available"
                }
                val now = Instant.now().toString()
                val openedAtValue = openedAt ?: now
                val unitCost = current.inventory.purchasePrice ?: 0.0
                val opening = SealedOpeningEntity(
                    id = UUID.randomUUID().toString(),
                    inventoryId = inventoryId,
                    productId = current.product.id,
                    productName = current.product.name,
                    openedQuantity = openedQuantity,
                    openedAt = openedAtValue,
                    notes = notes?.trim()?.ifBlank { null },
                    invested = unitCost * openedQuantity,
                    linkedCollectionIds = collectionIds.distinct().joinToString(","),
                    createdAt = now,
                )
                dao.recordSealedOpening(opening)
                SealedOpeningRecord(opening.id, inventoryId, openedQuantity, openedAtValue, opening.notes, now)
            },
            remote = { api, auth ->
                api.createSealedOpening(
                    auth,
                    inventoryId,
                    CreateSealedOpeningRequest(
                        openedQuantity = openedQuantity,
                        collectionIds = collectionIds,
                        openedAt = openedAt,
                        notes = notes,
                    ),
                ).toDomain()
            },
        )
    }

    private suspend fun ensureLocalSealedCatalog() {
        if (dao.sealedProductCount() == 0) dao.insertSealedProducts(bundledSealedProducts)
    }

    override suspend fun verifyServer(url: String): Result<Unit> = runCatching {
        check(remoteFactory.create(url).health().status == "ok") { "Server did not report a healthy status" }
    }

    override suspend fun signIn(url: String, username: String, password: String): Result<SignInResult> = runCatching {
        val response = remoteFactory.create(url).signIn(SignInRequest(username.trim(), password))
        val token = requireNotNull(response.token) { "Server response did not include a session token" }
        val resolvedName = response.user?.username ?: username.trim()
        preferencesStore.saveSession(token, resolvedName, response.user?.id)
        SignInResult(resolvedName, token, response.user?.id)
    }

    private suspend fun <T> withSource(
        local: suspend () -> T,
        remote: suspend (com.ahmadjalil.tcger.data.remote.TCGerApi, String) -> T,
    ): T {
        startupRecovery.await()
        val settings = preferencesStore.current()
        if (settings.dataSourceMode == DataSourceMode.ON_DEVICE) return local()
        val token = requireNotNull(settings.authToken) { "Sign in to the configured server first" }
        return remote(remoteFactory.create(settings.serverUrl), "Bearer $token")
    }

    private suspend fun <T> withServer(
        block: suspend (com.ahmadjalil.tcger.data.remote.TCGerApi, String) -> T,
    ): T {
        startupRecovery.await()
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
    defaultCondition = binder.defaultCondition,
    containerType = binder.containerType,
    imageUrl = binder.imageUrl,
    associatedTcg = binder.associatedTcg,
    associatedSetCode = binder.associatedSetCode,
    associatedSetName = binder.associatedSetName,
    cards = cards.map { entity ->
        OwnedCard(entity.id, entity.binderId, entity.toCatalogCard(), entity.quantity, entity.condition, entity.price, entity.acquisitionPrice, Json { ignoreUnknownKeys = true }.decodeFromString<CollectionDetails>(entity.detailsJson))
    },
    createdAt = binder.createdAt,
    updatedAt = binder.updatedAt,
)

private suspend fun WishlistWithCards.toDomain(dao: TCGerDao) = Wishlist(
    id = wishlist.id,
    name = wishlist.name,
    description = wishlist.description,
    colorHex = wishlist.colorHex,
    matchAnyPrinting = wishlist.matchAnyPrinting,
    rules = Json.decodeFromString(wishlist.rulesJson),
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
            ownedQuantity = if (wishlist.matchAnyPrinting) {
                dao.ownedQuantityForAnyPrinting(entity.tcg, entity.name)
            } else {
                dao.ownedQuantity(entity.tcg, entity.externalId)
            },
            notes = entity.notes,
        )
    },
)

private fun CardDto.toDomain() = CatalogCard(
    id = id,
    name = name,
    tcg = tcg,
    setCode = setCode,
    setName = setName,
    rarity = rarity,
    collectorNumber = collectorNumber,
    imageUrl = imageUrlSmall ?: imageUrl,
    artist = artist,
    supertype = supertype,
    setSymbolUrl = setSymbolUrl,
    setLogoUrl = setLogoUrl,
    attributes = attributes.orEmpty().mapValues { (_, value) ->
        when (value) {
            is kotlinx.serialization.json.JsonArray -> value.mapNotNull {
                (it as? kotlinx.serialization.json.JsonPrimitive)?.content
            }
            is kotlinx.serialization.json.JsonPrimitive -> listOf(value.content)
            else -> emptyList()
        }
    },
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
    recognitionFamilyId = recognitionFamilyId,
    exactPrintingId = exactPrintingId ?: cardId,
    releaseDate = releaseDate,
)

private fun DinoV2RecognitionResult.toCardScanResult(
    engine: String,
    recognizedText: String? = null,
    printingMode: com.ahmadjalil.tcger.data.scanner.ScannerPrintingMode,
    verifiedExactPrintingId: String? = null,
): CardScanResult {
    val printing = resolvePrintingMatches(matches, printingMode, verifiedExactPrintingId)
    return CardScanResult(
        candidates = printing.matches.take(5).map { match -> CardScanCandidate(match.card.toDomain(), match.similarity) },
        source = CardScanSource.ON_DEVICE_EMBEDDING,
        recognizedText = recognizedText,
        engine = engine,
        elapsedMs = preprocessMs + inferenceMs + searchMs,
        printingResolutionProvenance = printing.provenance,
        requiresPrintingChoice = printing.requiresChoice,
    )
}

private data class ResolvedPrintingMatches(
    val matches: List<CardEmbeddingMatch>,
    val provenance: String,
    val requiresChoice: Boolean,
)

private fun resolvePrintingMatches(
    matches: List<CardEmbeddingMatch>,
    mode: com.ahmadjalil.tcger.data.scanner.ScannerPrintingMode,
    verifiedExactPrintingId: String? = null,
): ResolvedPrintingMatches {
    val primary = matches.firstOrNull()
        ?: return ResolvedPrintingMatches(emptyList(), "unresolved", false)
    val decision = CardPrintingResolver.resolve(
        primary = primary,
        candidates = matches.drop(1),
        mode = mode,
        verifiedExactPrintingId = verifiedExactPrintingId,
    )
    val ordered = if (decision.selected != null) {
        listOf(decision.selected) + matches.filter { it.index != decision.selected.index }
    } else {
        decision.candidates + matches.filter { candidate ->
            decision.candidates.none { it.index == candidate.index }
        }
    }
    return ResolvedPrintingMatches(
        matches = ordered,
        provenance = decision.provenance.transportValue,
        requiresChoice = decision.requiresSelection,
    )
}

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

internal fun BinderDto.toDomain() = Binder(
    id = id,
    name = name,
    description = description,
    colorHex = colorHex ?: "315DA8",
    defaultCondition = defaultCondition,
    containerType = containerType,
    imageUrl = imageUrl,
    associatedTcg = associatedTcg,
    associatedSetCode = associatedSetCode,
    associatedSetName = associatedSetName,
    cards = cards.flatMap { remote ->
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
        if (remote.copies.isEmpty()) listOf(OwnedCard(remote.id, id, catalog, remote.quantity, remote.condition, remote.price, remote.acquisitionPrice))
        else remote.copies.map { copy -> OwnedCard(copy.id, id, catalog, 1, copy.condition, copy.price, copy.acquisitionPrice, copy.details()) }
    },
)

private fun BinderShareLinkDto.toDomain() = BinderShareLink(
    id = id,
    label = label,
    token = token,
    expiresAt = expiresAt,
    createdAt = createdAt,
    lastUsedAt = lastUsedAt,
)

private fun WishlistDto.toDomain() = Wishlist(
    id = id,
    name = name,
    description = description,
    colorHex = colorHex ?: "C43D73",
    matchAnyPrinting = matchAnyPrinting,
    rules = rules,
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

private fun WishlistInput.toRemoteRequest() = WishlistRequest(
    name = name,
    description = description,
    colorHex = colorHex,
    matchAnyPrinting = matchAnyPrinting,
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

private fun SealedInventoryWithProduct.toDomain() = SealedInventoryItem(
    id = inventory.id,
    product = product.toDomain(),
    quantity = inventory.quantity,
    purchasePrice = inventory.purchasePrice,
    purchaseDate = inventory.purchaseDate,
    notes = inventory.notes,
    createdAt = inventory.createdAt,
)

private fun SealedProductDto.toDomain() = SealedProduct(
    id = id,
    tcg = tcg,
    name = name,
    productType = productType,
    setCode = setCode,
    cardsPerPack = cardsPerPack,
    packsPerBox = packsPerBox,
    releaseDate = releaseDate,
    imageUrl = imageUrl,
    msrp = msrp,
    upc = upc,
    isCustom = isCustom,
)

private fun SealedProductEntity.toDomain() = SealedProduct(
    id = id,
    tcg = tcg,
    name = name,
    productType = productType,
    setCode = setCode,
    cardsPerPack = cardsPerPack,
    packsPerBox = packsPerBox,
    releaseDate = releaseDate,
    imageUrl = imageUrl,
    msrp = msrp,
    upc = upc,
    isCustom = isCustom,
)

private fun SealedOpeningLedgerDto.toDomain() = SealedOpeningLedger(
    id = id,
    inventoryId = inventoryId,
    productName = productName,
    openedQuantity = openedQuantity,
    openedAt = openedAt,
    invested = invested,
    liveValue = liveValue,
    realizedProceeds = realizedProceeds,
    profitLoss = profitLoss,
    activeCopies = activeCopies,
    soldCopies = soldCopies,
    cards = cards.map { card ->
        SealedLedgerCard(
            id = card.id,
            collectionId = card.collectionId,
            externalId = card.externalId,
            tcg = card.tcg,
            cardName = card.cardName,
            quantity = card.quantity,
            status = card.status,
            liveValue = card.liveValue,
            realizedProceeds = card.realizedProceeds,
            soldAt = card.soldAt,
        )
    },
)

private fun SealedOpeningEntity.toDomain(): SealedOpeningLedger {
    val linked = linkedCollectionIds.split(',').filter(String::isNotBlank)
    return SealedOpeningLedger(
        id = id,
        inventoryId = inventoryId,
        productName = productName,
        openedQuantity = openedQuantity,
        openedAt = openedAt,
        invested = invested,
        liveValue = 0.0,
        realizedProceeds = 0.0,
        profitLoss = -invested,
        activeCopies = linked.size,
        soldCopies = 0,
    )
}

private fun SealedOpeningDto.toDomain() = SealedOpeningRecord(
    id = id,
    sealedInventoryId = sealedInventoryId,
    openedQuantity = openedQuantity,
    openedAt = openedAt,
    notes = notes,
    createdAt = createdAt,
)

internal fun barcodeEquivalents(barcode: String): List<String> = buildList {
    add(barcode)
    if (barcode.length == 12) add("0$barcode")
    if (barcode.length == 13 && barcode.startsWith('0')) add(barcode.drop(1))
}.distinct()

internal fun sealedInventoryUpdateJson(
    quantity: Int,
    purchasePrice: Double?,
    purchaseDate: String?,
    notes: String?,
) = buildJsonObject {
    put("quantity", JsonPrimitive(quantity))
    put("purchasePrice", purchasePrice?.let(::JsonPrimitive) ?: JsonNull)
    put("purchaseDate", purchaseDate?.let(::JsonPrimitive) ?: JsonNull)
    put("notes", notes?.trim()?.ifBlank { null }?.let(::JsonPrimitive) ?: JsonNull)
}

private val bundledSealedProducts = listOf(
    SealedProductEntity("sealed-product-1", "pokemon", "Surging Sparks Booster Box", "box", "SV08", 10, 36, "2024-11-08", null, 143.64, "820650855221", false),
    SealedProductEntity("sealed-product-2", "pokemon", "Paldean Fates Elite Trainer Box", "etb", "PAF", 10, 9, "2024-01-26", null, 49.99, "820650853159", false),
    SealedProductEntity("sealed-product-3", "magic", "Modern Horizons 3 Play Booster Box", "box", "MH3", 14, 36, "2024-06-14", null, 287.64, null, false),
    SealedProductEntity("sealed-product-4", "yugioh", "Age of Overlord Booster Box", "box", "AGOV", 9, 24, "2023-10-19", null, 79.99, null, false),
    SealedProductEntity("sealed-product-5", "pokemon", "Prismatic Evolutions Booster Pack", "booster", "PRE", 10, null, "2025-01-17", null, 5.99, null, false),
)
