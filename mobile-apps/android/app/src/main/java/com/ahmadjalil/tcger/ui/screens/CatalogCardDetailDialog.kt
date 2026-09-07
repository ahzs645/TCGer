package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.data.gamepackage.gamePresentation
import coil.compose.AsyncImage
import com.ahmadjalil.tcger.domain.CatalogCard
import com.ahmadjalil.tcger.domain.identity
import com.ahmadjalil.tcger.ui.AppUiState
import com.ahmadjalil.tcger.ui.AppViewModel

@Composable
fun CatalogCardDetailDialog(initial: CatalogCard, state: AppUiState, viewModel: AppViewModel) {
    var selected by remember(initial.identity()) { mutableStateOf(initial) }
    var prints by remember(initial.identity()) { mutableStateOf(listOf(initial)) }
    var zooming by rememberSaveable { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(initial.identity()) {
        runCatching { viewModel.cardPrints(initial) }.onSuccess { prints = it }.onFailure { error = it.message }
    }
    AlertDialog(onDismissRequest = viewModel::closeCatalogCard, title = { Text(selected.name) },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            CardArtwork(selected, Modifier.fillMaxWidth().aspectRatio(0.716f).clickable { zooming = true })
            TextButton(onClick = { zooming = true }) { Text("Inspect artwork") }
            Text("${selected.tcg.displayGame()} · ${selected.setName.orEmpty()} · ${selected.collectorNumber.orEmpty()}")
            selected.rarity?.let { rarity ->
                val symbol = selected.gamePresentation()?.symbols?.find { it.kind == "rarity" && it.id == rarity }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    symbol?.let { AsyncImage(it.imageUrl, null, Modifier.size(20.dp)) }
                    Text(symbol?.label ?: rarity)
                }
            }
            selected.gamePresentation()?.packageId?.let { packageId ->
                viewModel.gamePriceSnapshot(packageId)?.quote(selected.id.substringAfter("::"), state.preferences.currency, printingKey = selected.exactPrintingId)?.let { quote ->
                    Text("${quote.amount} ${quote.currency} · ${quote.source} · ${quote.observedAt.take(10)}")
                }
            }
            val tokens = selected.attributes.filterKeys { it != "tcger" }.values.flatten().toSet()
            selected.gamePresentation()?.symbols?.filter { it.kind != "rarity" && it.id in tokens }?.forEach { symbol ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { AsyncImage(symbol.imageUrl, null, Modifier.size(20.dp)); Text(symbol.label) }
            }
            selected.artist?.let { Text("Artist: $it") }
            selected.attributes.filterKeys { it != "tcger" }.forEach { (key, values) -> Text("${key.replace('_', ' ').replaceFirstChar { it.uppercase() }}: ${values.joinToString()}") }
            Text("Printings", style = MaterialTheme.typography.titleMedium)
            error?.let { Text("Could not load other printings: $it", color = MaterialTheme.colorScheme.error) }
            prints.forEach { print ->
                TextButton(onClick = { selected = print }) { Text("${if (print.identity() == selected.identity()) "✓ " else ""}${print.setName.orEmpty()} · ${print.collectorNumber ?: print.id}") }
            }
        } },
        confirmButton = { TextButton(onClick = { adding = true }) { Text("Add to collection or wishlist") } },
        dismissButton = { TextButton(onClick = viewModel::closeCatalogCard) { Text("Close") } })
    if (zooming) Dialog(onDismissRequest = { zooming = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        var scale by rememberSaveable { mutableStateOf(1f) }
        var x by remember { mutableStateOf(0f) }
        var y by remember { mutableStateOf(0f) }
        val transform = rememberTransformableState { zoom, pan, _ -> scale = (scale * zoom).coerceIn(1f, 5f); x += pan.x; y += pan.y }
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.safeDrawingPadding()) {
                Row {
                    TextButton(onClick = { zooming = false }) { Text("Close") }
                    TextButton(onClick = { scale = (scale + 0.5f).coerceAtMost(5f) }) { Text("Zoom in") }
                    TextButton(onClick = { scale = 1f; x = 0f; y = 0f }) { Text("Reset") }
                }
                Box(Modifier.weight(1f).transformable(transform)) {
                    CardArtwork(selected, Modifier.fillMaxSize().graphicsLayer { scaleX = scale; scaleY = scale; translationX = x; translationY = y })
                }
            }
        }
    }
    if (adding) AddCardDialog(selected, state, { adding = false },
        { binder -> viewModel.addCard(binder, selected); adding = false },
        { wishlist -> viewModel.addWishlistCard(wishlist, selected); adding = false })
}
