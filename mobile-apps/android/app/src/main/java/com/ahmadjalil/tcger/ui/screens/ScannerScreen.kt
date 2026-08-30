package com.ahmadjalil.tcger.ui.screens

import android.Manifest
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.view.CameraController
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.FlashlightOff
import androidx.compose.material.icons.filled.FlashlightOn
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Observer
import androidx.camera.core.TorchState
import com.ahmadjalil.tcger.ParityTestMode
import com.ahmadjalil.tcger.domain.CardScanSource
import com.ahmadjalil.tcger.domain.CardScanResult
import com.ahmadjalil.tcger.domain.CatalogCard
import com.ahmadjalil.tcger.data.scanner.AndroidScannerCapabilities
import com.ahmadjalil.tcger.data.scanner.AndroidScannerRequest
import com.ahmadjalil.tcger.data.scanner.AndroidScannerRequestHandler
import com.ahmadjalil.tcger.data.scanner.AndroidScannerResultRequestHandler
import com.ahmadjalil.tcger.data.scanner.RecordedScannerFrame
import com.ahmadjalil.tcger.data.scanner.ScannerBoundaryDecisionDiagnostics
import com.ahmadjalil.tcger.data.scanner.ScannerDebugCaptureMetadata
import com.ahmadjalil.tcger.data.scanner.ScannerDemoInputs
import com.ahmadjalil.tcger.data.scanner.ScannerOptionsJson
import com.ahmadjalil.tcger.data.scanner.ScannerOptionsStore
import com.ahmadjalil.tcger.data.scanner.ScannerRecordingBundle
import com.ahmadjalil.tcger.data.scanner.ScannerRecordingJson
import com.ahmadjalil.tcger.data.scanner.ScannerRecordingArchiveJson
import com.ahmadjalil.tcger.data.scanner.ImportedScannerRecording
import com.ahmadjalil.tcger.data.scanner.ScannerAttemptImageStore
import com.ahmadjalil.tcger.data.scanner.ScannerAttemptImageKind
import com.ahmadjalil.tcger.data.scanner.ScannerAttemptImageReference
import com.ahmadjalil.tcger.data.scanner.ScannerRollingRecorder
import com.ahmadjalil.tcger.data.scanner.ScannerReplayReport
import com.ahmadjalil.tcger.data.scanner.ScannerReplayRunner
import com.ahmadjalil.tcger.data.scanner.ScannerLiveDebugLog
import com.ahmadjalil.tcger.data.scanner.ScannerLiveGeometry
import com.ahmadjalil.tcger.data.scanner.ScannerSessionOptions
import com.ahmadjalil.tcger.data.scanner.ScannerCaptureMode
import com.ahmadjalil.tcger.data.scanner.ScannerPerformanceOption
import com.ahmadjalil.tcger.data.scanner.ScannerTriggerMode
import com.ahmadjalil.tcger.data.scanner.ScannerRecognitionEngine
import com.ahmadjalil.tcger.data.scanner.ScannerSessionEntry
import com.ahmadjalil.tcger.data.scanner.ScannerSessionStore
import com.ahmadjalil.tcger.data.scanner.AutoScanConsensus
import com.ahmadjalil.tcger.data.scanner.AutoScanConsensusUpdate
import com.ahmadjalil.tcger.data.scanner.AutomaticCaptureRearmGate
import com.ahmadjalil.tcger.data.scanner.boundedAutomaticIntervalMillis
import com.ahmadjalil.tcger.data.scanner.withRequiredTrainingEvidence
import com.ahmadjalil.tcger.data.scanner.model.ScannerAssetInstallStatus
import com.ahmadjalil.tcger.data.scanner.AndroidScannerAssetDiagnostics
import com.ahmadjalil.tcger.data.scanner.ScannerAssetDiagnosticItem
import com.ahmadjalil.tcger.data.scanner.ScannerDeveloperAccessStore
import com.ahmadjalil.tcger.data.scanner.DeveloperUnlockCounter
import com.ahmadjalil.tcger.data.scanner.DeveloperUnlockProgress
import com.ahmadjalil.tcger.data.scanner.ScannerRecordingSessionStore
import com.ahmadjalil.tcger.data.scanner.ScannerReferenceRunSnapshot
import com.ahmadjalil.tcger.data.scanner.ScannerReferenceSet
import com.ahmadjalil.tcger.data.scanner.ScannerReferenceSetRunner
import com.ahmadjalil.tcger.data.scanner.SavedScannerRecording
import com.ahmadjalil.tcger.data.scanner.ScannerPriceClient
import com.ahmadjalil.tcger.data.scanner.ScannerSharedSessionClient
import com.ahmadjalil.tcger.data.scanner.BinderPagePhotoStore
import com.ahmadjalil.tcger.data.scanner.ScannerPriceMode
import com.ahmadjalil.tcger.data.scanner.resolveScannerGameChoice
import com.ahmadjalil.tcger.data.scanner.binder.PerspectiveCardCropper
import com.ahmadjalil.tcger.data.scanner.binder.ScannerCropQuad
import com.ahmadjalil.tcger.data.scanner.binder.BinderPageQuadDetector
import com.ahmadjalil.tcger.generated.ParityControlIDs
import com.ahmadjalil.tcger.generated.ParityFeatureIDs
import com.ahmadjalil.tcger.ui.AppUiState
import com.ahmadjalil.tcger.ui.AppViewModel
import java.io.File
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScannerScreen(
    state: AppUiState,
    contentPadding: PaddingValues,
    viewModel: AppViewModel,
    onBack: () -> Unit,
    scannerCapabilities: AndroidScannerCapabilities? = null,
    scannerRequestHandler: AndroidScannerRequestHandler? = null,
    guidedScannerRequestHandler: AndroidScannerResultRequestHandler? = null,
    bulkScannerRequestHandler: ((List<AndroidScannerRequest>) -> Unit)? = null,
    onReplayRequested: ((ScannerRecordingBundle) -> Unit)? = null,
    onBulkAddToBinder: ((String, List<CatalogCard>) -> Unit)? = null,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val result = state.scanResult
    val supportedGames = state.scannerSupportedGames.filter { it in state.preferences.enabledGames }
    if (supportedGames.isEmpty()) {
        Column(Modifier.fillMaxSize()) {
            TopAppBar(
                title = { Text("Scan a card") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
            Box(
                Modifier.fillMaxSize().padding(24.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "Enable at least one game with a compatible scanner in Settings.",
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
        }
        return
    }
    val optionStore = remember(context) { ScannerOptionsStore(context) }
    val lastSelectedScannerGame = remember(optionStore, supportedGames) {
        optionStore.loadLastSelectedGame()?.takeIf(supportedGames::contains)
    }
    val initialGameResolution = remember(
        supportedGames,
        lastSelectedScannerGame,
        state.preferences.defaultGame,
    ) {
        resolveScannerGameChoice(
            supportedGames,
            lastSelectedScannerGame ?: state.preferences.defaultGame,
        )
    }
    var selectedGame by rememberSaveable(
        supportedGames,
        lastSelectedScannerGame,
        state.preferences.defaultGame,
    ) {
        mutableStateOf(initialGameResolution.selectedGame ?: supportedGames.first())
    }
    var scannerGameSelectionResolved by rememberSaveable(
        supportedGames,
        lastSelectedScannerGame,
        state.preferences.defaultGame,
    ) {
        mutableStateOf(initialGameResolution.selectedGame != null)
    }
    var showingScannerGameChoice by rememberSaveable(
        supportedGames,
        lastSelectedScannerGame,
        state.preferences.defaultGame,
    ) {
        mutableStateOf(initialGameResolution.requiresChoice)
    }
    val sessionStore = remember(context) { ScannerSessionStore(context) }
    val developerStore = remember(context) { ScannerDeveloperAccessStore(context) }
    val recordingSessionStore = remember(context) { ScannerRecordingSessionStore(context) }
    val attemptImageStore = remember(context) { ScannerAttemptImageStore(context) }
    val binderPagePhotoStore = remember(context) { BinderPagePhotoStore(context) }
    val scannerPriceClient = remember { ScannerPriceClient() }
    val sharedSessionClient = remember { ScannerSharedSessionClient() }
    var options by remember { mutableStateOf(optionStore.load()) }
    var sessionEntries by remember { mutableStateOf(sessionStore.load()) }
    var developerUnlocked by remember { mutableStateOf(developerStore.isUnlocked()) }
    val developerUnlockCounter = remember { DeveloperUnlockCounter() }
    var developerUnlockProgress by remember { mutableStateOf<DeveloperUnlockProgress?>(null) }
    val normalizedScannerGame = when (selectedGame.lowercase()) {
        "yu-gi-oh", "yu-gi-oh!" -> "yugioh"
        "mtg", "magic-the-gathering" -> "magic"
        else -> selectedGame.lowercase()
    }
    val scannerAssetStatus = state.scannerAssets[normalizedScannerGame]
        ?: ScannerAssetInstallStatus.NotInstalled
    val localArcFaceAvailable = when (val asset = scannerAssetStatus) {
            is ScannerAssetInstallStatus.Installed -> true
            is ScannerAssetInstallStatus.Failed -> asset.installedManifest != null
            else -> false
    }
    val localDinoV2Available = false
    val remoteScannerManifest = state.scannerAssetManifests[normalizedScannerGame]
    val installedScannerManifest = when (scannerAssetStatus) {
        is ScannerAssetInstallStatus.Installed -> scannerAssetStatus.manifest
        is ScannerAssetInstallStatus.Failed -> scannerAssetStatus.installedManifest
        else -> null
    }
    val scannerUpdateAvailable = remoteScannerManifest != null &&
        installedScannerManifest != null &&
        remoteScannerManifest.version != installedScannerManifest.version
    val capabilities = scannerCapabilities ?: AndroidScannerCapabilities(
        serverConfigured = state.preferences.isSignedIn && state.preferences.serverUrl.isNotBlank(),
        priceLookupAvailable = state.preferences.isSignedIn && state.preferences.serverUrl.isNotBlank(),
        arcFaceRuntimeAvailable = localArcFaceAvailable,
        binderPageDetectorAvailable = true,
        dinoV2RuntimeAvailable = localDinoV2Available,
    )
    val recorder = remember { ScannerRollingRecorder() }
    val liveDebugLog = remember { ScannerLiveDebugLog() }
    val activeDevSessionId = remember { "dev-${UUID.randomUUID()}" }
    var recorderVersion by remember { mutableStateOf(0) }
    var showingOptions by remember { mutableStateOf(false) }
    var showingDebug by remember { mutableStateOf(false) }
    var showingResult by remember { mutableStateOf(false) }
    var showingSessionReview by remember { mutableStateOf(false) }
    var pendingSessionBinder by remember { mutableStateOf(false) }
    var importedRecording by remember { mutableStateOf<ImportedScannerRecording?>(null) }
    var pendingRecordingExport by remember { mutableStateOf<ScannerRecordingBundle?>(null) }
    var savedRecordings by remember { mutableStateOf<List<SavedScannerRecording>>(emptyList()) }
    var assetDiagnostics by remember { mutableStateOf<List<ScannerAssetDiagnosticItem>>(emptyList()) }
    var diagnosticsRunning by remember { mutableStateOf(false) }
    var ioMessage by remember { mutableStateOf<String?>(null) }
    var scannerAssetPromptGame by remember { mutableStateOf<String?>(null) }
    var suppressedScannerPromptKey by remember { mutableStateOf<String?>(null) }
    var pendingCard by remember { mutableStateOf<CatalogCard?>(null) }
    var lastSourceBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var lastSourceQuad by remember { mutableStateOf<ScannerCropQuad?>(null) }
    var quadEditorBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var editingBinderPage by remember { mutableStateOf(false) }
    var binderPocketJpegs by remember { mutableStateOf<List<ByteArray>>(emptyList()) }
    var pendingBinderPageJpeg by remember { mutableStateOf<ByteArray?>(null) }
    var binderPocketReviews by remember { mutableStateOf<List<BinderPocketReview>>(emptyList()) }
    var binderRecognitionRunning by remember { mutableStateOf(false) }
    var showingBinderReview by remember { mutableStateOf(false) }
    var pendingBulkCards by remember { mutableStateOf<List<CatalogCard>?>(null) }
    var lastCaptureSource by remember { mutableStateOf("manual") }
    var awaitingScannerResult by remember { mutableStateOf(false) }
    var lastSharedRequest by remember { mutableStateOf<AndroidScannerRequest?>(null) }
    var latestDecisionDiagnostics by remember { mutableStateOf<ScannerBoundaryDecisionDiagnostics?>(null) }
    var referenceRequest by remember { mutableStateOf<AndroidScannerRequest?>(null) }
    var referenceSnapshot by remember { mutableStateOf<ScannerReferenceRunSnapshot?>(null) }
    val autoConsensus = remember { AutoScanConsensus(requiredMatches = 2) }
    val automaticRearmGate = remember { AutomaticCaptureRearmGate() }
    var automaticCaptureNeedsRearm by remember { mutableStateOf(false) }
    var consensusUpdate by remember { mutableStateOf<AutoScanConsensusUpdate?>(null) }
    var replayFrames by remember { mutableStateOf<List<RecordedScannerFrame>>(emptyList()) }
    var replayIndex by remember { mutableStateOf(0) }
    var replayComparisons by remember { mutableStateOf<List<Pair<RecordedScannerFrame, RecordedScannerFrame>>>(emptyList()) }
    var replayReport by remember { mutableStateOf<ScannerReplayReport?>(null) }
    var replayRunning by remember { mutableStateOf(false) }
    var replayAwaiting by remember { mutableStateOf(false) }
    var liveDebugVersion by remember { mutableStateOf(0) }
    var liveDebugFrameCount by remember { mutableStateOf(0) }
    var liveDebugLatestTimingMs by remember { mutableStateOf<Double?>(null) }
    val liveGeometry = remember { ScannerLiveGeometry() }
    val productionResultHandler = guidedScannerRequestHandler ?: remember(viewModel) {
        AndroidScannerResultRequestHandler(viewModel::scanCardForGuidedCapture)
    }
    val referenceRunner = remember(capabilities) {
        ScannerReferenceSetRunner(
            AndroidScannerRequestHandler { referenceRequest = it },
            capabilities,
        )
    }

    fun updateSession(updated: List<ScannerSessionEntry>) {
        sessionEntries = updated.takeLast(250)
        sessionStore.save(sessionEntries)
    }

    fun addToSession(candidates: List<com.ahmadjalil.tcger.domain.CardScanCandidate>, source: CardScanSource): List<ScannerSessionEntry> {
        if (candidates.isEmpty()) return emptyList()
        val created = candidates.map { ScannerSessionEntry.from(it, source) }
        updateSession(sessionEntries + created)
        return created
    }

    fun fetchSessionPrices(entries: List<ScannerSessionEntry>) {
        if (options.priceMode != ScannerPriceMode.SESSION_MARKET || !capabilities.priceLookupAvailable) return
        val token = state.preferences.authToken ?: return
        scope.launch {
            entries.forEach { entry ->
                val quote = runCatching {
                    scannerPriceClient.fetch(state.preferences.serverUrl, token, entry.toCatalogCard())
                }.getOrNull() ?: return@forEach
                updateSession(
                    sessionEntries.map {
                        if (it.id == entry.id) it.copy(price = quote.price, currency = quote.currency, priceSource = quote.source) else it
                    },
                )
            }
        }
    }

    fun syncSharedSession(entries: List<ScannerSessionEntry>) {
        val code = options.sharedSessionCode.trim()
        val token = state.preferences.authToken
        if (entries.isEmpty() || code.isEmpty()) return
        if (state.preferences.serverUrl.isBlank() || token.isNullOrBlank()) {
            ioMessage = "Shared web sessions require a configured, signed-in server."
            return
        }
        scope.launch {
            entries.forEach { entry ->
                runCatching {
                    sharedSessionClient.send(
                        serverUrl = state.preferences.serverUrl,
                        authToken = token,
                        code = code,
                        entry = entry,
                        language = options.language,
                    )
                }.onFailure { ioMessage = it.message ?: "Could not sync the scan to the shared session." }
            }
        }
    }

    fun updateOptions(updated: ScannerSessionOptions) {
        val previousPriceMode = options.priceMode
        if (updated.devModeRecordingEnabled != options.devModeRecordingEnabled) {
            if (updated.devModeRecordingEnabled) recorder.start() else recorder.pause()
            recorderVersion += 1
        }
        options = capabilities.normalize(updated, selectedGame)
        optionStore.save(options)
        if (previousPriceMode != ScannerPriceMode.SESSION_MARKET && options.priceMode == ScannerPriceMode.SESSION_MARKET) {
            fetchSessionPrices(sessionEntries.filter { it.price == null })
        }
    }

    fun refreshSavedRecordings() {
        savedRecordings = runCatching { recordingSessionStore.list() }.getOrDefault(emptyList())
    }

    fun persistDevRecording(request: AndroidScannerRequest) {
        if (!request.options.devModeRecordingEnabled || recorder.frameCount == 0) return
        val bundle = recorder.snapshot(request.game, request.options.recognitionEngine.name.lowercase())
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { recordingSessionStore.save(bundle, activeDevSessionId) }
            }.onSuccess { refreshSavedRecordings() }
                .onFailure { ioMessage = it.message }
        }
    }

    fun runAssetDiagnostics() {
        if (diagnosticsRunning) return
        diagnosticsRunning = true
        scope.launch {
            assetDiagnostics = withContext(Dispatchers.IO) {
                AndroidScannerAssetDiagnostics.run(context, capabilities.serverConfigured)
            }
            diagnosticsRunning = false
        }
    }

    fun recordedFrame(
        scan: CardScanResult,
        game: String,
        request: AndroidScannerRequest? = null,
    ): RecordedScannerFrame {
        val top = scan.candidates.firstOrNull()
        return RecordedScannerFrame(
            index = 0,
            timestampSeconds = 0.0,
            mode = game,
            pipeline = scan.engine ?: options.recognitionEngine.name.lowercase(),
            elapsedMs = scan.elapsedMs ?: 0.0,
            detectedCount = scan.candidates.size,
            identified = top != null,
            bestMatchName = top?.card?.name,
            bestMatchCardId = top?.card?.id,
            bestMatchSetCode = top?.card?.setCode,
            bestMatchSetName = top?.card?.setName,
            confidence = top?.confidence,
            strategy = scan.source.name.lowercase(),
            alternatives = scan.candidates.drop(1).map { it.card.name },
            alternativeCardIds = scan.candidates.drop(1).map { it.card.id },
            decisionDiagnostics = request?.let { ScannerBoundaryDecisionDiagnostics.from(it, scan) },
        )
    }

    fun requestFor(
        bytes: ByteArray,
        source: String,
        recordsDebug: Boolean = true,
        gameOverride: String? = null,
        optionsOverride: ScannerSessionOptions? = null,
        awaitsSharedResult: Boolean = true,
    ): AndroidScannerRequest {
        lastCaptureSource = source
        awaitingScannerResult = awaitsSharedResult
        val requestGame = gameOverride ?: selectedGame
        val effective = capabilities.normalize(optionsOverride ?: options, requestGame)
            .withRequiredTrainingEvidence()
        val capture = ScannerDebugCaptureMetadata(
            captureId = UUID.randomUUID().toString(),
            capturedAt = Instant.now().toString(),
            game = requestGame,
            captureMode = effective.captureMode,
            triggerMode = effective.triggerMode,
            recognitionEngine = effective.recognitionEngine,
            encoderVariant = effective.encoderVariant,
            language = effective.language,
            imageByteCount = bytes.size,
            source = source,
            notes = effective.captureNotes.ifBlank { null },
            automaticallyShowResults = effective.automaticallyShowResults,
            priceMode = effective.priceMode,
            performance = effective.performance,
            saveServerDebugCapture = effective.saveServerDebugCapture,
            recordAttemptImages = effective.recordAttemptImages,
            cropRescueEnabled = effective.cropRescueEnabled,
        )
        if (recordsDebug) {
            recorder.recordCapture(capture)
            recorderVersion += 1
            if (effective.recordAttemptImages && recorder.isRecording) {
                scope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) { attemptImageStore.retain(activeDevSessionId, capture.captureId, bytes) }
                    }.onSuccess { images ->
                        val attached = recorder.attachAttemptImages(capture.captureId, images)
                        if (!attached) {
                            withContext(Dispatchers.IO) { attemptImageStore.delete(images) }
                        }
                        recorderVersion += 1
                        if (effective.devModeRecordingEnabled && recorder.frameCount > 0) {
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    recordingSessionStore.save(
                                        recorder.snapshot(requestGame, effective.recognitionEngine.name.lowercase()),
                                        activeDevSessionId,
                                    )
                                }
                            }.onSuccess { refreshSavedRecordings() }
                                .onFailure { ioMessage = it.message }
                        }
                    }.onFailure { ioMessage = "Attempt image was not retained: ${it.message}" }
                }
            }
        }
        liveDebugLog.record("Capture $source · $requestGame · ${bytes.size} bytes · ${effective.recognitionEngine.displayName}")
        if (liveDebugLog.isRunning) {
            liveDebugFrameCount += 1
            liveDebugVersion += 1
        }
        showingResult = false
        return AndroidScannerRequest(bytes, requestGame, effective, capture).also {
            if (awaitsSharedResult) lastSharedRequest = it
        }
    }

    fun submit(bytes: ByteArray, source: String) {
        val request = requestFor(bytes, source)
        scannerRequestHandler?.scan(request) ?: viewModel.scanCard(bytes, selectedGame)
    }

    fun beginBinderRecognition(crops: List<ByteArray>) {
        if (crops.isEmpty()) return
        binderPocketJpegs = crops.take(9)
        binderPocketReviews = crops.take(9).indices.map { BinderPocketReview(it, emptyList()) }
        binderRecognitionRunning = true
        showingBinderReview = true
        lateinit var scanPocket: (Int) -> Unit
        scanPocket = { index ->
            val bytes = binderPocketJpegs.getOrNull(index)
            if (bytes == null) {
                binderRecognitionRunning = false
            } else {
                val request = requestFor(
                    bytes = bytes,
                    source = "binder-pocket-${index + 1}",
                    optionsOverride = options.copy(
                        captureMode = ScannerCaptureMode.CARD,
                        triggerMode = ScannerTriggerMode.MANUAL,
                        automaticallyShowResults = false,
                    ),
                    awaitsSharedResult = false,
                )
                productionResultHandler.scan(request) { outcome ->
                    scope.launch {
                        outcome.onSuccess { scan ->
                            val observed = recordedFrame(scan, request.game, request)
                            recorder.recordResult(observed, request.debugCapture.captureId)
                            recorderVersion += 1
                            persistDevRecording(request)
                            binderPocketReviews = binderPocketReviews.map { pocket ->
                                if (pocket.index == index) BinderPocketReview(index, scan.candidates.take(5)) else pocket
                            }
                            val next = index + 1
                            if (next < binderPocketJpegs.size) scanPocket(next) else binderRecognitionRunning = false
                        }.onFailure { error ->
                            recorder.recordResult(
                                RecordedScannerFrame(
                                    index = 0,
                                    timestampSeconds = 0.0,
                                    mode = request.game,
                                    pipeline = request.options.recognitionEngine.name.lowercase(),
                                    elapsedMs = 0.0,
                                    identified = false,
                                    decisionDiagnostics = ScannerBoundaryDecisionDiagnostics.failure(
                                        request,
                                        error.message ?: "Production scanner failed",
                                    ),
                                ),
                                request.debugCapture.captureId,
                            )
                            recorderVersion += 1
                            persistDevRecording(request)
                            binderRecognitionRunning = false
                            ioMessage = "Pocket ${index + 1} could not be recognized: ${error.message}"
                        }
                    }
                }
            }
        }
        scanPocket(0)
    }

    fun acceptCapturedImage(bytes: ByteArray, source: String, automatic: Boolean = false) {
        if (!scannerGameSelectionResolved) {
            showingScannerGameChoice = true
            return
        }
        if (automatic || options.captureMode == ScannerCaptureMode.CARD) {
            if (!automatic) {
                scope.launch {
                    runCatching { withContext(Dispatchers.Default) { decodeUprightScannerBitmap(bytes) } }
                        .onSuccess { bitmap ->
                            lastSourceBitmap = bitmap
                            lastSourceQuad = ScannerCropQuad.centered(bitmap.width, bitmap.height)
                        }
                }
            }
            submit(bytes, source)
            return
        }
        scope.launch {
            runCatching { withContext(Dispatchers.Default) { decodeUprightScannerBitmap(bytes) } }
                .onSuccess { bitmap ->
                    lastSourceBitmap = bitmap
                    lastSourceQuad = if (options.captureMode == ScannerCaptureMode.BINDER) {
                        BinderPageQuadDetector.detect(bitmap)?.quad
                            ?: ScannerCropQuad.fromBounds(0.035f, 0.035f, 0.965f, 0.965f)
                    } else {
                        ScannerCropQuad.centered(bitmap.width, bitmap.height)
                    }
                    editingBinderPage = true
                    quadEditorBitmap = bitmap
                }
                .onFailure { ioMessage = it.message }
        }
    }

    fun localImport(bundle: ScannerRecordingBundle): ImportedScannerRecording {
        val imageNames = bundle.frames.flatMap(RecordedScannerFrame::attemptImages)
            .map { it.fileName }
            .distinct()
        return ImportedScannerRecording(bundle, imageNames.mapNotNull { name -> attemptImageStore.read(name)?.let { name to it } }.toMap())
    }

    fun shareRecording(bundle: ScannerRecordingBundle, fileName: String) {
        scope.launch {
            runCatching {
                val target = withContext(Dispatchers.IO) {
                    val directory = File(context.cacheDir, "shared-scanner-recordings").apply { mkdirs() }
                    val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1_000L
                    directory.listFiles().orEmpty().filter { it.lastModified() < cutoff }.forEach(File::delete)
                    File(directory, fileName).apply {
                        writeText(ScannerRecordingArchiveJson.encode(bundle, attemptImageStore::read))
                    }
                }
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", target)
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "application/json"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    clipData = ClipData.newUri(context.contentResolver, "TCGer scanner recording", uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                context.startActivity(Intent.createChooser(intent, "Share scanner recording"))
            }.onFailure { ioMessage = it.message }
        }
    }

    fun replayOptions(frame: RecordedScannerFrame): ScannerSessionOptions {
        val capture = frame.capture ?: return options
        return options.copy(
            captureMode = capture.captureMode,
            triggerMode = capture.triggerMode,
            recognitionEngine = capture.recognitionEngine,
            encoderVariant = capture.encoderVariant,
            language = capture.language,
            automaticallyShowResults = false,
            priceMode = capture.priceMode,
            performance = capture.performance.ifEmpty { options.performance },
            saveServerDebugCapture = false,
            recordAttemptImages = false,
        )
    }

    fun submitReplayFrame(index: Int) {
        val imported = importedRecording ?: return
        val baseline = replayFrames.getOrNull(index) ?: return
        val bytes = imported.originalBytes(baseline) ?: return
        val handler = scannerRequestHandler ?: return
        val replayGame = baseline.mode.takeIf { it in supportedGames } ?: selectedGame
        replayAwaiting = true
        handler.scan(
            requestFor(
                bytes = bytes,
                source = "production-replay",
                recordsDebug = false,
                gameOverride = replayGame,
                optionsOverride = replayOptions(baseline),
            ),
        )
    }

    fun startReplay() {
        val imported = importedRecording ?: return
        if (scannerRequestHandler == null) {
            ioMessage = "The production scanner callback is not connected."
            return
        }
        val replayable = imported.recording.frames.filter { imported.originalBytes(it) != null }
        if (replayable.isEmpty()) {
            ioMessage = "This recording has no retained original attempt JPEGs."
            return
        }
        replayFrames = replayable
        replayIndex = 0
        replayComparisons = emptyList()
        replayReport = null
        replayRunning = true
        liveDebugLog.record("Replay started · ${replayable.size} production requests")
        liveDebugVersion += 1
        submitReplayFrame(0)
    }

    fun startReferenceSet() {
        val imported = importedRecording ?: return
        val set = ScannerReferenceSet.fromRecording(
            id = "recording-${imported.recording.summary.capturedAt.hashCode()}",
            name = "Imported recording",
            recording = imported,
        )
        if (set.items.isEmpty()) {
            ioMessage = "This recording has no retained original JPEGs to use as a reference set."
            return
        }
        runCatching { referenceRunner.start(set, options) }
            .onSuccess { referenceSnapshot = it }
            .onFailure { ioMessage = it.message }
    }

    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri ?: return@rememberLauncherForActivityResult
        scope.launch {
            val bytes = withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }
            if (bytes != null) acceptCapturedImage(bytes, "photo-library")
        }
    }
    val bulkImagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            val requests = withContext(Dispatchers.IO) {
                uris.mapNotNull { uri ->
                    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                }
            }.map { requestFor(it, "bulk-photo-library", recordsDebug = false) }
            bulkScannerRequestHandler?.invoke(requests)
                ?: requests.forEach { request ->
                    scannerRequestHandler?.scan(request) ?: viewModel.scanCard(request.imageBytes, request.game)
                }
        }
    }
    val exportRecording = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        val export = pendingRecordingExport ?: recorder.snapshot(selectedGame, options.recognitionEngine.name.lowercase())
        pendingRecordingExport = null
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    val json = ScannerRecordingArchiveJson.encode(export, attemptImageStore::read)
                    context.contentResolver.openOutputStream(uri)?.bufferedWriter()?.use { it.write(json) }
                        ?: error("Could not open the selected file")
                }
            }.onFailure { ioMessage = it.message }
        }
    }
    val importRecording = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { ScannerRecordingArchiveJson.decode(it.readText()) }
                        ?: error("Could not open the selected recording")
                }
            }.onSuccess {
                importedRecording = it
                replayReport = null
            }.onFailure { ioMessage = it.message }
        }
    }
    val exportOptions = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openOutputStream(uri)?.bufferedWriter()?.use { it.write(ScannerOptionsJson.encode(options)) }
                ?: error("Could not open the selected file")
        }.onFailure { ioMessage = it.message }
    }
    val importOptions = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { ScannerOptionsJson.decode(it.readText()) }
                ?: error("Could not open the selected options")
        }.onSuccess(::updateOptions).onFailure { ioMessage = it.message }
    }
    val exportAllRecordings = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openOutputStream(uri)?.bufferedWriter()?.use {
                it.write(recordingSessionStore.exportAll())
            } ?: error("Could not open the selected file")
        }.onFailure { ioMessage = it.message }
    }

    LaunchedEffect(result) {
        result ?: return@LaunchedEffect
        if (!awaitingScannerResult) return@LaunchedEffect
        awaitingScannerResult = false
        val top = result.candidates.firstOrNull()
        val request = lastSharedRequest
        lastSharedRequest = null
        val observed = recordedFrame(
            result,
            if (lastCaptureSource == "production-replay") replayFrames.getOrNull(replayIndex)?.mode ?: selectedGame else selectedGame,
            request,
        )
        latestDecisionDiagnostics = observed.decisionDiagnostics
        liveDebugLatestTimingMs = observed.elapsedMs
        liveDebugLog.record(
            "Result ${observed.pipeline} · ${observed.elapsedMs.toInt()} ms · " +
                (observed.bestMatchCardId?.let { "top=$it (${observed.confidence?.let { score -> "%.3f".format(score) } ?: "n/a"})" } ?: "no match"),
        )
        liveDebugVersion += 1
        if (lastCaptureSource == "production-replay" && replayRunning) {
            replayAwaiting = false
            val baseline = replayFrames.getOrNull(replayIndex) ?: return@LaunchedEffect
            val comparisons = replayComparisons + (baseline to observed)
            replayComparisons = comparisons
            val next = replayIndex + 1
            if (next >= replayFrames.size) {
                replayReport = ScannerReplayRunner.summarize(replayFrames.size, comparisons)
                replayRunning = false
                liveDebugLog.record("Replay complete · ${comparisons.size}/${replayFrames.size} processed")
                liveDebugVersion += 1
                importedRecording?.recording?.let { onReplayRequested?.invoke(it) }
            } else {
                replayIndex = next
                delay(150)
                submitReplayFrame(next)
            }
            return@LaunchedEffect
        }
        recorder.recordResult(observed, request?.debugCapture?.captureId)
        recorderVersion += 1
        if (options.devModeRecordingEnabled && recorder.frameCount > 0) {
            val bundle = recorder.snapshot(selectedGame, result.engine ?: options.recognitionEngine.name.lowercase())
            scope.launch {
                runCatching {
                    withContext(Dispatchers.IO) { recordingSessionStore.save(bundle, activeDevSessionId) }
                }.onSuccess { refreshSavedRecordings() }
                .onFailure { ioMessage = it.message }
            }
        }
        val automaticCapture = lastCaptureSource == "automatic-camera"
        if (automaticCapture && automaticRearmGate.isWaitingForCardRemoval) {
            automaticRearmGate.observe(top?.card?.id)
            automaticCaptureNeedsRearm = automaticRearmGate.isWaitingForCardRemoval
            autoConsensus.reset()
            consensusUpdate = null
            showingResult = false
            return@LaunchedEffect
        }
        val catalogRejection = result.catalogDecision?.rejectionMessage
        if (catalogRejection != null) {
            autoConsensus.reset()
            consensusUpdate = null
            showingResult = true
            return@LaunchedEffect
        }
        if (result.requiresPrintingChoice) {
            autoConsensus.reset()
            consensusUpdate = null
            showingResult = true
            return@LaunchedEffect
        }
        if (automaticCapture) {
            val update = autoConsensus.observe(top?.card?.id, top?.card?.name)
            consensusUpdate = update
            if (update.confirmed && top != null) {
                val created = addToSession(listOf(top), result.source)
                fetchSessionPrices(created)
                syncSharedSession(created)
                automaticRearmGate.accepted(top.card.id)
                automaticCaptureNeedsRearm = true
                showingResult = options.automaticallyShowResults
            } else {
                showingResult = false
            }
        } else {
            autoConsensus.reset()
            consensusUpdate = null
            val sessionCandidates = if (lastCaptureSource == "bulk-photo-library") result.candidates else listOfNotNull(top)
            val created = addToSession(sessionCandidates, result.source)
            fetchSessionPrices(created)
            syncSharedSession(created)
            showingResult = options.automaticallyShowResults || ParityTestMode.isEnabled
        }
    }

    LaunchedEffect(referenceRequest) {
        val request = referenceRequest ?: return@LaunchedEffect
        productionResultHandler.scan(request) { outcome ->
            scope.launch {
                runCatching {
                    outcome.fold(referenceRunner::accept) {
                        referenceRunner.acceptFailure(it.message ?: "Production scanner failed")
                    }
                }.onSuccess { snapshot ->
                    referenceSnapshot = snapshot
                    latestDecisionDiagnostics = snapshot.outcomes.lastOrNull()?.diagnostics
                }.onFailure {
                    referenceSnapshot = referenceRunner.cancel()
                    referenceRequest = null
                    ioMessage = it.message
                }
            }
        }
    }

    LaunchedEffect(state.message, state.isScanning) {
        if (replayRunning && replayAwaiting && !state.isScanning && state.message != null) {
            replayAwaiting = false
            replayRunning = false
            replayReport = ScannerReplayRunner.summarize(replayFrames.size, replayComparisons)
            liveDebugLog.record("Replay stopped · ${state.message}")
            liveDebugVersion += 1
            ioMessage = "Replay stopped after ${replayComparisons.size} frames: ${state.message}"
            return@LaunchedEffect
        }
        if (awaitingScannerResult && !state.isScanning && state.message != null) {
            val request = lastSharedRequest ?: return@LaunchedEffect
            awaitingScannerResult = false
            lastSharedRequest = null
            val diagnostics = ScannerBoundaryDecisionDiagnostics.failure(request, state.message)
            latestDecisionDiagnostics = diagnostics
            recorder.recordResult(
                RecordedScannerFrame(
                    index = 0,
                    timestampSeconds = 0.0,
                    mode = request.game,
                    pipeline = request.options.recognitionEngine.name.lowercase(),
                    elapsedMs = 0.0,
                    identified = false,
                    decisionDiagnostics = diagnostics,
                ),
                request.debugCapture.captureId,
            )
            recorderVersion += 1
            if (request.options.devModeRecordingEnabled && recorder.frameCount > 0) {
                val bundle = recorder.snapshot(request.game, request.options.recognitionEngine.name.lowercase())
                scope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) { recordingSessionStore.save(bundle, activeDevSessionId) }
                    }.onSuccess { refreshSavedRecordings() }
                        .onFailure { ioMessage = it.message }
                }
            }
        }
    }

    LaunchedEffect(Unit) {
        if (options.devModeRecordingEnabled) {
            recorder.start()
            recorderVersion += 1
        }
    }

    LaunchedEffect(normalizedScannerGame, scannerGameSelectionResolved) {
        if (!scannerGameSelectionResolved) return@LaunchedEffect
        optionStore.saveLastSelectedGame(selectedGame)
        suppressedScannerPromptKey = null
        viewModel.refreshScannerAssets(normalizedScannerGame)
    }

    LaunchedEffect(
        normalizedScannerGame,
        scannerGameSelectionResolved,
        scannerAssetStatus,
        remoteScannerManifest?.version,
    ) {
        if (!scannerGameSelectionResolved) {
            scannerAssetPromptGame = null
            return@LaunchedEffect
        }
        val promptKey = if (scannerUpdateAvailable) {
            "$normalizedScannerGame:update:${remoteScannerManifest?.version}"
        } else {
            "$normalizedScannerGame:install"
        }
        when {
            scannerAssetStatus is ScannerAssetInstallStatus.Installing -> Unit
            !localArcFaceAvailable && suppressedScannerPromptKey != promptKey -> {
                scannerAssetPromptGame = normalizedScannerGame
            }
            scannerUpdateAvailable && suppressedScannerPromptKey != promptKey -> {
                scannerAssetPromptGame = normalizedScannerGame
            }
            localArcFaceAvailable && !scannerUpdateAvailable -> {
                scannerAssetPromptGame = null
            }
        }
    }

    LaunchedEffect(capabilities, selectedGame) {
        val normalized = capabilities.normalize(options, selectedGame)
        if (normalized != options) {
            options = normalized
            optionStore.save(normalized)
        }
    }

    LaunchedEffect(showingDebug, developerUnlocked) {
        if (showingDebug && developerUnlocked) {
            refreshSavedRecordings()
            runAssetDiagnostics()
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .testTag(ParityFeatureIDs.screen(ParityFeatureIDs.SCANNER_IDENTIFY)),
    ) {
        TopAppBar(
            title = { Text(if (showingResult && result != null) "Scan result" else "Scan a card") },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
            },
            actions = {
                if (developerUnlocked) {
                    IconButton(
                        onClick = { showingDebug = true },
                        modifier = Modifier.testTag(ParityControlIDs.ACTION_SCANNER_DEBUG_OPEN),
                    ) {
                        Icon(Icons.Default.BugReport, contentDescription = "Scanner debug")
                    }
                }
                IconButton(
                    onClick = { showingOptions = true },
                    modifier = Modifier.testTag(ParityControlIDs.ACTION_SCANNER_OPTIONS),
                ) {
                    Icon(Icons.Default.Tune, contentDescription = "Scanner options")
                }
            },
        )
        if (result == null || !showingResult) {
            ScannerCapturePane(
                state = state,
                contentPadding = contentPadding,
                supportedGames = supportedGames,
                selectedGame = selectedGame,
                onSelectedGame = {
                    selectedGame = it
                    scannerGameSelectionResolved = true
                    showingScannerGameChoice = false
                    scannerAssetPromptGame = null
                    suppressedScannerPromptKey = null
                    updateOptions(options)
                },
                onCaptured = { bytes, automatic ->
                    acceptCapturedImage(bytes, if (automatic) "automatic-camera" else "camera", automatic)
                },
                fastCapture = options.performance[ScannerPerformanceOption.FAST_CAPTURE] ?: true,
                automaticCapture = scannerGameSelectionResolved &&
                    options.captureMode == ScannerCaptureMode.CARD &&
                    options.triggerMode == ScannerTriggerMode.AUTOMATIC,
                automaticIntervalMillis = options.boundedAutomaticIntervalMillis(capabilities.serverConfigured)
                    .let { base ->
                        if (consensusUpdate?.confirmed == true || consensusUpdate?.locked == true) {
                            (base * 2).coerceAtMost(10_000)
                        } else {
                            base
                        }
                    },
                onPickPhoto = {
                    when {
                        !scannerGameSelectionResolved -> showingScannerGameChoice = true
                        else -> imagePicker.launch("image/*")
                    }
                },
                canAdjustCrop = options.captureMode == ScannerCaptureMode.CARD && lastSourceBitmap != null,
                onAdjustCrop = {
                    editingBinderPage = false
                    quadEditorBitmap = lastSourceBitmap
                },
                resultAvailable = result != null,
                onOpenResult = { showingResult = true },
                automaticCaptureNeedsRearm = automaticCaptureNeedsRearm,
                onNextAutomaticCard = {
                    automaticRearmGate.next()
                    automaticCaptureNeedsRearm = false
                    autoConsensus.reset()
                    consensusUpdate = null
                },
                onTestRecognize = {
                    if (ParityTestMode.isEnabled) {
                        lastCaptureSource = "test-fixture"
                        awaitingScannerResult = true
                        viewModel.useScannerTestCard()
                    } else {
                        scope.launch {
                            runCatching {
                                withContext(Dispatchers.Default) { ScannerDemoInputs.jpeg(options.captureMode) }
                            }.onSuccess { bytes ->
                                acceptCapturedImage(bytes, "demo-${options.captureMode.name.lowercase()}")
                            }.onFailure { ioMessage = "Demo input could not be created: ${it.message}" }
                        }
                    }
                },
                demoCaptureMode = options.captureMode,
                showTestingTools = developerUnlocked && options.testingToolsEnabled,
                sessionEntries = sessionEntries,
                consensusUpdate = consensusUpdate,
                onReviewSession = { showingSessionReview = true },
                onClearSession = { updateSession(emptyList()) },
                liveDebugRunning = liveDebugLog.isRunning,
                liveDebugFrameCount = liveDebugFrameCount,
                liveDebugLatestTimingMs = liveDebugLatestTimingMs,
                liveGeometry = liveGeometry,
            )
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    val summary = result.catalogDecision?.rejectionMessage?.let {
                        "No safe catalog match was accepted"
                    } ?: when (result.source) {
                            CardScanSource.SERVER_IMAGE_MATCH -> "Matched from card artwork on the scanner server"
                            CardScanSource.ON_DEVICE_EMBEDDING -> "Matched from card artwork on this device"
                            CardScanSource.ON_DEVICE_TEXT -> "Read on this device — confirm the title before adding"
                        }
                    Text(summary, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (result.requiresPrintingChoice) {
                    item {
                        Text(
                            "This artwork has multiple printings. Choose the set shown on your card; nothing was added automatically.",
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
                result.catalogDecision?.rejectionMessage?.let { rejection ->
                    item {
                        Text(
                            rejection,
                            color = MaterialTheme.colorScheme.error,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
                items(result.candidates, key = { it.card.id }) { candidate ->
                    CatalogCardRow(candidate.card, showCardNumbers = state.preferences.showCardNumbers) {
                        Column(horizontalAlignment = Alignment.End) {
                            candidate.confidence?.let {
                                Text("${(it * 100).toInt()}%", style = MaterialTheme.typography.labelMedium)
                            }
                            TextButton(
                                modifier = Modifier.testTag(ParityControlIDs.ACTION_SCANNER_ADD),
                                onClick = { pendingCard = candidate.card },
                            ) { Text("Add") }
                        }
                    }
                }
                if (lastSourceBitmap != null && (options.cropRescueEnabled || result.candidates.isEmpty())) {
                    item {
                        OutlinedButton(
                            modifier = Modifier.fillMaxWidth().testTag(ParityControlIDs.ACTION_SCANNER_ADJUST_CROP),
                            onClick = {
                                editingBinderPage = false
                                quadEditorBitmap = lastSourceBitmap
                            },
                        ) { Text("Adjust crop and retry") }
                    }
                }
                item {
                    OutlinedButton(
                        modifier = Modifier.fillMaxWidth().testTag(ParityControlIDs.ACTION_SCANNER_RESCAN),
                        onClick = {
                            automaticRearmGate.next()
                            automaticCaptureNeedsRearm = false
                            autoConsensus.reset()
                            consensusUpdate = null
                            showingResult = false
                            viewModel.resetScanner()
                        },
                    ) { Text("Scan another card") }
                }
            }
        }
    }

    if (showingScannerGameChoice) {
        AlertDialog(
            onDismissRequest = { showingScannerGameChoice = false },
            title = { Text("Which game are you scanning?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Choose from the scanner modules currently enabled in Settings.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    initialGameResolution.choices.forEach { game ->
                        OutlinedButton(
                            modifier = Modifier.fillMaxWidth(),
                            onClick = {
                                selectedGame = game
                                scannerGameSelectionResolved = true
                                showingScannerGameChoice = false
                                scannerAssetPromptGame = null
                                suppressedScannerPromptKey = null
                            },
                        ) { Text(game.displayGame()) }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showingScannerGameChoice = false }) { Text("Not now") }
            },
        )
    }

    scannerAssetPromptGame?.takeIf { scannerGameSelectionResolved }?.let { game ->
        val status = state.scannerAssets[game] ?: ScannerAssetInstallStatus.NotInstalled
        val remote = state.scannerAssetManifests[game]
        val installed = when (status) {
            is ScannerAssetInstallStatus.Installed -> status.manifest
            is ScannerAssetInstallStatus.Failed -> status.installedManifest
            else -> null
        }
        val isUpdate = remote != null && installed != null && remote.version != installed.version
        val isInstalling = status is ScannerAssetInstallStatus.Installing
        val promptKey = if (isUpdate) "$game:update:${remote?.version}" else "$game:install"
        AlertDialog(
            onDismissRequest = {
                if (!isInstalling) {
                    suppressedScannerPromptKey = promptKey
                    scannerAssetPromptGame = null
                }
            },
            title = { Text(if (isUpdate) "Scanner update available" else "Install offline scanner model") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        if (isUpdate) {
                            "A newer ${game.displayGame()} recognition package is available. You can keep using the installed version if you update later."
                        } else {
                            "Download the ${game.displayGame()} artwork model for faster offline matches. Choose Not now to continue with server matching or on-device title OCR."
                        },
                    )
                    remote?.let { manifest ->
                        Text(
                            "${manifest.displayedCardCount} cards · ${formatScannerAssetBytes(manifest.downloadBytes)} · verified model, index, and metadata",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (status is ScannerAssetInstallStatus.Installing) {
                        LinearProgressIndicator(
                            progress = { status.progress },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Text(
                            "${formatScannerAssetBytes(status.completedBytes)} of ${formatScannerAssetBytes(status.totalBytes)}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    if (status is ScannerAssetInstallStatus.Failed) {
                        Text(status.message, color = MaterialTheme.colorScheme.error)
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !isInstalling,
                    onClick = { viewModel.installScannerAssets(game) },
                ) { Text(if (status is ScannerAssetInstallStatus.Failed) "Retry" else if (isUpdate) "Update" else "Install model") }
            },
            dismissButton = {
                TextButton(
                    enabled = !isInstalling,
                    onClick = {
                        suppressedScannerPromptKey = promptKey
                        scannerAssetPromptGame = null
                    },
                ) { Text(if (isUpdate) "Use installed version" else "Not now") }
            },
        )
    }

    pendingCard?.let { card ->
        AlertDialog(
            onDismissRequest = { pendingCard = null },
            title = { Text("Add ${card.name}") },
            text = {
                if (state.binders.isEmpty()) {
                    Text("Create a binder first, then return here to add this card.")
                } else {
                    LazyColumn(Modifier.heightIn(max = 320.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(state.binders, key = { it.id }) { binder ->
                            TextButton(
                                modifier = Modifier.fillMaxWidth(),
                                onClick = {
                                    viewModel.addCard(binder.id, card)
                                    pendingCard = null
                                },
                            ) { Text(binder.name, modifier = Modifier.fillMaxWidth()) }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { pendingCard = null }) { Text("Close") } },
        )
    }

    quadEditorBitmap?.let { bitmap ->
        val initial = if (editingBinderPage) {
            lastSourceQuad ?: ScannerCropQuad.fromBounds(0.035f, 0.035f, 0.965f, 0.965f)
        } else {
            lastSourceQuad ?: ScannerCropQuad.centered(bitmap.width, bitmap.height)
        }
        Dialog(
            onDismissRequest = { quadEditorBitmap = null },
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            ScannerQuadEditor(
                title = if (editingBinderPage) "Align binder page" else "Correct card crop",
                bitmap = bitmap,
                initialQuad = initial,
                confirmLabel = if (editingBinderPage) "Scan 9 pockets" else "Crop and retry",
                onDismiss = { quadEditorBitmap = null },
                onConfirm = { quad ->
                    quadEditorBitmap = null
                    if (editingBinderPage) {
                        pendingBinderPageJpeg = if (options.savesBinderPageImages) bitmap.toJpeg(92) else null
                        scope.launch {
                            runCatching {
                                withContext(Dispatchers.Default) { createBinderPocketJpegs(bitmap, quad) }
                            }.onSuccess(::beginBinderRecognition)
                                .onFailure { ioMessage = it.message }
                        }
                    } else {
                        lastSourceQuad = quad
                        scope.launch {
                            runCatching {
                                withContext(Dispatchers.Default) { PerspectiveCardCropper.crop(bitmap, quad).toJpeg() }
                            }.onSuccess { corrected -> submit(corrected, "manual-crop-retry") }
                                .onFailure { ioMessage = it.message }
                        }
                    }
                },
            )
        }
    }

    if (showingBinderReview) {
        Dialog(
            onDismissRequest = { if (!binderRecognitionRunning) showingBinderReview = false },
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            BinderPageReviewPanel(
                pockets = binderPocketReviews,
                isRecognizing = binderRecognitionRunning,
                processedCount = binderPocketReviews.count { it.candidates.isNotEmpty() },
                onChooseCandidate = { index, cardId ->
                    binderPocketReviews = binderPocketReviews.map { pocket ->
                        if (pocket.index == index) pocket.copy(selectedCardId = cardId) else pocket
                    }
                },
                onSave = {
                    pendingBulkCards = selectedBinderCards(binderPocketReviews)
                    showingBinderReview = false
                    pendingSessionBinder = true
                },
                onClose = { showingBinderReview = false },
            )
        }
    }

    if (showingOptions) {
        ScannerOptionsSheet(
            options = options,
            capabilities = capabilities,
            game = selectedGame,
            isProcessing = state.isScanning,
            onOptionsChanged = ::updateOptions,
            onPickPhoto = {
                showingOptions = false
                when {
                    !scannerGameSelectionResolved -> showingScannerGameChoice = true
                    else -> imagePicker.launch("image/*")
                }
            },
            onPickPhotos = {
                showingOptions = false
                when {
                    !scannerGameSelectionResolved -> showingScannerGameChoice = true
                    else -> bulkImagePicker.launch("image/*")
                }
            },
            onShowDebug = { showingDebug = true },
            developerUnlocked = developerUnlocked,
            developerUnlockProgress = developerUnlockProgress,
            onDeveloperVersionTap = {
                val progress = developerUnlockCounter.tap(developerUnlocked)
                developerUnlockProgress = progress
                if (progress.unlocked && !developerUnlocked) {
                    developerUnlocked = true
                    developerStore.setUnlocked(true)
                }
            },
            onHideDeveloperTools = {
                developerStore.setUnlocked(false)
                developerUnlocked = false
                developerUnlockCounter.reset()
                developerUnlockProgress = null
                updateOptions(
                    options.copy(
                        testingToolsEnabled = false,
                        devModeRecordingEnabled = false,
                        saveServerDebugCapture = false,
                    ),
                )
                showingDebug = false
            },
            onDismiss = { showingOptions = false },
        )
    }

    if (showingSessionReview) {
        Dialog(
            onDismissRequest = { showingSessionReview = false },
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            Surface(Modifier.fillMaxSize()) {
                ScannerSessionReviewPanel(
                    entries = sessionEntries,
                    onToggle = { id ->
                        updateSession(sessionEntries.map { if (it.id == id) it.copy(selected = !it.selected) else it })
                    },
                    onRemove = { id -> updateSession(sessionEntries.filterNot { it.id == id }) },
                    onClear = { updateSession(emptyList()) },
                    onAddSelected = {
                        showingSessionReview = false
                        pendingSessionBinder = true
                    },
                    onClose = { showingSessionReview = false },
                )
            }
        }
    }

    if (pendingSessionBinder) {
        val selectedEntries = sessionEntries.filter(ScannerSessionEntry::selected)
        val cardsToSave = pendingBulkCards ?: selectedEntries.map(ScannerSessionEntry::toCatalogCard)
        AlertDialog(
            onDismissRequest = { pendingSessionBinder = false },
            title = { Text("Add ${cardsToSave.size} scanned cards") },
            text = {
                if (state.binders.isEmpty()) {
                    Text("Create a binder first, then return to the scan session.")
                } else {
                    LazyColumn(Modifier.heightIn(max = 320.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(state.binders, key = { it.id }) { binder ->
                            TextButton(
                                modifier = Modifier.fillMaxWidth(),
                                onClick = {
                                    onBulkAddToBinder?.invoke(binder.id, cardsToSave)
                                        ?: cardsToSave.forEach { viewModel.addCard(binder.id, it) }
                                    pendingBinderPageJpeg?.let { pageJpeg ->
                                        val pageNumber = options.binderPageNumber
                                        val replace = options.replacesBinderPageImages
                                        scope.launch {
                                            runCatching {
                                                withContext(Dispatchers.IO) {
                                                    binderPagePhotoStore.save(binder.id, pageNumber, pageJpeg, replace)
                                                }
                                            }.onSuccess {
                                                updateOptions(options.copy(binderPageNumber = (pageNumber + 1).coerceAtMost(999)))
                                            }.onFailure {
                                                ioMessage = "Cards were added, but the binder-page photo was not saved: ${it.message}"
                                            }
                                        }
                                    }
                                    if (pendingBulkCards == null) {
                                        updateSession(sessionEntries.filterNot(ScannerSessionEntry::selected))
                                    }
                                    pendingBulkCards = null
                                    pendingBinderPageJpeg = null
                                    pendingSessionBinder = false
                                },
                            ) { Text(binder.name, modifier = Modifier.fillMaxWidth()) }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    pendingBulkCards = null
                    pendingBinderPageJpeg = null
                    pendingSessionBinder = false
                }) { Text("Close") }
            },
        )
    }

    if (showingDebug) {
        val recording = remember(recorderVersion) {
            recorder.snapshot(selectedGame, options.recognitionEngine.name.lowercase())
        }
        Dialog(
            onDismissRequest = { showingDebug = false },
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            Surface(Modifier.fillMaxSize()) {
                ScannerDebugPanel(
                    isRecording = recorder.isRecording,
                    recording = recording,
                    importedRecording = importedRecording,
                    replayRunning = replayRunning,
                    replayProcessedFrames = replayComparisons.size,
                    replayReport = replayReport,
                    referenceSnapshot = referenceSnapshot,
                    options = options,
                    capabilities = capabilities,
                    game = selectedGame,
                    availableGames = supportedGames,
                    onGameChanged = {
                        selectedGame = it
                        updateOptions(options)
                    },
                    replayAvailable = scannerRequestHandler != null && (importedRecording?.replayableFrameCount ?: 0) > 0,
                    liveDebugRunning = liveDebugLog.isRunning,
                    liveDebugEvents = remember(liveDebugVersion) { liveDebugLog.snapshot() },
                    liveDebugFrameCount = liveDebugFrameCount,
                    liveDebugLatestTimingMs = liveDebugLatestTimingMs,
                    liveGeometry = liveGeometry,
                    latestDecisionDiagnostics = latestDecisionDiagnostics,
                    assetDiagnostics = assetDiagnostics,
                    diagnosticsRunning = diagnosticsRunning,
                    onRefreshDiagnostics = ::runAssetDiagnostics,
                    savedRecordings = savedRecordings,
                    onSaveSession = {
                        runCatching { recordingSessionStore.save(recording) }
                            .onSuccess { refreshSavedRecordings() }
                            .onFailure { ioMessage = it.message }
                    },
                    onLoadSaved = { id ->
                        runCatching { recordingSessionStore.load(id) }
                            .onSuccess {
                                importedRecording = localImport(it)
                                replayReport = null
                            }
                            .onFailure { ioMessage = it.message }
                    },
                    onExportSaved = { id ->
                        runCatching { recordingSessionStore.load(id) }
                            .onSuccess {
                                pendingRecordingExport = it
                                exportRecording.launch("tcger-$id.json")
                            }
                            .onFailure { ioMessage = it.message }
                    },
                    onShareSaved = { id ->
                        runCatching { recordingSessionStore.load(id) }
                            .onSuccess { shareRecording(it, "tcger-$id.json") }
                            .onFailure { ioMessage = it.message }
                    },
                    onDeleteSaved = { id ->
                        val liveReferences = recording.frames.flatMap(RecordedScannerFrame::attemptImages)
                            .map(ScannerAttemptImageReference::fileName)
                            .toSet()
                        scope.launch {
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    val deleted = recordingSessionStore.load(id)
                                    check(recordingSessionStore.delete(id)) { "Could not delete scanner recording" }
                                    val retainedNames = liveReferences + recordingSessionStore.list().flatMap { saved ->
                                        recordingSessionStore.load(saved.id).frames
                                            .flatMap(RecordedScannerFrame::attemptImages)
                                            .map(ScannerAttemptImageReference::fileName)
                                    }
                                    val removable = deleted.frames.flatMap(RecordedScannerFrame::attemptImages)
                                        .filterNot { it.fileName in retainedNames }
                                    attemptImageStore.delete(removable)
                                }
                            }.onSuccess { refreshSavedRecordings() }
                                .onFailure { ioMessage = it.message }
                        }
                    },
                    onExportAllSessions = { exportAllRecordings.launch("tcger-android-scanner-sessions.json") },
                    onOptionsChanged = ::updateOptions,
                    onToggleRecording = {
                        if (recorder.isRecording) recorder.pause() else recorder.start()
                        recorderVersion += 1
                    },
                    onClear = {
                        val references = recorder.clear()
                        scope.launch { withContext(Dispatchers.IO) { attemptImageStore.delete(references) } }
                        recorderVersion += 1
                    },
                    onExportRecording = { exportRecording.launch("tcger-android-scanner-recording.json") },
                    onShareRecording = {
                        shareRecording(recording, "tcger-android-scanner-recording.json")
                    },
                    onImportRecording = { importRecording.launch(arrayOf("application/json", "text/plain")) },
                    onReplayImported = ::startReplay,
                    onRunReferenceSet = ::startReferenceSet,
                    onCancelReferenceSet = {
                        referenceSnapshot = referenceRunner.cancel()
                        referenceRequest = null
                    },
                    onToggleLiveDebug = {
                        if (liveDebugLog.isRunning) liveDebugLog.stop() else liveDebugLog.start()
                        liveDebugVersion += 1
                    },
                    onClearLiveDebug = {
                        liveDebugLog.clear()
                        liveDebugFrameCount = 0
                        liveDebugLatestTimingMs = null
                        liveDebugVersion += 1
                    },
                    onExportOptions = { exportOptions.launch("tcger-android-scanner-options.json") },
                    onImportOptions = { importOptions.launch(arrayOf("application/json", "text/plain")) },
                    onClose = { showingDebug = false },
                )
            }
        }
    }

    ioMessage?.let { message ->
        AlertDialog(
            onDismissRequest = { ioMessage = null },
            title = { Text("Scanner") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { ioMessage = null }) { Text("OK") } },
        )
    }
}

@Composable
private fun ScannerCapturePane(
    state: AppUiState,
    contentPadding: PaddingValues,
    supportedGames: List<String>,
    selectedGame: String,
    onSelectedGame: (String) -> Unit,
    onCaptured: (ByteArray, Boolean) -> Unit,
    fastCapture: Boolean,
    automaticCapture: Boolean,
    automaticIntervalMillis: Long,
    onPickPhoto: () -> Unit,
    canAdjustCrop: Boolean,
    onAdjustCrop: () -> Unit,
    resultAvailable: Boolean,
    onOpenResult: () -> Unit,
    automaticCaptureNeedsRearm: Boolean,
    onNextAutomaticCard: () -> Unit,
    onTestRecognize: () -> Unit,
    demoCaptureMode: ScannerCaptureMode,
    showTestingTools: Boolean,
    sessionEntries: List<ScannerSessionEntry>,
    consensusUpdate: AutoScanConsensusUpdate?,
    onReviewSession: () -> Unit,
    onClearSession: () -> Unit,
    liveDebugRunning: Boolean,
    liveDebugFrameCount: Int,
    liveDebugLatestTimingMs: Double?,
    liveGeometry: ScannerLiveGeometry,
) {
    val context = LocalContext.current
    var hasCameraPermission by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        hasCameraPermission = it
    }
    LaunchedEffect(Unit) {
        if (!hasCameraPermission && !ParityTestMode.isEnabled) permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = 4.dp,
            bottom = contentPadding.calculateBottomPadding() + 24.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                supportedGames.forEach { game ->
                    FilterChip(
                        selected = selectedGame == game,
                        onClick = { onSelectedGame(game) },
                        label = { Text(game.displayGame()) },
                    )
                }
            }
        }
        if (ParityTestMode.isEnabled || showTestingTools) {
            item {
                Button(
                    modifier = Modifier.fillMaxWidth().testTag(
                        if (ParityTestMode.isEnabled) ParityControlIDs.ACTION_SCANNER_TEST_RECOGNIZE
                        else if (demoCaptureMode == ScannerCaptureMode.BINDER) ParityControlIDs.ACTION_SCANNER_DEBUG_DEMO_BINDER_PAGE
                        else ParityControlIDs.ACTION_SCANNER_DEBUG_DEMO_CARD,
                    ),
                    onClick = onTestRecognize,
                ) {
                    Text(
                        if (ParityTestMode.isEnabled) "Recognize scanner test card"
                        else if (demoCaptureMode == ScannerCaptureMode.BINDER) "Run demo binder page"
                        else "Run demo card",
                    )
                }
            }
        }
        item {
            ScannerSessionTray(
                entries = sessionEntries,
                consensus = consensusUpdate,
                onReview = onReviewSession,
                onClear = onClearSession,
            )
        }
        if (automaticCaptureNeedsRearm) {
            item {
                Button(onClick = onNextAutomaticCard, modifier = Modifier.fillMaxWidth()) {
                    Text("Next card")
                }
                Text(
                    "Automatic add is paused. Remove the accepted card from the guide, or tap Next card to rearm.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        item {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(420.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(Color.Black),
                contentAlignment = Alignment.Center,
            ) {
                when {
                    ParityTestMode.isEnabled -> Text("Camera preview", color = Color.White)
                    hasCameraPermission -> CameraPreview(
                        onCaptured = onCaptured,
                        fastCapture = fastCapture,
                        automaticCapture = automaticCapture,
                        automaticIntervalMillis = automaticIntervalMillis,
                        isProcessing = state.isScanning,
                    )
                    else -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Camera permission is needed to scan live.", color = Color.White)
                        Spacer(Modifier.height(8.dp))
                        Button(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) { Text("Allow camera") }
                    }
                }
                Box(
                    Modifier
                        .fillMaxWidth(0.68f)
                        .aspectRatio(0.714f)
                        .border(3.dp, Color.White.copy(alpha = 0.9f), RoundedCornerShape(18.dp)),
                )
                if (liveDebugRunning) {
                    Text(
                        "DEBUG LIVE · frame $liveDebugFrameCount · ${liveDebugLatestTimingMs?.let { "${it.toInt()} ms" } ?: "waiting"}\n${liveGeometry.label}",
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .padding(12.dp)
                            .background(Color.Black.copy(alpha = 0.72f), RoundedCornerShape(8.dp))
                            .padding(horizontal = 8.dp, vertical = 5.dp),
                        color = Color(0xFF80FF9A),
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
                if (state.isScanning) {
                    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator(color = Color.White)
                            Spacer(Modifier.height(12.dp))
                            Text("Identifying card…", color = Color.White, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
        item {
            Text(
                "Fill the frame with one ${supportedGames.joinToString(" or ") { it.displayGame() }} card. Keep the title sharp and reduce glare.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        item {
            if (resultAvailable) {
                Button(onClick = onOpenResult, modifier = Modifier.fillMaxWidth()) { Text("Review latest result") }
            }
            OutlinedButton(
                modifier = Modifier.fillMaxWidth().testTag(ParityControlIDs.ACTION_SCANNER_PICK_PHOTO),
                enabled = !state.isScanning,
                onClick = onPickPhoto,
            ) {
                Icon(Icons.Default.PhotoLibrary, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Choose photo")
            }
            if (canAdjustCrop) {
                OutlinedButton(
                    modifier = Modifier.fillMaxWidth().testTag(ParityControlIDs.ACTION_SCANNER_ADJUST_CROP),
                    onClick = onAdjustCrop,
                ) { Text("Adjust last crop") }
            }
        }
    }
}

@Composable
private fun CameraPreview(
    onCaptured: (ByteArray, Boolean) -> Unit,
    fastCapture: Boolean,
    automaticCapture: Boolean,
    automaticIntervalMillis: Long,
    isProcessing: Boolean,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    val controller = remember(fastCapture) {
        LifecycleCameraController(context).apply {
            cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
            imageCaptureMode = if (fastCapture) {
                ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY
            } else {
                ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY
            }
            setEnabledUseCases(CameraController.IMAGE_CAPTURE)
        }
    }
    var cameraError by remember { mutableStateOf<String?>(null) }
    var captureInFlight by remember { mutableStateOf(false) }
    var torchAvailable by remember { mutableStateOf(false) }
    var torchEnabled by remember { mutableStateOf(false) }

    DisposableEffect(lifecycleOwner, controller) {
        val torchObserver = Observer<Int> { torchEnabled = it == TorchState.ON }
        runCatching { controller.bindToLifecycle(lifecycleOwner) }
            .onSuccess {
                torchAvailable = runCatching { controller.cameraInfo?.hasFlashUnit() == true }.getOrDefault(false)
                controller.torchState.observe(lifecycleOwner, torchObserver)
            }
            .onFailure { cameraError = "Live camera is unavailable. You can still choose a photo." }
        onDispose {
            controller.torchState.removeObserver(torchObserver)
            runCatching { controller.enableTorch(false) }
            controller.unbind()
        }
    }

    val captureImage: (Boolean) -> Unit = capture@ { automatic ->
        if (captureInFlight || (automatic && isProcessing)) return@capture
        captureInFlight = true
        val output = runCatching { File.createTempFile("tcger-scan-", ".jpg", context.cacheDir) }
            .getOrElse {
                captureInFlight = false
                cameraError = "A temporary capture file could not be created."
                return@capture
            }
        val captureOptions = ImageCapture.OutputFileOptions.Builder(output).build()
        runCatching {
            controller.takePicture(
                captureOptions,
                ContextCompat.getMainExecutor(context),
                object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                        scope.launch {
                            val bytes = withContext(Dispatchers.IO) {
                                try {
                                    output.readBytes()
                                } finally {
                                    output.delete()
                                }
                            }
                            captureInFlight = false
                            onCaptured(bytes, automatic)
                        }
                    }

                    override fun onError(exception: ImageCaptureException) {
                        output.delete()
                        captureInFlight = false
                        cameraError = exception.message ?: "The camera could not capture this image."
                    }
                },
            )
        }.onFailure {
            output.delete()
            captureInFlight = false
            cameraError = it.message ?: "The camera could not capture this image."
        }
    }

    LaunchedEffect(automaticCapture, automaticIntervalMillis, isProcessing, controller) {
        if (!automaticCapture) return@LaunchedEffect
        while (true) {
            delay(automaticIntervalMillis)
            if (!isProcessing && !captureInFlight) captureImage(true)
        }
    }

    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { previewContext ->
                PreviewView(previewContext).apply {
                    scaleType = PreviewView.ScaleType.FILL_CENTER
                    this.controller = controller
                }
            },
        )
        if (automaticCapture) {
            Text(
                "AUTO · ${automaticIntervalMillis / 1000.0}s",
                modifier = Modifier.align(Alignment.TopCenter).padding(14.dp).background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(12.dp)).padding(horizontal = 10.dp, vertical = 5.dp),
                color = Color.White,
                style = MaterialTheme.typography.labelMedium,
            )
        }
        cameraError?.let { Text(it, color = Color.White, modifier = Modifier.padding(24.dp)) }
        IconButton(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(22.dp)
                .size(68.dp)
                .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(34.dp))
            .testTag(ParityControlIDs.ACTION_SCANNER_CAPTURE),
            enabled = !captureInFlight && !isProcessing,
            onClick = { captureImage(false) },
        ) { Icon(Icons.Default.CameraAlt, contentDescription = "Capture card", tint = MaterialTheme.colorScheme.onPrimary) }
        if (torchAvailable) {
            IconButton(
                onClick = {
                    runCatching { controller.enableTorch(!torchEnabled) }
                        .onFailure { cameraError = it.message ?: "The flashlight could not be changed." }
                },
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(22.dp)
                    .size(52.dp)
                    .background(Color.Black.copy(alpha = 0.62f), RoundedCornerShape(26.dp))
                    .testTag(ParityControlIDs.ACTION_SCANNER_TOGGLE_TORCH),
            ) {
                Icon(
                    if (torchEnabled) Icons.Default.FlashlightOn else Icons.Default.FlashlightOff,
                    contentDescription = if (torchEnabled) "Turn off flashlight" else "Turn on flashlight",
                    tint = if (torchEnabled) Color.Yellow else Color.White,
                )
            }
        }
    }
}

private fun formatScannerAssetBytes(bytes: Long): String = when {
    bytes <= 0L -> "preparing…"
    bytes < 1_000_000L -> "${bytes / 1_000} KB"
    else -> String.format("%.1f MB", bytes / 1_000_000.0)
}
