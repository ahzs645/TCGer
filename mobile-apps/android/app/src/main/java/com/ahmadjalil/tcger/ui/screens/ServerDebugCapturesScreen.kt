package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.ahmadjalil.tcger.domain.ScanDebugCapture
import com.ahmadjalil.tcger.domain.ScanDebugFeedbackStatus
import com.ahmadjalil.tcger.domain.ScanDebugReviewTag
import com.ahmadjalil.tcger.generated.ParityFeatureIDs
import com.ahmadjalil.tcger.ui.AppUiState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServerDebugCapturesScreen(
    state: AppUiState,
    contentPadding: PaddingValues,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onUpdate: (String, ScanDebugFeedbackStatus?, Set<ScanDebugReviewTag>?, String?) -> Unit,
) {
    LaunchedEffect(Unit) { onRefresh() }
    Column(
        Modifier.fillMaxSize().testTag(ParityFeatureIDs.screen(ParityFeatureIDs.SCANNER_DEBUG_CAPTURE_BROWSER)),
    ) {
        TopAppBar(
            title = { Text("Server Scan Captures") },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
            },
            actions = {
                IconButton(onClick = onRefresh, enabled = !state.isLoadingScanDebugCaptures) {
                    Icon(Icons.Default.Refresh, contentDescription = "Refresh captures")
                }
            },
        )
        when {
            state.isLoadingScanDebugCaptures && state.scanDebugCaptures.isEmpty() -> {
                Column(
                    Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    CircularProgressIndicator()
                    Text("Loading recent captures…", Modifier.padding(top = 12.dp))
                }
            }
            state.scanDebugCaptures.isEmpty() -> EmptyPane(
                "No server captures",
                "Enable Save Server Debug Capture in scanner options, then run a server scan.",
            )
            else -> LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(
                    start = 16.dp,
                    end = 16.dp,
                    top = 12.dp,
                    bottom = contentPadding.calculateBottomPadding() + 24.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(state.scanDebugCaptures, key = ScanDebugCapture::id) { capture ->
                    DebugCaptureCard(capture, onUpdate)
                }
            }
        }
    }
}

@Composable
private fun DebugCaptureCard(
    capture: ScanDebugCapture,
    onUpdate: (String, ScanDebugFeedbackStatus?, Set<ScanDebugReviewTag>?, String?) -> Unit,
) {
    var notes by remember(capture.id, capture.notes) { mutableStateOf(capture.notes.orEmpty()) }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                AsyncImage(
                    model = capture.sourceImageUrl,
                    contentDescription = "Scanner source capture",
                    modifier = Modifier.height(150.dp).weight(0.42f),
                )
                Column(Modifier.weight(0.58f)) {
                    Text(capture.bestMatchName ?: "No accepted match", fontWeight = FontWeight.Bold)
                    capture.bestMatchConfidence?.let { Text("${(it * 100).toInt()}% confidence") }
                    Text(
                        listOfNotNull(capture.requestedTcg, capture.captureSource, capture.createdAt).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Text("Feedback", fontWeight = FontWeight.SemiBold)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(ScanDebugFeedbackStatus.entries) { status ->
                    FilterChip(
                        selected = capture.feedbackStatus == status,
                        onClick = { onUpdate(capture.id, status, null, null) },
                        label = { Text(status.displayName) },
                    )
                }
            }
            Text("Failure tags", fontWeight = FontWeight.SemiBold)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(ScanDebugReviewTag.entries) { tag ->
                    FilterChip(
                        selected = tag in capture.reviewTags,
                        onClick = {
                            val next = capture.reviewTags.toMutableSet().apply {
                                if (!add(tag)) remove(tag)
                            }
                            onUpdate(capture.id, null, next, null)
                        },
                        label = { Text(tag.displayName) },
                    )
                }
            }
            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it },
                label = { Text("Review notes") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
            )
            TextButton(
                onClick = { onUpdate(capture.id, null, null, notes) },
                enabled = notes.trim() != capture.notes.orEmpty().trim(),
                modifier = Modifier.align(Alignment.End),
            ) { Text("Save Notes") }
        }
    }
}
