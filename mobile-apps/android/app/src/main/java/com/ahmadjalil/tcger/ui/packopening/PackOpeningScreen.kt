package com.ahmadjalil.tcger.ui.packopening

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Base64
import android.view.HapticFeedbackConstants
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Casino
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Collections
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Flip
import androidx.compose.material.icons.filled.BookmarkAdd
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Style
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import com.ahmadjalil.tcger.ParityTestMode
import com.ahmadjalil.tcger.generated.ParityControlIDs
import com.ahmadjalil.tcger.generated.ParityFeatureIDs
import java.text.NumberFormat
import kotlin.math.abs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Stable semantics used by shared Android/iOS UI checks. */
object PackOpeningTestTags {
    val SCREEN = ParityFeatureIDs.screen(ParityFeatureIDs.PACK_OPENING_BROWSE)
    const val SELECT_PACK = ParityControlIDs.ACTION_PACK_OPENING_CHOOSE_SET
    const val OPEN = ParityControlIDs.ACTION_PACK_OPENING_START
    const val NORMAL_MODE = ParityControlIDs.OPTION_PACK_OPENING_MODE_NORMAL
    const val QUICK_MODE = ParityControlIDs.OPTION_PACK_OPENING_MODE_QUICK
    const val COUNT_ONE = ParityControlIDs.OPTION_PACK_OPENING_COUNT1
    const val COUNT_FIVE = ParityControlIDs.OPTION_PACK_OPENING_COUNT5
    const val COUNT_TEN = ParityControlIDs.OPTION_PACK_OPENING_COUNT10
    const val TOGGLE_ORIENTATION = ParityControlIDs.ACTION_PACK_OPENING_TOGGLE_ORIENTATION
    const val ADVANCE = ParityControlIDs.ACTION_PACK_OPENING_ADVANCE
    const val SHOW_ALL = ParityControlIDs.ACTION_PACK_OPENING_SHOW_ALL
    const val POSSIBLE_CARDS = ParityControlIDs.ACTION_PACK_OPENING_POSSIBLE_CARDS
    const val ODDS = ParityControlIDs.ACTION_PACK_OPENING_ODDS_REFERENCE
    const val CUSTOM_ARTWORK = ParityControlIDs.ACTION_PACK_OPENING_CHOOSE_ARTWORK
    const val SAVE = ParityControlIDs.ACTION_PACK_OPENING_SAVE_PULLS
    const val OPEN_MORE = ParityControlIDs.ACTION_PACK_OPENING_BACK_TO_PACKS
    const val RETRY = "action.packOpening.retry"
    val RESULTS = ParityFeatureIDs.screen(ParityFeatureIDs.PACK_OPENING_RESULTS_GROUPED)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PackOpeningScreen(
    onClose: () -> Unit,
    onSavePulls: (PackOpeningPullSession) -> Unit,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    onInspectPull: ((PackOpeningPull) -> Unit)? = null,
    testMode: Boolean = ParityTestMode.isEnabled,
    debug: Boolean = false,
    remoteAssetBaseURL: String = "https://assets.tcger.ahmadjalil.com",
    offlineDownloadManager: PackOfflineDownloadManager? = null,
    onOfflineStatusChanged: (PackOfflineStatusSnapshot) -> Unit = {},
    onFavoritePull: ((PackOpeningPull) -> Unit)? = null,
    onWishlistPull: ((PackOpeningPull) -> Unit)? = null,
    onSharePull: ((PackOpeningPull) -> Unit)? = null,
) {
    var state by remember { mutableStateOf(PackOpeningState.Loading) }
    var command by remember { mutableStateOf<PackOpeningCommand?>(null) }
    var rendererReady by remember { mutableStateOf(false) }
    var remoteAssetsUsable by remember(testMode) { mutableStateOf(testMode) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var hostWarning by remember { mutableStateOf<String?>(null) }
    var reloadKey by remember { mutableIntStateOf(0) }
    var showingPackPicker by remember { mutableStateOf(false) }
    var showingCards by remember { mutableStateOf(false) }
    var showingOdds by remember { mutableStateOf(false) }
    var inspection by remember { mutableStateOf<PackInspectionState?>(null) }
    val context = LocalContext.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val resolvedOfflineManager = remember(context, remoteAssetBaseURL, offlineDownloadManager) {
        offlineDownloadManager ?: PackOfflineDownloadManager(context, remoteAssetBaseURL)
    }
    var offlineStatuses by remember { mutableStateOf<Map<String, PackOfflineSetStatus>>(emptyMap()) }

    DisposableEffect(resolvedOfflineManager, offlineDownloadManager) {
        val removeObserver = resolvedOfflineManager.observe { snapshot ->
            scope.launch {
                offlineStatuses = offlineStatuses + (snapshot.setID to snapshot.status)
                onOfflineStatusChanged(snapshot)
            }
        }
        onDispose {
            removeObserver()
            if (offlineDownloadManager == null) resolvedOfflineManager.close()
        }
    }

    LaunchedEffect(state.packSets, resolvedOfflineManager) {
        offlineStatuses = state.packSets.associate { it.id to resolvedOfflineManager.status(it.id) }
    }

    fun send(next: PackOpeningCommand) { command = next }
    fun send(action: PackOpeningAction) { send(PackOpeningCommand(action)) }
    fun inspect(pulls: List<PackOpeningPull>, pull: PackOpeningPull) {
        val index = pulls.indexOfFirst { it.cardId == pull.cardId }.coerceAtLeast(0)
        inspection = PackInspectionState(pulls.ifEmpty { listOf(pull) }, index)
        onInspectPull?.invoke(pull)
    }

    val artworkPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri ?: return@rememberLauncherForActivityResult
        scope.launch {
            val selected = withContext(Dispatchers.IO) {
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    ?: return@withContext null
                val mime = context.contentResolver.getType(uri)?.takeIf { it.startsWith("image/") }
                    ?: "image/jpeg"
                Triple(bytes, mime, uri.lastPathSegment?.substringAfterLast('/') ?: "Custom Artwork")
            }
            if (selected == null) {
                hostWarning = "That image could not be read."
            } else if (selected.first.size > MAX_ARTWORK_BYTES) {
                hostWarning = "Choose an image smaller than 8 MB."
            } else {
                val dataURL = "data:${selected.second};base64," +
                    Base64.encodeToString(selected.first, Base64.NO_WRAP)
                send(PackOpeningCommand.uploadArtwork(dataURL, selected.third))
                hostWarning = null
            }
        }
    }

    LaunchedEffect(reloadKey, rendererReady) {
        if (!rendererReady) {
            delay(15_000)
            if (!rendererReady && errorMessage == null) {
                errorMessage = "The pack renderer took too long to start."
            }
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .testTag(PackOpeningTestTags.SCREEN),
    ) {
        // Keep the renderer alive behind native results. Save/Open More are
        // commands to that same session, and remounting would lose its pulls.
        PackOpeningWebHost(
            command = command,
            reloadKey = reloadKey,
            config = PackOpeningHostConfig(
                remoteAssetBaseURL = remoteAssetBaseURL,
                deterministic = testMode,
                debug = debug,
            ),
            offlineDownloadManager = resolvedOfflineManager,
            interactive = !state.showsNativeResults,
            modifier = Modifier.fillMaxSize().alpha(if (state.showsNativeResults) 0f else 1f),
            onRemoteAssetAvailabilityChanged = { remoteAssetsUsable = it },
        ) { event ->
            when (event) {
                PackOpeningBridgeEvent.Ready -> {
                    rendererReady = true
                    errorMessage = null
                }
                is PackOpeningBridgeEvent.NativeState -> state = event.state
                is PackOpeningBridgeEvent.Error -> errorMessage = event.message
                is PackOpeningBridgeEvent.Haptic -> view.performHapticFeedback(
                    when (event.style) {
                        "success" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                            HapticFeedbackConstants.CONFIRM
                        } else HapticFeedbackConstants.LONG_PRESS
                        "impact" -> HapticFeedbackConstants.LONG_PRESS
                        else -> HapticFeedbackConstants.VIRTUAL_KEY
                    },
                )
                is PackOpeningBridgeEvent.SaveRequested -> onSavePulls(event.session)
                is PackOpeningBridgeEvent.InspectRequested -> {
                    inspect(listOf(event.pull), event.pull)
                }
                is PackOpeningBridgeEvent.PhaseChanged -> Unit
            }
        }
        if (state.showsNativeResults) {
            state.session?.let { session ->
                PackOpeningResults(
                    session = session,
                    contentPadding = contentPadding,
                    imageModel = { url -> resolvedOfflineManager.cachedAssetFile(url) ?: url },
                    onInspect = { pull -> inspect(session.pulls, pull) },
                )
            }
        }

        PackOpeningTopBar(
            state = state,
            onClose = onClose,
            onChooseArtwork = { artworkPicker.launch("image/*") },
        )

        when {
            errorMessage != null -> PackOpeningError(
                message = errorMessage.orEmpty(),
                contentPadding = contentPadding,
                onRetry = {
                    errorMessage = null
                    hostWarning = null
                    state = PackOpeningState.Loading
                    command = null
                    rendererReady = false
                    reloadKey++
                },
            )
            !rendererReady -> PackOpeningLoading(contentPadding)
            else -> PackOpeningControls(
                state = state,
                canOpenSelected = canOpenPackSet(
                    state.selectedPackOption?.resolvedSetID.orEmpty(),
                    remoteAssetsUsable,
                    offlineStatuses,
                ),
                hostWarning = hostWarning,
                contentPadding = contentPadding,
                modifier = Modifier.align(Alignment.BottomCenter),
                onCommand = ::send,
                onChoosePack = { showingPackPicker = true },
                onShowCards = { showingCards = true },
                onShowOdds = { showingOdds = true },
            )
        }
    }

    if (showingPackPicker) {
        PackPickerSheet(
            state = state,
            offlineStatuses = offlineStatuses,
            remoteAssetsUsable = remoteAssetsUsable,
            onDismiss = { showingPackPicker = false },
            onSelect = {
                send(PackOpeningCommand.selectPack(it))
                showingPackPicker = false
            },
            onDownload = resolvedOfflineManager::download,
            onRetry = resolvedOfflineManager::retry,
            onRemove = resolvedOfflineManager::remove,
        )
    }
    if (showingCards) {
        PossibleCardsSheet(
            pool = state.selectedCardPool,
            onDismiss = { showingCards = false },
            imageModel = { url -> resolvedOfflineManager.cachedAssetFile(url) ?: url },
            onInspect = { pull -> inspect(state.selectedCardPool?.cards.orEmpty(), pull) },
        )
    }
    if (showingOdds) {
        OddsDialog(
            odds = state.selectedOddsReference,
            onDismiss = { showingOdds = false },
            onOpenSource = { url ->
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
            },
        )
    }
    inspection?.let { current ->
        PullInspectionOverlay(
            state = current,
            imageModel = { url -> resolvedOfflineManager.cachedAssetFile(url) ?: url },
            onIndexChanged = { index ->
                inspection = current.copy(index = index)
                onInspectPull?.invoke(current.pulls[index])
            },
            onDismiss = { inspection = null },
            onFavorite = onFavoritePull,
            onWishlist = onWishlistPull,
            onShare = { pull ->
                onSharePull?.invoke(pull) ?: sharePull(context, pull)
            },
        )
    }
}

@Composable
private fun PackOpeningTopBar(
    state: PackOpeningState,
    onClose: () -> Unit,
    onChooseArtwork: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(shape = RoundedCornerShape(24.dp), tonalElevation = 5.dp) {
            IconButton(onClick = onClose) { Icon(Icons.Default.Close, contentDescription = "Done") }
        }
        if (state.showsNativeResults) {
            Surface(shape = RoundedCornerShape(18.dp), tonalElevation = 5.dp) {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 9.dp)) {
                    Text(state.session?.packLabel.orEmpty(), fontWeight = FontWeight.Bold)
                    Text(
                        "${state.session?.packs?.size ?: 0} packs · ${state.session?.pulls?.size ?: 0} cards",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else {
            Spacer(Modifier.weight(1f))
        }
        if (state.phase == PackOpeningPhase.SELECT) {
            Surface(shape = RoundedCornerShape(24.dp), tonalElevation = 5.dp) {
                IconButton(
                    modifier = Modifier.testTag(PackOpeningTestTags.CUSTOM_ARTWORK),
                    onClick = onChooseArtwork,
                ) { Icon(Icons.Default.PhotoLibrary, contentDescription = "Choose pack photo") }
            }
        } else {
            Spacer(Modifier.width(48.dp))
        }
    }
}

@Composable
private fun PackOpeningLoading(contentPadding: PaddingValues) {
    Box(
        Modifier.fillMaxSize().padding(bottom = contentPadding.calculateBottomPadding()),
        contentAlignment = Alignment.Center,
    ) {
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh)) {
            Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 3.dp)
                Spacer(Modifier.width(12.dp))
                Text("Preparing packs…", fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun PackOpeningError(message: String, contentPadding: PaddingValues, onRetry: () -> Unit) {
    Box(
        Modifier.fillMaxSize().padding(24.dp).padding(bottom = contentPadding.calculateBottomPadding()),
        contentAlignment = Alignment.Center,
    ) {
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh)) {
            Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Default.Refresh, contentDescription = null)
                Spacer(Modifier.height(12.dp))
                Text("Pack Opening Unavailable", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(18.dp))
                Button(
                    modifier = Modifier.testTag(PackOpeningTestTags.RETRY),
                    onClick = onRetry,
                ) { Text("Try Again") }
            }
        }
    }
}

