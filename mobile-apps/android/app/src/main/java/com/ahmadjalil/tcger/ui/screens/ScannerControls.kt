package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.data.scanner.AndroidScannerCapabilities
import com.ahmadjalil.tcger.data.scanner.ScannerCapability
import com.ahmadjalil.tcger.data.scanner.ScannerCapabilityStatus
import com.ahmadjalil.tcger.data.scanner.ScannerCaptureMode
import com.ahmadjalil.tcger.data.scanner.ScannerEncoderVariant
import com.ahmadjalil.tcger.data.scanner.ScannerPerformanceOption
import com.ahmadjalil.tcger.data.scanner.ScannerPriceMode
import com.ahmadjalil.tcger.data.scanner.ScannerPrintingMode
import com.ahmadjalil.tcger.data.scanner.ScannerRecognitionEngine
import com.ahmadjalil.tcger.data.scanner.ScannerReferenceRunSnapshot
import com.ahmadjalil.tcger.data.scanner.ScannerRecordingBundle
import com.ahmadjalil.tcger.data.scanner.ImportedScannerRecording
import com.ahmadjalil.tcger.data.scanner.ScannerReplayReport
import com.ahmadjalil.tcger.data.scanner.ScannerLiveDebugEvent
import com.ahmadjalil.tcger.data.scanner.ScannerLiveGeometry
import com.ahmadjalil.tcger.data.scanner.ScannerSessionOptions
import com.ahmadjalil.tcger.data.scanner.ScannerSessionEntry
import com.ahmadjalil.tcger.data.scanner.AutoScanConsensusUpdate
import com.ahmadjalil.tcger.data.scanner.DeveloperUnlockProgress
import com.ahmadjalil.tcger.data.scanner.ScannerAssetDiagnosticItem
import com.ahmadjalil.tcger.data.scanner.ScannerBoundaryDecisionDiagnostics
import com.ahmadjalil.tcger.data.scanner.ScannerDiagnosticStatus
import com.ahmadjalil.tcger.data.scanner.SavedScannerRecording
import com.ahmadjalil.tcger.data.scanner.ScannerTriggerMode
import com.ahmadjalil.tcger.data.scanner.scannerLanguages
import com.ahmadjalil.tcger.generated.ParityControlIDs

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ScannerOptionsSheet(
    options: ScannerSessionOptions,
    capabilities: AndroidScannerCapabilities,
    game: String,
    isProcessing: Boolean,
    onOptionsChanged: (ScannerSessionOptions) -> Unit,
    onPickPhoto: () -> Unit,
    onPickPhotos: () -> Unit,
    onShowDebug: () -> Unit,
    developerUnlocked: Boolean,
    developerUnlockProgress: DeveloperUnlockProgress?,
    onDeveloperVersionTap: () -> Unit,
    onHideDeveloperTools: () -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        LazyColumn(
            Modifier.padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item { SheetTitle("Scanner Options") }
            item {
                OptionSection("Capture") {
                    ChoiceChips(
                        values = ScannerCaptureMode.entries,
                        selected = options.captureMode,
                        label = ScannerCaptureMode::displayName,
                        capability = capabilities::captureMode,
                        testTag = {
                            if (it == ScannerCaptureMode.CARD) ParityControlIDs.OPTION_SCANNER_CAPTURE_CARD
                            else ParityControlIDs.OPTION_SCANNER_CAPTURE_BINDER_PAGE
                        },
                    ) { onOptionsChanged(options.copy(captureMode = it)) }
                }
            }
            item {
                OptionSection("Single-card scan") {
                    ChoiceChips(
                        values = ScannerTriggerMode.entries,
                        selected = options.triggerMode,
                        label = ScannerTriggerMode::displayName,
                        capability = capabilities::trigger,
                        testTag = {
                            if (it == ScannerTriggerMode.MANUAL) ParityControlIDs.OPTION_SCANNER_TRIGGER_MANUAL
                            else ParityControlIDs.OPTION_SCANNER_TRIGGER_AUTOMATIC
                        },
                    ) { onOptionsChanged(options.copy(triggerMode = it)) }
                }
            }
            item {
                OptionSection("Photo library") {
                    OutlinedButton(onClick = onPickPhoto, enabled = !isProcessing, modifier = Modifier.fillMaxWidth().testTag(ParityControlIDs.ACTION_SCANNER_PICK_PHOTO)) {
                        Text("Load Photo")
                    }
                    OutlinedButton(onClick = onPickPhotos, enabled = !isProcessing, modifier = Modifier.fillMaxWidth().testTag(ParityControlIDs.ACTION_SCANNER_PICK_PHOTOS)) {
                        Text("Load Photos in Bulk")
                    }
                }
            }
            item {
                OptionSection("Results") {
                    SwitchRow(
                        "Open Results Automatically",
                        options.automaticallyShowResults,
                        enabled = !isProcessing,
                        testTag = ParityControlIDs.OPTION_SCANNER_AUTO_OPEN_RESULTS,
                    ) { onOptionsChanged(options.copy(automaticallyShowResults = it)) }
                    ChoiceChips(
                        values = ScannerPriceMode.entries,
                        selected = options.priceMode,
                        label = ScannerPriceMode::displayName,
                        capability = capabilities::price,
                        testTag = { ParityControlIDs.OPTION_SCANNER_PRICE_MODE },
                    ) { onOptionsChanged(options.copy(priceMode = it)) }
                }
            }
            item {
                OptionSection("Printing") {
                    ScannerPrintingMode.entries.forEach { mode ->
                        RadioOption(
                            title = mode.displayName,
                            detail = mode.description,
                            selected = options.printingMode == mode,
                            enabled = !isProcessing,
                            testTag = null,
                        ) { onOptionsChanged(options.copy(printingMode = mode)) }
                    }
                }
            }
            if (options.captureMode == ScannerCaptureMode.BINDER) {
                item {
                    OptionSection("Binder scans") {
                        SwitchRow(
                            "Save Page Photos",
                            options.savesBinderPageImages,
                            enabled = false,
                            detail = "No Android repository or server API currently accepts binder-page photos.",
                            testTag = ParityControlIDs.OPTION_SCANNER_SAVE_BINDER_PAGE_PHOTOS,
                        ) { }
                        SwitchRow(
                            "Replace Photos on Retake",
                            options.replacesBinderPageImages,
                            enabled = false,
                            detail = "Available only when page-photo persistence is supported.",
                            testTag = ParityControlIDs.OPTION_SCANNER_REPLACE_BINDER_PAGE_PHOTOS,
                        ) { onOptionsChanged(options.copy(replacesBinderPageImages = it)) }
                    }
                }
            }
            item {
                OptionSection("Language") {
                    LanguageSelector(options.language) { onOptionsChanged(options.copy(language = it)) }
                    if (options.language !in latinOcrLanguages) {
                        AvailabilityText("On-device Android OCR is Latin-script only; use a server engine for this language.")
                    }
                }
            }
            item {
                OptionSection("Recognition Engine") {
                    ScannerRecognitionEngine.entries.forEach { engine ->
                        val capability = capabilities.engine(engine, game)
                        RadioOption(
                            title = engine.displayName,
                            detail = capability.explanation,
                            selected = options.recognitionEngine == engine,
                            enabled = capability.isAvailable && !isProcessing,
                            testTag = engine.controlId(),
                        ) { onOptionsChanged(options.copy(recognitionEngine = engine)) }
                    }
                }
            }
            item {
                OptionSection("Recognition Model") {
                    ScannerEncoderVariant.entries.forEach { variant ->
                        val capability = capabilities.encoder(variant)
                        RadioOption(
                            title = variant.displayName,
                            detail = capability.explanation,
                            selected = options.encoderVariant == variant,
                            enabled = capability.isAvailable && !isProcessing,
                            testTag = variant.controlId(),
                        ) { onOptionsChanged(options.copy(encoderVariant = variant)) }
                    }
                    AvailabilityText("Model selection only affects on-device embedding. Server embedding chooses its model server-side.")
                }
            }
            item {
                if (developerUnlocked) OptionSection("Debug Capture") {
                    SwitchRow(
                        title = "Save Server Debug Capture",
                        checked = options.saveServerDebugCapture,
                        enabled = capabilities.serverConfigured,
                        detail = if (capabilities.serverConfigured) {
                            "Uploads the scan image and server diagnostics for explicit developer review."
                        } else {
                            "Requires a configured and signed-in server."
                        },
                        testTag = ParityControlIDs.OPTION_SCANNER_SAVE_SERVER_DEBUG_CAPTURE,
                    ) { onOptionsChanged(options.copy(saveServerDebugCapture = it)) }
                    OutlinedTextField(
                        value = options.captureNotes,
                        onValueChange = { onOptionsChanged(options.copy(captureNotes = it)) },
                        enabled = options.saveServerDebugCapture && capabilities.serverConfigured,
                        label = { Text("Capture notes") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    SwitchRow(
                        title = "Testing Tools",
                        checked = options.testingToolsEnabled,
                        testTag = ParityControlIDs.OPTION_SCANNER_DEBUG_TESTING_TOOLS,
                    ) { onOptionsChanged(options.copy(testingToolsEnabled = it)) }
                }
            }
            item {
                if (developerUnlocked) OptionSection("Performance A/B") {
                    ScannerPerformanceOption.entries.forEach { option ->
                        val capability = capabilities.performance(option)
                        SwitchRow(
                            title = option.displayName,
                            checked = options.performance[option] ?: option.defaultEnabled,
                            enabled = capability.isAvailable,
                            detail = capability.explanation,
                            testTag = option.controlId(),
                        ) { enabled ->
                            onOptionsChanged(options.copy(performance = options.performance + (option to enabled)))
                        }
                    }
                }
            }
            item {
                OptionSection("About") {
                    TextButton(
                        onClick = onDeveloperVersionTap,
                        modifier = Modifier.fillMaxWidth().testTag(ParityControlIDs.ACTION_SCANNER_DEBUG_UNLOCK_DEVELOPER_TOOLS),
                    ) {
                        Column(Modifier.fillMaxWidth()) {
                            Text("TCGer Android scanner")
                            Text(
                                when {
                                    developerUnlocked -> "Developer tools unlocked"
                                    developerUnlockProgress != null && developerUnlockProgress.taps >= 4 -> "${developerUnlockProgress.remaining} more taps to unlock developer tools"
                                    else -> "Version 0.1.0"
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    if (developerUnlocked) {
                        Button(onClick = { onDismiss(); onShowDebug() }, modifier = Modifier.fillMaxWidth().testTag(ParityControlIDs.ACTION_SCANNER_DEBUG_OPEN)) {
                            Text("Scanner Debug & Diagnostics")
                        }
                        TextButton(onClick = onHideDeveloperTools, modifier = Modifier.fillMaxWidth()) { Text("Hide Developer Tools") }
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
internal fun ScannerDebugPanel(
    isRecording: Boolean,
    recording: ScannerRecordingBundle,
    importedRecording: ImportedScannerRecording?,
    replayRunning: Boolean,
    replayProcessedFrames: Int,
    replayReport: ScannerReplayReport?,
    referenceSnapshot: ScannerReferenceRunSnapshot?,
    options: ScannerSessionOptions,
    capabilities: AndroidScannerCapabilities,
    game: String,
    availableGames: List<String>,
    onGameChanged: (String) -> Unit,
    replayAvailable: Boolean,
    liveDebugRunning: Boolean,
    liveDebugEvents: List<ScannerLiveDebugEvent>,
    liveDebugFrameCount: Int,
    liveDebugLatestTimingMs: Double?,
    liveGeometry: ScannerLiveGeometry,
    latestDecisionDiagnostics: ScannerBoundaryDecisionDiagnostics?,
    assetDiagnostics: List<ScannerAssetDiagnosticItem>,
    diagnosticsRunning: Boolean,
    onRefreshDiagnostics: () -> Unit,
    savedRecordings: List<SavedScannerRecording>,
    onSaveSession: () -> Unit,
    onLoadSaved: (String) -> Unit,
    onExportSaved: (String) -> Unit,
    onShareSaved: (String) -> Unit,
    onDeleteSaved: (String) -> Unit,
    onExportAllSessions: () -> Unit,
    onOptionsChanged: (ScannerSessionOptions) -> Unit,
    onToggleRecording: () -> Unit,
    onClear: () -> Unit,
    onExportRecording: () -> Unit,
    onShareRecording: () -> Unit,
    onImportRecording: () -> Unit,
    onReplayImported: () -> Unit,
    onRunReferenceSet: () -> Unit,
    onCancelReferenceSet: () -> Unit,
    onToggleLiveDebug: () -> Unit,
    onClearLiveDebug: () -> Unit,
    onExportOptions: () -> Unit,
    onImportOptions: () -> Unit,
    onClose: () -> Unit,
) {
    LazyColumn(
        Modifier.padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Scanner Debug", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text("Deterministic Android capability and replay boundary", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton(onClick = onClose) { Text("Close") }
            }
        }
        item {
            OptionSection("Live Pipeline") {
                DiagnosticRow("Observer", if (liveDebugRunning) "Running" else "Stopped")
                DiagnosticRow("Observed captures", liveDebugFrameCount.toString())
                DiagnosticRow("Latest recognition", liveDebugLatestTimingMs?.let { "${it.toInt()} ms" } ?: "No result yet")
                DiagnosticRow("Guide / canonical crop", liveGeometry.label)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = onToggleLiveDebug,
                        modifier = Modifier.weight(1f).testTag(ParityControlIDs.ACTION_SCANNER_DEBUG_START),
                    ) { Text(if (liveDebugRunning) "Stop Observer" else "Start Observer") }
                    OutlinedButton(
                        onClick = onClearLiveDebug,
                        enabled = liveDebugEvents.isNotEmpty() || liveDebugFrameCount > 0,
                        modifier = Modifier.testTag(ParityControlIDs.ACTION_SCANNER_DEBUG_CLEAR_LOG),
                    ) { Text("Clear") }
                }
                if (liveDebugEvents.isEmpty()) {
                    AvailabilityText("Start the observer, then scan normally. It does not change the selected capture trigger or recognition engine.")
                } else {
                    liveDebugEvents.takeLast(12).asReversed().forEach { event ->
                        Text(
                            "#${event.sequence} ${event.message}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text("Showing the newest ${minOf(12, liveDebugEvents.size)} of ${liveDebugEvents.size} bounded events.", style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        latestDecisionDiagnostics?.let { diagnostics ->
            item {
                OptionSection("Latest Decision Evidence") {
                    DiagnosticRow("Decision", diagnostics.decision.name.replace('_', ' '))
                    DiagnosticRow("Requested engine", diagnostics.requestedEngine.displayName)
                    diagnostics.reportedEngine?.let { DiagnosticRow("Reported engine", it) }
                    diagnostics.elapsedMs?.let { DiagnosticRow("Total timing", "${it.toInt()} ms") }
                    diagnostics.topConfidence?.let { DiagnosticRow("Top score", "%.4f".format(it)) }
                    diagnostics.observedConfidenceMargin?.let { DiagnosticRow("Observed margin", "%.4f".format(it)) }
                    if (diagnostics.recognizedQueries.isNotEmpty()) {
                        DiagnosticRow("OCR queries", diagnostics.recognizedQueries.joinToString(" · "))
                    }
                    diagnostics.serverDebugCaptureId?.let { DiagnosticRow("Server capture", it) }
                    Text(
                        diagnostics.explanation,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        item {
            OptionSection("Recording & Replay") {
                DiagnosticRow("Recorder", if (isRecording) "Recording" else if (recording.frames.isEmpty()) "Idle" else "Paused")
                DiagnosticRow("Retained frames", "${recording.frames.size} / 400")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = onToggleRecording, modifier = Modifier.weight(1f).testTag(ParityControlIDs.ACTION_SCANNER_DEBUG_RECORD)) {
                        Text(if (isRecording) "Pause" else "Record")
                    }
                    OutlinedButton(onClick = onClear, enabled = recording.frames.isNotEmpty(), modifier = Modifier.testTag(ParityControlIDs.ACTION_SCANNER_DEBUG_CLEAR_RECORDING)) { Text("Clear") }
                }
                OutlinedButton(
                    onClick = onExportRecording,
                    enabled = recording.frames.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth().testTag(ParityControlIDs.ACTION_SCANNER_DEBUG_SAVE_RECORDING),
                ) { Text("Export Recording JSON") }
                OutlinedButton(
                    onClick = onShareRecording,
                    enabled = recording.frames.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth().testTag(ParityControlIDs.ACTION_SCANNER_DEBUG_SHARE_RECORDING),
                ) { Text("Share Recording") }
                OutlinedButton(
                    onClick = onSaveSession,
                    enabled = recording.frames.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Save as Recorded Session") }
                OutlinedButton(onClick = onImportRecording, modifier = Modifier.fillMaxWidth()) {
                    Text("Import Recording JSON")
                }
                importedRecording?.let {
                    DiagnosticRow("Imported", "${it.recording.frames.size} frames · ${it.recording.summary.pipeline}")
                    DiagnosticRow("Replayable JPEGs", "${it.replayableFrameCount} / ${it.recording.frames.size}")
                    Button(
                        onClick = onReplayImported,
                        enabled = replayAvailable && !replayRunning,
                        modifier = Modifier.fillMaxWidth().testTag(ParityControlIDs.ACTION_SCANNER_DEBUG_REPLAY),
                    ) { Text(if (replayRunning) "Replaying $replayProcessedFrames / ${it.replayableFrameCount}…" else "Replay Through Production Scanner") }
                    if (!replayAvailable) AvailabilityText("Inspection is available, but replay requires retained original attempt JPEGs and the production Android scan callback.")
                    replayReport?.let { report ->
                        DiagnosticRow("Processed", "${report.processedFrames} / ${report.totalFrames}")
                        DiagnosticRow("Stable top match", "${report.stableFrames} (${report.percent(report.stableFrames)})")
                        DiagnosticRow("Expected-label accuracy", "${report.topOneCorrectFrames} (${report.percent(report.topOneCorrectFrames)})")
                        DiagnosticRow("False positives / misses", "${report.falsePositiveRegressions} / ${report.missRegressions}")
                        DiagnosticRow("Mean / p95 latency", "${report.meanLatencyMs.toInt()} / ${report.p95LatencyMs.toInt()} ms")
                    }
                }
            }
        }
        item {
            OptionSection(
                "Reference Sets",
                Modifier.testTag(ParityControlIDs.ACTION_SCANNER_DEBUG_REFERENCE_SETS),
            ) {
                val replayableCount = importedRecording?.replayableFrameCount ?: 0
                if (importedRecording == null) {
                    AvailabilityText("Import a labeled scanner recording, or inspect a saved session, to browse and run it as a reference set.")
                } else {
                    DiagnosticRow("Selected set", "${importedRecording.recording.frames.size} items")
                    DiagnosticRow("Runnable inputs", replayableCount.toString())
                    Button(
                        onClick = onRunReferenceSet,
                        enabled = replayableCount > 0 && referenceSnapshot?.isRunning != true,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Run Reference Set") }
                }

                referenceSnapshot?.let { snapshot ->
                    DiagnosticRow("Progress", "${snapshot.completedCount} / ${snapshot.totalCount}")
                    if (snapshot.isRunning) {
                        OutlinedButton(onClick = onCancelReferenceSet, modifier = Modifier.fillMaxWidth()) {
                            Text("Cancel Reference Run")
                        }
                    }
                    snapshot.report?.let { report ->
                        DiagnosticRow("Positive accuracy", "${(report.positiveAccuracy * 100).toInt()}%")
                        DiagnosticRow("Negative decline rate", "${(report.negativeDeclineRate * 100).toInt()}%")
                        DiagnosticRow("Wrong printing / card", "${report.wrongPrintingItems} / ${report.wrongCardItems}")
                        DiagnosticRow("False positives / misses", "${report.falsePositiveItems} / ${report.missedItems}")
                        DiagnosticRow("Mean / p95 latency", "${report.meanLatencyMs.toInt()} / ${report.p95LatencyMs.toInt()} ms")
                    }
                    snapshot.outcomes.takeLast(12).asReversed().forEach { outcome ->
                        Column(Modifier.fillMaxWidth()) {
                            Row(Modifier.fillMaxWidth()) {
                                Text(outcome.item.name, modifier = Modifier.weight(1f), fontWeight = FontWeight.Medium)
                                Text(
                                    outcome.verdict.name.replace('_', ' '),
                                    color = if (outcome.verdict.isFailure) MaterialTheme.colorScheme.error else Color(0xFF2E7D32),
                                    style = MaterialTheme.typography.labelSmall,
                                )
                            }
                            Text(
                                outcome.diagnostics.explanation,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        HorizontalDivider()
                    }
                }
            }
        }
        item {
            OptionSection("Recorded Sessions") {
                if (savedRecordings.isEmpty()) {
                    AvailabilityText("No persisted Android scanner sessions.")
                } else {
                    savedRecordings.forEach { saved ->
                        Column(Modifier.fillMaxWidth()) {
                            Text("${saved.mode} · ${saved.frameCount} frames", fontWeight = FontWeight.Medium)
                            Text("${saved.pipeline} · ${saved.sizeBytes / 1024} KB", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                TextButton(onClick = { onLoadSaved(saved.id) }) { Text("Inspect") }
                                TextButton(onClick = { onExportSaved(saved.id) }) { Text("Export") }
                                TextButton(onClick = { onShareSaved(saved.id) }) { Text("Share") }
                                TextButton(onClick = { onDeleteSaved(saved.id) }) { Text("Delete") }
                            }
                        }
                        HorizontalDivider()
                    }
                    OutlinedButton(
                        onClick = onExportAllSessions,
                        modifier = Modifier.fillMaxWidth().testTag(ParityControlIDs.ACTION_SCANNER_DEBUG_EXPORT_SESSIONS),
                    ) { Text("Export All Session Metadata") }
                }
            }
        }
        item {
            OptionSection("Live Configuration") {
                ChoiceChips(
                    values = availableGames,
                    selected = game,
                    label = { it.displayScannerGame() },
                    capability = { ScannerCapability(ScannerCapabilityStatus.AVAILABLE, "Changes the next capture and recording mode.") },
                ) { onGameChanged(it) }
                ScannerRecognitionEngine.entries.forEach { engine ->
                    val capability = capabilities.engine(engine, game)
                    RadioOption(
                        title = engine.displayName,
                        detail = capability.explanation,
                        selected = options.recognitionEngine == engine,
                        enabled = capability.isAvailable,
                    ) { onOptionsChanged(options.copy(recognitionEngine = engine)) }
                }
                DiagnosticRow("Capture", options.captureMode.displayName)
                DiagnosticRow("Trigger", options.triggerMode.displayName)
                DiagnosticRow("Language", options.language)
                DiagnosticRow("Engine", options.recognitionEngine.displayName)
                DiagnosticRow("Model label", options.encoderVariant.displayName)
                DiagnosticRow("Price mode", options.priceMode.displayName)
                SwitchRow(
                    "Developer-mode Recording",
                    options.devModeRecordingEnabled,
                    detail = "Persists recorder intent across scanner sessions.",
                    testTag = ParityControlIDs.OPTION_SCANNER_DEBUG_DEV_MODE_RECORDING,
                ) { onOptionsChanged(options.copy(devModeRecordingEnabled = it)) }
                OutlinedTextField(
                    value = options.analysisIntervalMillis.toString(),
                    onValueChange = { raw ->
                        raw.toLongOrNull()?.let { onOptionsChanged(options.copy(analysisIntervalMillis = it.coerceIn(500, 10_000))) }
                    },
                    label = { Text("Automatic analysis interval (ms)") },
                    supportingText = { Text("Server engines enforce a 2–2.5 second minimum.") },
                    modifier = Modifier.fillMaxWidth().testTag(ParityControlIDs.INPUT_SCANNER_DEBUG_ANALYSIS_INTERVAL),
                )
                SwitchRow(
                    "Record Attempt Images",
                    options.recordAttemptImages,
                    detail = "Retains the exact input JPEG and deterministic card-guide crop in private app storage; recording exports embed both.",
                    testTag = ParityControlIDs.OPTION_SCANNER_DEBUG_ATTEMPT_IMAGES,
                ) { onOptionsChanged(options.copy(recordAttemptImages = it)) }
                SwitchRow(
                    "Crop Rescue",
                    options.cropRescueEnabled,
                    detail = "Retains the source image and enables four-corner perspective correction and production retry.",
                    testTag = ParityControlIDs.OPTION_SCANNER_DEBUG_CROP_RESCUE,
                ) { onOptionsChanged(options.copy(cropRescueEnabled = it)) }
                OutlinedButton(onClick = onExportOptions, modifier = Modifier.fillMaxWidth()) { Text("Export Options JSON") }
                OutlinedButton(onClick = onImportOptions, modifier = Modifier.fillMaxWidth()) { Text("Import Options JSON") }
            }
        }
        item {
            OptionSection("Asset Diagnostics", Modifier.testTag(ParityControlIDs.ACTION_SCANNER_DEBUG_ASSET_DIAGNOSTICS)) {
                OutlinedButton(onClick = onRefreshDiagnostics, enabled = !diagnosticsRunning, modifier = Modifier.fillMaxWidth()) {
                    Text(if (diagnosticsRunning) "Running checks…" else "Run Asset Checks")
                }
                assetDiagnostics.forEach { diagnostic ->
                    val color = when (diagnostic.status) {
                        ScannerDiagnosticStatus.PASS -> Color(0xFF2E7D32)
                        ScannerDiagnosticStatus.FAIL -> MaterialTheme.colorScheme.error
                        ScannerDiagnosticStatus.INFO -> MaterialTheme.colorScheme.onSurfaceVariant
                    }
                    Column(Modifier.fillMaxWidth()) {
                        Row(Modifier.fillMaxWidth()) {
                            Text(diagnostic.name, modifier = Modifier.weight(1f), fontWeight = FontWeight.Medium)
                            Text(diagnostic.status.name, color = color, style = MaterialTheme.typography.labelSmall)
                        }
                        Text(diagnostic.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    HorizontalDivider()
                }
            }
        }
        item {
            OptionSection("Capability Diagnostics") {
                diagnosticItems(capabilities, game).forEach { diagnostic ->
                    val color = when (diagnostic.status) {
                        ScannerCapabilityStatus.AVAILABLE -> Color(0xFF2E7D32)
                        ScannerCapabilityStatus.UNAVAILABLE -> MaterialTheme.colorScheme.error
                        ScannerCapabilityStatus.NOT_APPLICABLE -> MaterialTheme.colorScheme.onSurfaceVariant
                    }
                    Column(Modifier.fillMaxWidth()) {
                        Row(Modifier.fillMaxWidth()) {
                            Text(diagnostic.name, modifier = Modifier.weight(1f), fontWeight = FontWeight.Medium)
                            Text(diagnostic.status.name.replace('_', ' '), color = color, style = MaterialTheme.typography.labelSmall)
                        }
                        Text(diagnostic.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    HorizontalDivider()
                }
            }
        }
        item { Spacer(Modifier.height(20.dp)) }
    }
}

@Composable
internal fun ScannerSessionTray(
    entries: List<ScannerSessionEntry>,
    consensus: AutoScanConsensusUpdate?,
    onReview: () -> Unit,
    onClear: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        consensus?.takeIf { it.candidateName != null && !it.confirmed }?.let {
            Text(
                if (it.locked) "Move ${it.candidateName} out of frame to scan it again"
                else "Hold steady: ${it.candidateName} ${it.count}/${it.required}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Button(
                onClick = onReview,
                enabled = entries.isNotEmpty(),
                modifier = Modifier.weight(1f).testTag(ParityControlIDs.ACTION_SCANNER_REVIEW_SESSION),
            ) { Text("Review scan session (${entries.size})") }
            TextButton(
                onClick = onClear,
                enabled = entries.isNotEmpty(),
                modifier = Modifier.testTag(ParityControlIDs.ACTION_SCANNER_CLEAR_SESSION),
            ) { Text("Clear") }
        }
        sessionPriceTotal(entries)?.let {
            Text("Session total: $it", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
internal fun ScannerSessionReviewPanel(
    entries: List<ScannerSessionEntry>,
    onToggle: (String) -> Unit,
    onRemove: (String) -> Unit,
    onClear: () -> Unit,
    onAddSelected: () -> Unit,
    onClose: () -> Unit,
) {
    val selectedCount = entries.count(ScannerSessionEntry::selected)
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Scan Session", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("$selectedCount of ${entries.size} selected", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            TextButton(onClick = onClose) { Text("Close") }
        }
        Spacer(Modifier.height(8.dp))
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(entries, key = ScannerSessionEntry::id) { entry ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = entry.selected, onCheckedChange = { onToggle(entry.id) })
                    Column(Modifier.weight(1f)) {
                        Text(entry.name, fontWeight = FontWeight.Medium)
                        Text(
                            listOfNotNull(entry.setName, entry.collectorNumber).joinToString(" · ").ifBlank { entry.game },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    entry.confidence?.let { Text("${(it * 100).toInt()}%", style = MaterialTheme.typography.labelSmall) }
                    entry.formattedPrice()?.let { Text(it, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 6.dp)) }
                    IconButton(onClick = { onRemove(entry.id) }) {
                        Icon(Icons.Default.Delete, contentDescription = "Remove ${entry.name}")
                    }
                }
                HorizontalDivider()
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onClear, enabled = entries.isNotEmpty()) { Text("Clear all") }
            Button(
                onClick = onAddSelected,
                enabled = selectedCount > 0,
                modifier = Modifier.weight(1f).testTag(ParityControlIDs.ACTION_SCANNER_ADD),
            ) { Text("Add selected to binder") }
        }
    }
}

private data class ScannerDiagnostic(val name: String, val status: ScannerCapabilityStatus, val detail: String)

private fun diagnosticItems(capabilities: AndroidScannerCapabilities, game: String): List<ScannerDiagnostic> = buildList {
    ScannerRecognitionEngine.entries.forEach { engine ->
        capabilities.engine(engine, game).let { add(ScannerDiagnostic(engine.displayName, it.status, it.explanation)) }
    }
    ScannerEncoderVariant.entries.forEach { variant ->
        capabilities.encoder(variant).let { add(ScannerDiagnostic(variant.displayName, it.status, it.explanation)) }
    }
    ScannerCaptureMode.entries.forEach { mode ->
        capabilities.captureMode(mode).let { add(ScannerDiagnostic("${mode.displayName} capture", it.status, it.explanation)) }
    }
    ScannerTriggerMode.entries.forEach { mode ->
        capabilities.trigger(mode).let { add(ScannerDiagnostic(mode.displayName, it.status, it.explanation)) }
    }
    capabilities.price(ScannerPriceMode.SESSION_MARKET).let { add(ScannerDiagnostic("Price Mode", it.status, it.explanation)) }
}

@Composable
private fun SheetTitle(title: String) {
    Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
}

@Composable
private fun OptionSection(title: String, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        content()
        HorizontalDivider(Modifier.padding(top = 4.dp))
    }
}

@Composable
private fun <T> ChoiceChips(
    values: List<T>,
    selected: T,
    label: (T) -> String,
    capability: (T) -> ScannerCapability,
    testTag: (T) -> String? = { null },
    onSelect: (T) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            values.forEach { value ->
                val available = capability(value)
                FilterChip(
                    modifier = testTag(value)?.let { Modifier.testTag(it) } ?: Modifier,
                    selected = selected == value,
                    onClick = { onSelect(value) },
                    enabled = available.isAvailable,
                    label = { Text(label(value)) },
                )
            }
        }
        val selectedCapability = capability(selected)
        Text(selectedCapability.explanation, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun RadioOption(title: String, detail: String, selected: Boolean, enabled: Boolean, testTag: String? = null, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().then(testTag?.let { Modifier.testTag(it) } ?: Modifier), verticalAlignment = Alignment.Top) {
        RadioButton(selected = selected, onClick = onClick, enabled = enabled)
        Column(Modifier.padding(top = 10.dp)) {
            Text(title, color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SwitchRow(
    title: String,
    checked: Boolean,
    enabled: Boolean = true,
    detail: String? = null,
    testTag: String? = null,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(Modifier.fillMaxWidth().then(testTag?.let { Modifier.testTag(it) } ?: Modifier), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title)
            detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange, enabled = enabled)
    }
}

@Composable
private fun LanguageSelector(language: String, onLanguage: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        OutlinedButton(onClick = { expanded = !expanded }, modifier = Modifier.fillMaxWidth().testTag(ParityControlIDs.INPUT_SCANNER_LANGUAGE)) { Text(language) }
        if (expanded) {
            scannerLanguages.forEach { option ->
                TextButton(
                    onClick = { onLanguage(option); expanded = false },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(option, modifier = Modifier.fillMaxWidth()) }
            }
        }
    }
}

@Composable
private fun AvailabilityText(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun DiagnosticRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontWeight = FontWeight.Medium)
    }
}

private val latinOcrLanguages = setOf("English", "German", "French", "Italian", "Spanish", "Portuguese")

private fun ScannerSessionEntry.formattedPrice(): String? {
    val value = price ?: return null
    return "${currency ?: "USD"} ${"%.2f".format(value)}"
}

private fun sessionPriceTotal(entries: List<ScannerSessionEntry>): String? {
    val priced = entries.filter { it.price != null }
    if (priced.isEmpty()) return null
    return priced.groupBy { it.currency ?: "USD" }
        .entries
        .sortedBy(Map.Entry<String, List<ScannerSessionEntry>>::key)
        .joinToString(" + ") { (currency, rows) -> "$currency ${"%.2f".format(rows.sumOf { it.price ?: 0.0 })}" }
}

private fun ScannerReplayReport.percent(value: Int): String =
    if (processedFrames == 0) "0%" else "${(value * 100.0 / processedFrames).toInt()}%"

private fun String.displayScannerGame(): String = when (this) {
    "pokemon" -> "Pokémon"
    "magic" -> "Magic"
    "yugioh" -> "Yu-Gi-Oh!"
    else -> replaceFirstChar(Char::uppercase)
}

private fun ScannerRecognitionEngine.controlId(): String = when (this) {
    ScannerRecognitionEngine.AUTOMATIC -> ParityControlIDs.OPTION_SCANNER_ENGINE_AUTOMATIC
    ScannerRecognitionEngine.ON_DEVICE_OCR -> ParityControlIDs.OPTION_SCANNER_ENGINE_LOCAL_ONLY
    ScannerRecognitionEngine.SERVER_PHASH -> ParityControlIDs.OPTION_SCANNER_ENGINE_SERVER_HASH
    ScannerRecognitionEngine.SERVER_EMBEDDING -> ParityControlIDs.OPTION_SCANNER_ENGINE_SERVER_EMBEDDING
}

private fun ScannerEncoderVariant.controlId(): String = when (this) {
    ScannerEncoderVariant.ARCFACE -> ParityControlIDs.OPTION_SCANNER_MODEL_ARCFACE
    ScannerEncoderVariant.DINOV2 -> ParityControlIDs.OPTION_SCANNER_MODEL_DINOV2
}

private fun ScannerPerformanceOption.controlId(): String = when (this) {
    ScannerPerformanceOption.VECTORIZED_ANN -> ParityControlIDs.OPTION_SCANNER_DEBUG_FAST_INDEX_SEARCH
    ScannerPerformanceOption.STAGED_HYPOTHESES -> ParityControlIDs.OPTION_SCANNER_DEBUG_STAGED_CROP_RETRIES
    ScannerPerformanceOption.ALLOWED_INDEX_CACHE -> ParityControlIDs.OPTION_SCANNER_DEBUG_CACHE_SEARCH_SCOPE
    ScannerPerformanceOption.CONCURRENT_ORIENTATIONS -> ParityControlIDs.OPTION_SCANNER_DEBUG_PARALLEL_ORIENTATION
    ScannerPerformanceOption.BATCHED_ORIENTATION -> ParityControlIDs.OPTION_SCANNER_DEBUG_BATCHED_ORIENTATION
    ScannerPerformanceOption.WARM_START -> ParityControlIDs.OPTION_SCANNER_DEBUG_PRELOAD_MODELS
    ScannerPerformanceOption.FAST_CAPTURE -> ParityControlIDs.OPTION_SCANNER_DEBUG_FAST_CAPTURE
    ScannerPerformanceOption.FAST_FOOTER_OCR -> ParityControlIDs.OPTION_SCANNER_DEBUG_FAST_FOOTER_OCR
    ScannerPerformanceOption.LEAN_OCR_STRIPS -> ParityControlIDs.OPTION_SCANNER_DEBUG_LEAN_OCR_STRIPS
    ScannerPerformanceOption.FOOTER_FIRST_OCR -> ParityControlIDs.OPTION_SCANNER_DEBUG_FOOTER_FIRST_OCR
}