@Composable
private fun PackOpeningControls(
    state: PackOpeningState,
    canOpenSelected: Boolean,
    hostWarning: String?,
    contentPadding: PaddingValues,
    modifier: Modifier = Modifier,
    onCommand: (PackOpeningCommand) -> Unit,
    onChoosePack: () -> Unit,
    onShowCards: () -> Unit,
    onShowOdds: () -> Unit,
) {
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp)
            .padding(bottom = contentPadding.calculateBottomPadding() + 12.dp)
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.94f), RoundedCornerShape(24.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        (hostWarning ?: state.warning)?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
        }
        when (state.phase) {
            PackOpeningPhase.SELECT -> SelectControls(
                state,
                canOpenSelected,
                onCommand,
                onChoosePack,
                onShowCards,
                onShowOdds,
            )
            PackOpeningPhase.TEAR -> {
                Text(
                    if (state.packBackwards) "Back facing · swipe the seal, or open it now" else "Swipe the seal, or open it now",
                    fontWeight = FontWeight.SemiBold,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BackToPacksButton(onCommand)
                    OutlinedButton(
                        modifier = Modifier.weight(1f).testTag(PackOpeningTestTags.TOGGLE_ORIENTATION),
                        onClick = { onCommand(PackOpeningCommand(PackOpeningAction.TOGGLE_PACK_ORIENTATION)) },
                    ) {
                        Icon(Icons.Default.Flip, contentDescription = null)
                        Spacer(Modifier.width(6.dp))
                        Text(if (state.packBackwards) "Face Front" else "Flip Pack")
                    }
                    Button(
                        modifier = Modifier.weight(1f).testTag(PackOpeningTestTags.ADVANCE),
                        onClick = { onCommand(PackOpeningCommand(PackOpeningAction.ADVANCE)) },
                    ) { Text("Open Pack") }
                }
                if (state.totalPacks > 1) {
                    ShowAllButton("Skip Animations · Keep Grouped Results", onCommand, Modifier.fillMaxWidth())
                }
            }
            PackOpeningPhase.OPENING -> {
                Text(
                    if (state.totalPacks > 1) "Opening ${state.totalPacks} packs…" else "Opening your pack…",
                    fontWeight = FontWeight.SemiBold,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BackToPacksButton(onCommand)
                    if (state.totalPacks > 1) ShowAllButton("Skip to Results", onCommand, Modifier.weight(1f))
                }
            }
            PackOpeningPhase.REVEAL -> {
                Text(revealInstruction(state), fontWeight = FontWeight.SemiBold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (!state.packBackwards) BackToPacksButton(onCommand)
                    Button(
                        modifier = Modifier.weight(1f).testTag(PackOpeningTestTags.ADVANCE),
                        onClick = { onCommand(PackOpeningCommand(PackOpeningAction.ADVANCE)) },
                    ) { Text(revealActionLabel(state)) }
                    ShowAllButton(if (state.totalPacks > 1) "Skip to Results" else "Show All", onCommand, Modifier.weight(1f))
                }
            }
            PackOpeningPhase.SUMMARY, PackOpeningPhase.FINAL -> {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (state.canSave) {
                        Button(
                            modifier = Modifier.weight(1f).testTag(PackOpeningTestTags.SAVE),
                            onClick = { onCommand(PackOpeningCommand(PackOpeningAction.SAVE_PULLS)) },
                        ) {
                            Icon(Icons.Default.Save, contentDescription = null)
                            Spacer(Modifier.width(6.dp))
                            Text("Save Pulls")
                        }
                    }
                    OutlinedButton(
                        modifier = Modifier.weight(1f).testTag(PackOpeningTestTags.OPEN_MORE),
                        onClick = { onCommand(PackOpeningCommand(PackOpeningAction.BACK_TO_PACKS)) },
                    ) { Text("Open More") }
                }
            }
            PackOpeningPhase.LOADING -> Unit
        }
    }
}

@Composable
private fun SelectControls(
    state: PackOpeningState,
    canOpenSelected: Boolean,
    onCommand: (PackOpeningCommand) -> Unit,
    onChoosePack: () -> Unit,
    onShowCards: () -> Unit,
    onShowOdds: () -> Unit,
) {
    if (state.packCount == 1) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(
                modifier = Modifier.weight(1f).testTag(PackOpeningTestTags.NORMAL_MODE),
                selected = state.openingMode == PackOpeningMode.NORMAL,
                onClick = { onCommand(PackOpeningCommand.setOpeningMode(PackOpeningMode.NORMAL)) },
                label = { Text("Open Normally") },
                leadingIcon = { Icon(Icons.Default.Style, contentDescription = null, Modifier.size(18.dp)) },
            )
            FilterChip(
                modifier = Modifier.weight(1f).testTag(PackOpeningTestTags.QUICK_MODE),
                selected = state.openingMode == PackOpeningMode.QUICK,
                onClick = { onCommand(PackOpeningCommand.setOpeningMode(PackOpeningMode.QUICK)) },
                label = { Text("Quick Open") },
                leadingIcon = { Icon(Icons.Default.Bolt, contentDescription = null, Modifier.size(18.dp)) },
            )
        }
    } else {
        Text("${state.packCount}-Pack Summary", fontWeight = FontWeight.SemiBold)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedButton(
            modifier = Modifier.weight(1f).testTag(PackOpeningTestTags.SELECT_PACK),
            onClick = onChoosePack,
        ) {
            Icon(Icons.Default.Collections, contentDescription = null)
            Spacer(Modifier.width(7.dp))
            Text(
                if (canOpenSelected) state.selectedPackDisplayLabel else "Choose an Available Pack",
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (state.selectedCardPool != null) {
            IconButton(
                modifier = Modifier.testTag(PackOpeningTestTags.POSSIBLE_CARDS),
                onClick = onShowCards,
            ) { Icon(Icons.Default.Casino, contentDescription = "View possible cards") }
        }
        if (state.selectedOddsReference != null) {
            IconButton(
                modifier = Modifier.testTag(PackOpeningTestTags.ODDS),
                onClick = onShowOdds,
            ) { Icon(Icons.Default.Info, contentDescription = "View odds source") }
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        listOf(1, 5, 10).forEach { count ->
            FilterChip(
                modifier = Modifier.testTag(
                    when (count) {
                        1 -> PackOpeningTestTags.COUNT_ONE
                        5 -> PackOpeningTestTags.COUNT_FIVE
                        else -> PackOpeningTestTags.COUNT_TEN
                    },
                ),
                selected = state.packCount == count,
                onClick = { onCommand(PackOpeningCommand.setPackCount(count)) },
                label = { Text("×$count") },
            )
        }
        Button(
            modifier = Modifier.weight(1f).testTag(PackOpeningTestTags.OPEN),
            onClick = { onCommand(PackOpeningCommand(PackOpeningAction.OPEN_PACK)) },
            enabled = canOpenSelected,
        ) { Text(if (state.packCount == 1) "Open Pack" else "Open ${state.packCount} Packs") }
    }
}

@Composable
private fun BackToPacksButton(onCommand: (PackOpeningCommand) -> Unit) {
    OutlinedButton(onClick = { onCommand(PackOpeningCommand(PackOpeningAction.BACK_TO_PACKS)) }) {
        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
        Spacer(Modifier.width(4.dp))
        Text("Packs")
    }
}

@Composable
private fun ShowAllButton(
    label: String,
    onCommand: (PackOpeningCommand) -> Unit,
    modifier: Modifier = Modifier,
) {
    OutlinedButton(
        modifier = modifier.testTag(PackOpeningTestTags.SHOW_ALL),
        onClick = { onCommand(PackOpeningCommand(PackOpeningAction.SHOW_ALL)) },
    ) { Text(label) }
}

private fun revealInstruction(state: PackOpeningState): String = when {
    !state.packBackwards -> "${state.revealedCount} of ${state.totalCards} cards revealed"
    state.currentCardFaceUp -> "Swipe card away"
    else -> "Tap to flip"
}

private fun revealActionLabel(state: PackOpeningState): String = when {
    state.revealedCount >= state.totalCards && state.currentCardFaceUp -> "Finish"
    !state.packBackwards -> "Reveal Next"
    state.currentCardFaceUp -> "Slide Card"
    else -> "Flip Card"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PackPickerSheet(
    state: PackOpeningState,
    offlineStatuses: Map<String, PackOfflineSetStatus>,
    remoteAssetsUsable: Boolean,
    onDismiss: () -> Unit,
    onSelect: (String) -> Unit,
    onDownload: (PackOfflineSetRequest) -> Unit,
    onRetry: (PackOfflineSetRequest) -> Unit,
    onRemove: (String) -> Unit,
) {
    var searchText by remember { mutableStateOf("") }
    var availabilityFilter by remember { mutableStateOf(PackSetAvailabilityFilter.ALL) }
    val effectiveAvailability = if (remoteAssetsUsable) availabilityFilter else PackSetAvailabilityFilter.ALL
    val sets = filterPackSets(state.packSets, searchText, effectiveAvailability, offlineStatuses)
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Text("Choose a Set", Modifier.padding(horizontal = 20.dp), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        OutlinedTextField(
            value = searchText,
            onValueChange = { searchText = it },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)
                .testTag(ParityControlIDs.INPUT_PACK_OPENING_SET_SEARCH),
            label = { Text("Search sets or packs") },
            singleLine = true,
        )
        if (remoteAssetsUsable) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                PackSetAvailabilityFilter.entries.forEach { filter ->
                    FilterChip(
                        modifier = Modifier.testTag(filter.controlID),
                        selected = availabilityFilter == filter,
                        onClick = { availabilityFilter = filter },
                        label = { Text(filter.label) },
                    )
                }
            }
        } else {
            Text(
                "Downloaded packs are available; others are disabled",
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        LazyColumn(
            Modifier.fillMaxWidth().fillMaxHeight(0.85f),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (sets.isEmpty()) {
                item("empty-pack-filter") {
                    Column(
                        Modifier.fillMaxWidth().padding(vertical = 36.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text("No Sets Found", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text("Try another search or download filter.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        TextButton(onClick = {
                            searchText = ""
                            availabilityFilter = PackSetAvailabilityFilter.ALL
                        }) { Text("Show All Sets") }
                    }
                }
            }
            sets.forEach { set ->
                val isAccessible = canOpenPackSet(set.id, remoteAssetsUsable, offlineStatuses)
                item(key = "set-${set.id}") {
                    val poolID = set.options.firstOrNull()?.packPoolID ?: set.id
                    val pool = state.cardPools.firstOrNull { it.id.equals(poolID, ignoreCase = true) }
                    val request = set.offlineRequest(pool)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(set.label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text(
                                "${set.options.size} ${if (set.options.size == 1) "variant" else "variants"}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (!isAccessible) {
                                Text(
                                    "Not downloaded · unavailable offline",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        PackOfflineDownloadControl(
                            status = offlineStatuses[set.id] ?: PackOfflineSetStatus.NotDownloaded,
                            remoteAssetsUsable = remoteAssetsUsable,
                            onDownload = { onDownload(request) },
                            onRetry = { onRetry(request) },
                            onRemove = { onRemove(set.id) },
                        )
                    }
                }
                items(set.options, key = PackOpeningPackOption::id) { option ->
                    Surface(
                        modifier = Modifier.fillMaxWidth()
                            .alpha(if (isAccessible) 1f else 0.48f)
                            .testTag(ParityControlIDs.ACTION_PACK_OPENING_CHOOSE_VARIANT)
                            .clickable(enabled = isAccessible) { onSelect(option.id) },
                        shape = RoundedCornerShape(16.dp),
                        color = if (option.id == state.selectedPackID) {
                            MaterialTheme.colorScheme.primaryContainer
                        } else MaterialTheme.colorScheme.surfaceContainer,
                    ) {
                        Column(Modifier.padding(16.dp)) {
                            Text(option.resolvedVariationLabel, fontWeight = FontWeight.SemiBold)
                            option.oddsReference?.let {
                                Text(
                                    "Odds based on ${NumberFormat.getIntegerInstance().format(it.sampleSize)} packs",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

internal enum class PackSetAvailabilityFilter(val label: String, val controlID: String) {
    ALL("All Sets", ParityControlIDs.OPTION_PACK_OPENING_SET_FILTER_ALL),
    DOWNLOADED("Downloaded", ParityControlIDs.OPTION_PACK_OPENING_SET_FILTER_DOWNLOADED),
    NOT_DOWNLOADED("Not Downloaded", ParityControlIDs.OPTION_PACK_OPENING_SET_FILTER_NOT_DOWNLOADED),
}

internal fun filterPackSets(
    sets: List<PackOpeningPackSet>,
    searchText: String,
    availability: PackSetAvailabilityFilter,
    statuses: Map<String, PackOfflineSetStatus>,
): List<PackOpeningPackSet> {
    val query = searchText.trim()
    return sets.filter { set ->
        val matchesSearch = query.isEmpty() || set.label.contains(query, ignoreCase = true) ||
            set.options.any { it.resolvedVariationLabel.contains(query, ignoreCase = true) }
        val downloaded = statuses[set.id] is PackOfflineSetStatus.Downloaded
        val matchesAvailability = when (availability) {
            PackSetAvailabilityFilter.ALL -> true
            PackSetAvailabilityFilter.DOWNLOADED -> downloaded
            PackSetAvailabilityFilter.NOT_DOWNLOADED -> !downloaded
        }
        matchesSearch && matchesAvailability
    }
}

internal fun canOpenPackSet(
    setID: String,
    remoteAssetsUsable: Boolean,
    statuses: Map<String, PackOfflineSetStatus>,
): Boolean = remoteAssetsUsable || statuses[setID] is PackOfflineSetStatus.Downloaded

@Composable
private fun PackOfflineDownloadControl(
    status: PackOfflineSetStatus,
    remoteAssetsUsable: Boolean,
    onDownload: () -> Unit,
    onRetry: () -> Unit,
    onRemove: () -> Unit,
) {
    when (status) {
        PackOfflineSetStatus.NotDownloaded -> IconButton(
            modifier = Modifier.testTag(ParityControlIDs.ACTION_PACK_OPENING_DOWNLOAD_SET),
            onClick = onDownload,
            enabled = remoteAssetsUsable,
        ) { Icon(Icons.Default.Download, contentDescription = "Download set for offline use") }
        is PackOfflineSetStatus.Downloading -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(progress = { status.progress }, modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
            Text("${(status.progress * 100).toInt()}%", style = MaterialTheme.typography.labelSmall)
        }
        is PackOfflineSetStatus.Downloaded -> Row(verticalAlignment = Alignment.CenterVertically) {
            Text(formatBytes(status.record.byteCount), style = MaterialTheme.typography.labelSmall)
            IconButton(
                modifier = Modifier.testTag(ParityControlIDs.ACTION_PACK_OPENING_REMOVE_DOWNLOAD),
                onClick = onRemove,
            ) { Icon(Icons.Default.Delete, contentDescription = "Remove offline set") }
        }
        is PackOfflineSetStatus.Failed -> Column(horizontalAlignment = Alignment.End) {
            Text(status.message, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error, maxLines = 2)
            TextButton(
                modifier = Modifier.testTag(ParityControlIDs.ACTION_PACK_OPENING_DOWNLOAD_SET),
                onClick = onRetry,
                enabled = remoteAssetsUsable,
            ) { Text("Retry") }
        }
    }
}

private fun formatBytes(bytes: Long): String = when {
    bytes >= 1024L * 1024L -> "%.1f MB".format(bytes / (1024.0 * 1024.0))
    bytes >= 1024L -> "%.0f KB".format(bytes / 1024.0)
    else -> "$bytes B"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PossibleCardsSheet(
    pool: PackOpeningCardPool?,
    onDismiss: () -> Unit,
    imageModel: (String) -> Any,
    onInspect: (PackOpeningPull) -> Unit,
) {
    var selectedTier by remember(pool?.id) { mutableStateOf<String?>(null) }
    var searchText by remember(pool?.id) { mutableStateOf("") }
    val tiers = pool?.cards?.map(PackOpeningPull::tier)?.distinct()?.sortedByDescending {
        when (it.lowercase()) { "chase" -> 5; "ultra" -> 4; "rare" -> 3; "uncommon" -> 2; else -> 1 }
    }.orEmpty()
    val query = searchText.trim()
    val cards = pool?.cards?.filter {
        (selectedTier == null || it.tier == selectedTier) &&
            (query.isEmpty() || it.name.contains(query, ignoreCase = true) ||
                it.rarity.contains(query, ignoreCase = true) || it.collectorNumber.contains(query, ignoreCase = true))
    }
        ?.sortedWith(compareByDescending<PackOpeningPull> { it.tierRank }.thenBy { it.name }).orEmpty()

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.9f)) {
            Text(pool?.label ?: "Possible cards", Modifier.padding(horizontal = 20.dp), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(
                "These cards are eligible in the simulator; a pack does not guarantee a specific card.",
                Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = searchText,
                onValueChange = { searchText = it },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)
                    .testTag(ParityControlIDs.INPUT_PACK_OPENING_CARD_SEARCH),
                label = { Text("Name, rarity, or number") },
                singleLine = true,
            )
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp)
                    .testTag(ParityControlIDs.ACTION_PACK_OPENING_RARITY_FILTER),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilterChip(selected = selectedTier == null, onClick = { selectedTier = null }, label = { Text("All") })
                tiers.forEach { tier ->
                    FilterChip(selected = selectedTier == tier, onClick = { selectedTier = tier }, label = { Text(tier.replaceFirstChar(Char::uppercase)) })
                }
            }
            LazyColumn(
                Modifier.fillMaxWidth(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(cards, key = PackOpeningPull::cardId) { pull ->
                    PackPullRow(pull, imageModel, onInspect)
                }
            }
        }
    }
}

@Composable
private fun PackPullRow(
    pull: PackOpeningPull,
    imageModel: (String) -> Any,
    onInspect: (PackOpeningPull) -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().testTag(ParityControlIDs.ACTION_PACK_OPENING_INSPECT_PULL)
            .clickable { onInspect(pull) },
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
    ) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            AsyncImage(
                model = imageModel(pull.imageUrlSmall),
                contentDescription = pull.name,
                modifier = Modifier.size(width = 54.dp, height = 76.dp),
                contentScale = ContentScale.Fit,
            )
            Column(Modifier.padding(start = 12.dp).weight(1f)) {
                Text(pull.name, fontWeight = FontWeight.SemiBold)
                Text("#${pull.collectorNumber} · ${pull.rarity}", style = MaterialTheme.typography.bodySmall)
            }
            Text(pull.tier.uppercase(), style = MaterialTheme.typography.labelSmall, color = tierColor(pull.tier))
        }
    }
}

@Composable
private fun OddsDialog(
    odds: PackOpeningOddsReference?,
    onDismiss: () -> Unit,
    onOpenSource: (String) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.Info, contentDescription = null) },
        title = { Text("Odds source") },
        text = {
            if (odds == null) Text("No odds reference is available for this pack.") else Column {
                Text(odds.title, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(6.dp))
                Text("Sample: ${NumberFormat.getIntegerInstance().format(odds.sampleSize)} packs")
                Spacer(Modifier.height(6.dp))
                Text(odds.note, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = {
            if (odds != null) TextButton(onClick = { onOpenSource(odds.url) }) { Text("Open Source") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

@Composable
private fun PackOpeningResults(
    session: PackOpeningPullSession,
    contentPadding: PaddingValues,
    imageModel: (String) -> Any,
    onInspect: (PackOpeningPull) -> Unit,
) {
    val rows = session.packs.flatMapIndexed { packIndex, pulls ->
        pulls.map { pull -> packIndex to pull }
    }
    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
            .padding(top = 104.dp).padding(bottom = contentPadding.calculateBottomPadding() + 84.dp)
            .testTag(PackOpeningTestTags.RESULTS),
    ) {
        if (session.recap != null || session.packClasses.any(PackOpeningPackClass::isEvent)) {
            PackOpeningEventRecap(session)
        }
        if (session.packs.size > 1) session.bestPull?.let { best ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Casino, contentDescription = null, tint = Color(0xFFE09500))
                Spacer(Modifier.width(8.dp))
                Text("Best Pull · ${best.name}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
        }
        LazyVerticalGrid(
            columns = GridCells.Adaptive(132.dp),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            itemsIndexed(rows, key = { index, row -> "${row.first}-$index-${row.second.cardId}" }) { _, (pack, pull) ->
                Column(
                    Modifier.testTag(ParityControlIDs.ACTION_PACK_OPENING_INSPECT_PULL)
                        .clickable { onInspect(pull) },
                ) {
                    AsyncImage(
                        model = imageModel(pull.imageUrlSmall),
                        contentDescription = pull.name,
                        modifier = Modifier.fillMaxWidth().aspectRatio(2.5f / 3.5f),
                        contentScale = ContentScale.Fit,
                    )
                    Text(pull.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        buildString {
                            if (session.packs.size > 1) append("Pack ${pack + 1} · ")
                            session.packClasses.getOrNull(pack)?.takeIf(PackOpeningPackClass::isEvent)?.let {
                                append("${it.label} · ")
                            }
                            append(pull.rarity)
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = tierColor(pull.tier),
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

@Composable
private fun PackOpeningEventRecap(session: PackOpeningPullSession) {
    val context = LocalContext.current
    val events = session.packClasses.filter(PackOpeningPackClass::isEvent)
    val rarestEvent = events.maxByOrNull(PackOpeningPackClass::rank)
    val recap = session.recap
    val shareText = remember(session, rarestEvent, recap) {
        buildString {
            if (rarestEvent != null) {
                append("I found a ${rarestEvent.label} opening ${session.packLabel}!")
                session.bestPull?.let { append(" Best pull: ${it.name} (${it.rarity}).") }
                recap?.let { append(" ${it.progress.totalPacks} packs opened in the TCGer minigame.") }
            }
        }
    }

    Card(
        Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 8.dp),
        shape = RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(
            containerColor = when (rarestEvent?.id) {
                "rare-pack" -> Color(0xFFFFF2CC)
                "hit-heavy" -> MaterialTheme.colorScheme.tertiaryContainer
                else -> MaterialTheme.colorScheme.surfaceContainer
            },
        ),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    if (rarestEvent != null) {
                        Text(
                            "RARE PACK EVENT",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF9A5B00),
                        )
                        Text(rarestEvent.label, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                        Text(rarestEvent.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        Text("Opening Progress", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    }
                }
                if (rarestEvent != null) {
                    IconButton(onClick = {
                        val intent = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_SUBJECT, "Rare pack recap")
                            putExtra(Intent.EXTRA_TEXT, shareText)
                        }
                        context.startActivity(Intent.createChooser(intent, "Share rare pack recap"))
                    }) {
                        Icon(Icons.Default.Share, contentDescription = "Share rare pack recap")
                    }
                }
            }
            if (recap != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OpeningProgressStat("Packs", recap.progress.totalPacks.toString(), Modifier.weight(1f))
                    OpeningProgressStat(
                        "Set Found",
                        "${recap.progress.uniqueCards}/${recap.progress.possibleCards}",
                        Modifier.weight(1f),
                    )
                    OpeningProgressStat("New", "+${recap.newCards}", Modifier.weight(1f))
                }
                LinearProgressIndicator(
                    progress = { (recap.progress.completionPercentage / 100.0).toFloat() },
                    modifier = Modifier.fillMaxWidth(),
                )
                recap.unlockedAchievements.forEach { achievement ->
                    Text(
                        "🏆 Achievement · ${achievement.title}",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF9A5B00),
                    )
                }
            }
        }
    }
}

@Composable
private fun OpeningProgressStat(label: String, value: String, modifier: Modifier = Modifier) {
    Surface(modifier, shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surface.copy(alpha = 0.68f)) {
        Column(Modifier.padding(vertical = 8.dp, horizontal = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(label.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private data class PackInspectionState(
    val pulls: List<PackOpeningPull>,
    val index: Int,
)

@Composable
private fun PullInspectionOverlay(
    state: PackInspectionState,
    imageModel: (String) -> Any,
    onIndexChanged: (Int) -> Unit,
    onDismiss: () -> Unit,
    onFavorite: ((PackOpeningPull) -> Unit)?,
    onWishlist: ((PackOpeningPull) -> Unit)?,
    onShare: (PackOpeningPull) -> Unit,
) {
    val pull = state.pulls[state.index.coerceIn(state.pulls.indices)]
    var showingBack by remember(pull.cardId) { mutableStateOf(false) }
    var scale by remember(pull.cardId) { mutableFloatStateOf(1f) }
    var pan by remember(pull.cardId) { mutableStateOf(Offset.Zero) }
    var swipeOffset by remember(pull.cardId) { mutableFloatStateOf(0f) }
    val rotation by animateFloatAsState(
        targetValue = if (showingBack) 180f else 0f,
        animationSpec = tween(340),
        label = "pack-card-flip",
    )
    val transformState = rememberTransformableState { zoomChange, panChange, _ ->
        val nextScale = (scale * zoomChange).coerceIn(1f, 5f)
        scale = nextScale
        pan = if (nextScale <= 1.01f) Offset.Zero else pan + panChange
    }
    val swipeState = rememberDraggableState { delta -> swipeOffset += delta }

    fun move(direction: Int) {
        val nextIndex = adjacentPullIndex(state.index, direction, state.pulls.size)
        if (nextIndex != null) onIndexChanged(nextIndex) else onDismiss()
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Box(Modifier.fillMaxSize().testTag(ParityFeatureIDs.screen(ParityFeatureIDs.PACK_OPENING_RESULTS_INSPECT))) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 14.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, contentDescription = "Close card") }
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(pull.name, fontWeight = FontWeight.Bold, maxLines = 1)
                        Text(
                            "${state.index + 1} of ${state.pulls.size}",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(onClick = { showingBack = !showingBack }) {
                        Icon(Icons.Default.Flip, contentDescription = if (showingBack) "Show card front" else "Show card back")
                    }
                }

                Box(
                    Modifier.fillMaxSize().padding(horizontal = 22.dp, vertical = 92.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .fillMaxHeight(0.78f)
                            .graphicsLayer {
                                scaleX = scale
                                scaleY = scale
                                translationX = pan.x + swipeOffset
                                translationY = pan.y
                                rotationY = rotation
                                cameraDistance = 18f * density
                            }
                            .draggable(
                                state = swipeState,
                                orientation = Orientation.Horizontal,
                                enabled = scale <= 1.01f,
                                onDragStopped = {
                                    when {
                                        swipeOffset < -SWIPE_THRESHOLD -> move(1)
                                        swipeOffset > SWIPE_THRESHOLD -> move(-1)
                                    }
                                    swipeOffset = 0f
                                },
                            )
                            .transformable(transformState),
                        contentAlignment = Alignment.Center,
                    ) {
                        val backVisible = rotation > 90f
                        AsyncImage(
                            model = if (backVisible) {
                                "file:///android_asset/pack/card-backs/pokemon.png"
                            } else imageModel(pull.imageUrl),
                            contentDescription = if (backVisible) "Back of ${pull.name}" else pull.name,
                            modifier = Modifier.fillMaxSize().aspectRatio(2.5f / 3.5f).graphicsLayer {
                                if (backVisible) scaleX = -1f
                            },
                            contentScale = ContentScale.Fit,
                        )
                    }
                }

                Column(
                    Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(horizontal = 18.dp, vertical = 18.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        "${pull.setName} #${pull.collectorNumber} · ${pull.rarity}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        if (scale > 1.01f) "Pinch to zoom out" else "Swipe for another pull · pinch to zoom",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { onFavorite?.invoke(pull) }, enabled = onFavorite != null) {
                            Icon(Icons.Default.Star, contentDescription = null)
                            Spacer(Modifier.width(5.dp))
                            Text("Favorite")
                        }
                        OutlinedButton(onClick = { onWishlist?.invoke(pull) }, enabled = onWishlist != null) {
                            Icon(Icons.Default.BookmarkAdd, contentDescription = null)
                            Spacer(Modifier.width(5.dp))
                            Text("Wishlist")
                        }
                        Button(onClick = { onShare(pull) }) {
                            Icon(Icons.Default.Share, contentDescription = null)
                            Spacer(Modifier.width(5.dp))
                            Text("Share")
                        }
                    }
                }
            }
        }
    }
}

private fun sharePull(context: android.content.Context, pull: PackOpeningPull) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, pull.name)
        putExtra(Intent.EXTRA_TEXT, packShareText(pull))
    }
    context.startActivity(Intent.createChooser(intent, "Share pull"))
}

internal fun adjacentPullIndex(current: Int, direction: Int, count: Int): Int? =
    (current + direction).takeIf { it in 0 until count }

internal fun packShareText(pull: PackOpeningPull): String = buildString {
    append("${pull.name} — ${pull.setName} #${pull.collectorNumber}")
    if (pull.imageUrl.isNotBlank()) append("\n${pull.imageUrl}")
}

@Composable
private fun tierColor(tier: String): Color = when (tier.lowercase()) {
    "chase" -> Color(0xFFC47D00)
    "ultra" -> Color(0xFF8254A3)
    "rare" -> MaterialTheme.colorScheme.primary
    "uncommon" -> Color(0xFF23835A)
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

private const val MAX_ARTWORK_BYTES = 8 * 1024 * 1024
private const val SWIPE_THRESHOLD = 72f
