package com.ahmadjalil.tcger.features.social

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

private val supportedDeckGames = listOf("pokemon", "yugioh", "magic", "onepiece", "lorcana", "dragonball")
private val deckZones = listOf("main", "extra", "side")

@Composable
fun DecksScreen(
    controller: SocialFeatureController,
    contentPadding: PaddingValues,
    onOpenDeck: (String) -> Unit,
) {
    val state by controller.state.collectAsStateWithLifecycle()
    var query by remember { mutableStateOf("") }
    var showCreate by remember { mutableStateOf(false) }
    var showImport by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<Deck?>(null) }
    LaunchedEffect(controller) { if (state.connected) controller.loadDecks() }

    if (!state.connected) {
        SocialUnavailable(
            title = "Connect a Server for Decks",
            body = "Decks sync through a TCGer server and aren't stored in on-device mode yet.",
            contentPadding = contentPadding,
        )
        return
    }

    val filtered = state.decks.filter { deck ->
        query.isBlank() || listOfNotNull(deck.name, deck.tcg, deck.format).any { it.contains(query.trim(), true) }
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = contentPadding.calculateTopPadding() + 18.dp,
            bottom = contentPadding.calculateBottomPadding() + 28.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SocialTitle("Decks", "Build, import, validate and check ownership") {
                IconButton(onClick = { controller.loadDecks() }) { Icon(Icons.Default.Refresh, "Refresh decks") }
                FloatingActionButton(onClick = { showCreate = true }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.Add, "New deck")
                }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { showCreate = true }, modifier = Modifier.weight(1f)) { Text("New deck") }
                OutlinedButton(onClick = { showImport = true }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.FileDownload, null)
                    Spacer(Modifier.size(6.dp))
                    Text("Import")
                }
            }
        }
        item {
            OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), label = { Text("Search decks") }, singleLine = true)
        }
        state.error?.let { error -> item { SocialError(error) { controller.loadDecks() } } }
        if (state.loadingDecks && state.decks.isEmpty()) item { SocialLoading("Loading decks…") }
        else if (filtered.isEmpty()) item {
            SocialEmpty(
                if (state.decks.isEmpty()) "No decks" else "No matching decks",
                if (state.decks.isEmpty()) "Build a deck from scratch or import an existing list." else "Try another search.",
            )
        }
        items(filtered, key = { it.id }) { deck ->
            Card(Modifier.fillMaxWidth().clickable { onOpenDeck(deck.id) }) {
                Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(deck.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            AssistChip(onClick = {}, label = { Text(deck.tcg.gameLabel()) })
                            deck.format?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                            Text("${deck.cardCount} cards", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    IconButton(onClick = { deleting = deck }) { Icon(Icons.Default.Delete, "Delete ${deck.name}") }
                }
            }
        }
    }

    if (showCreate) DeckEditorDialog(null, { showCreate = false }) { draft ->
        controller.createDeck(draft) { if (it) showCreate = false }
    }
    if (showImport) DeckImportDialog({ showImport = false }) { request ->
        controller.importDeck(request) { if (it != null) showImport = false }
    }
    deleting?.let { deck ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete ${deck.name}?") },
            text = { Text("The deck and its card list will be removed from the server.") },
            confirmButton = { TextButton(onClick = { controller.deleteDeck(deck.id); deleting = null }) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
        )
    }
}

@Composable
fun DeckDetailScreen(
    controller: SocialFeatureController,
    deckId: String,
    contentPadding: PaddingValues,
    onBack: () -> Unit,
) {
    val state by controller.state.collectAsStateWithLifecycle()
    val deck = state.selectedDeck?.takeIf { it.id == deckId } ?: state.decks.firstOrNull { it.id == deckId }
    var editingDeck by remember { mutableStateOf(false) }
    var addingCard by remember { mutableStateOf(false) }
    var editingCard by remember { mutableStateOf<DeckCard?>(null) }
    var deletingCard by remember { mutableStateOf<DeckCard?>(null) }
    var showExport by remember { mutableStateOf(false) }
    LaunchedEffect(controller, deckId) { controller.loadDeck(deckId) }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = contentPadding.calculateTopPadding() + 12.dp,
            bottom = contentPadding.calculateBottomPadding() + 28.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back") }
                Column(Modifier.weight(1f)) {
                    Text(deck?.name ?: "Deck", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text("Deck details", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (deck != null) IconButton(onClick = { editingDeck = true }) { Icon(Icons.Default.Edit, "Edit deck") }
            }
        }
        if (state.loadingDeckDetail && deck == null) item { SocialLoading("Loading deck…") }
        state.error?.let { error -> item { SocialError(error) { controller.loadDeck(deckId) } } }
        deck?.let { value ->
            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            AssistChip(onClick = {}, label = { Text(value.tcg.gameLabel()) })
                            value.format?.let { AssistChip(onClick = {}, label = { Text(it) }) }
                            AssistChip(onClick = {}, label = { Text(if (value.isPublic) "Public" else "Private") })
                        }
                        value.description?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        Text("${value.cardCount} cards", fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { addingCard = true }, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Default.Add, null); Spacer(Modifier.size(6.dp)); Text("Add card")
                    }
                    OutlinedButton(onClick = { controller.runDeckChecks(deckId, value.format) }, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Default.CheckCircle, null); Spacer(Modifier.size(6.dp)); Text("Check")
                    }
                    IconButton(onClick = { controller.exportDeck(deckId); showExport = true }) { Icon(Icons.Default.Share, "Export YDK") }
                }
                if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 6.dp))
            }
            state.deckValidation?.let { validation -> item { DeckValidationCard(validation) } }
            state.deckOwnership?.takeIf { it.missingCount > 0 }?.let { ownership ->
                item {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text("Missing ${ownership.missingCount} cards", fontWeight = FontWeight.Bold)
                            ownership.missing.forEach { Text("${it.name} · ${it.zone.gameLabel()} ×${it.quantity}") }
                        }
                    }
                }
            }
            deckZones.forEach { zone ->
                val cards = value.cards.filter { it.zone == zone }
                if (cards.isNotEmpty()) {
                    item { Text("${zone.gameLabel()} · ${cards.sumOf(DeckCard::quantity)}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                    items(cards, key = { it.id }) { card ->
                        Card(Modifier.fillMaxWidth().clickable { editingCard = card }) {
                            Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(card.name, fontWeight = FontWeight.SemiBold)
                                    Text(listOfNotNull(card.setName, card.setCode).joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                                }
                                Text("×${card.quantity}", fontWeight = FontWeight.Bold)
                                IconButton(onClick = { deletingCard = card }) { Icon(Icons.Default.Delete, "Remove ${card.name}") }
                            }
                        }
                    }
                }
            }
            if (value.cards.isEmpty()) item { SocialEmpty("No cards", "Add cards manually or import a deck list.") }
        }
    }

    if (editingDeck && deck != null) DeckEditorDialog(deck, { editingDeck = false }) { draft ->
        controller.updateDeck(
            deckId,
            DeckUpdate(draft.name.trim(), draft.description.clean(), draft.format.clean(), draft.colorHex.clean(), draft.isPublic),
        ) { if (it) editingDeck = false }
    }
    if (addingCard && deck != null) DeckCardDialog(deck.tcg, null, { addingCard = false }) { draft ->
        controller.addDeckCard(deckId, draft) { if (it) addingCard = false }
    }
    editingCard?.let { card -> DeckCardDialog(card.tcg, card, { editingCard = null }) { draft ->
        controller.updateDeckCard(deckId, card.id, DeckCardUpdate(draft.quantity, draft.zone, card.isCommander, draft.zone == "side")) {
            if (it) editingCard = null
        }
    } }
    deletingCard?.let { card ->
        AlertDialog(
            onDismissRequest = { deletingCard = null },
            title = { Text("Remove ${card.name}?") },
            confirmButton = { TextButton(onClick = { controller.deleteDeckCard(deckId, card.id); deletingCard = null }) { Text("Remove") } },
            dismissButton = { TextButton(onClick = { deletingCard = null }) { Text("Cancel") } },
        )
    }
    if (showExport) DeckExportDialog(state.ydkExport, state.busy) { showExport = false }
}

@Composable
private fun DeckValidationCard(validation: DeckValidation) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(if (validation.valid) "Deck is valid" else "Deck needs attention", fontWeight = FontWeight.Bold)
            validation.errors.forEach { Text(it, color = MaterialTheme.colorScheme.error) }
            validation.warnings.forEach { Text(it, color = MaterialTheme.colorScheme.tertiary) }
            validation.violations.orEmpty().forEach { Text(it.message, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

@Composable
private fun DeckEditorDialog(initial: Deck?, onDismiss: () -> Unit, onConfirm: (DeckDraft) -> Unit) {
    var name by remember(initial?.id) { mutableStateOf(initial?.name.orEmpty()) }
    var description by remember(initial?.id) { mutableStateOf(initial?.description.orEmpty()) }
    var game by remember(initial?.id) { mutableStateOf(initial?.tcg ?: "pokemon") }
    var format by remember(initial?.id) { mutableStateOf(initial?.format.orEmpty()) }
    var isPublic by remember(initial?.id) { mutableStateOf(initial?.isPublic ?: false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initial == null) "New deck" else "Edit deck") },
        text = {
            Column(Modifier.fillMaxWidth().heightIn(max = 540.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("Name") }, singleLine = true)
                OutlinedTextField(description, { description = it }, Modifier.fillMaxWidth(), label = { Text("Description") }, minLines = 2)
                if (initial == null) {
                    Text("Game", fontWeight = FontWeight.SemiBold)
                    supportedDeckGames.chunked(3).forEach { row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { row.forEach { item ->
                            FilterChip(selected = game == item, onClick = { game = item }, label = { Text(item.gameLabel()) })
                        } }
                    }
                }
                OutlinedTextField(format, { format = it }, Modifier.fillMaxWidth(), label = { Text("Format (optional)") }, singleLine = true)
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Public deck", Modifier.weight(1f)); Switch(isPublic, { isPublic = it })
                }
            }
        },
        confirmButton = { TextButton(onClick = { onConfirm(DeckDraft(name, description, game, format, initial?.colorHex, isPublic)) }, enabled = name.isNotBlank()) { Text(if (initial == null) "Create" else "Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun DeckImportDialog(onDismiss: () -> Unit, onConfirm: (DeckImportRequest) -> Unit) {
    var source by remember { mutableStateOf("text") }
    var data by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var game by remember { mutableStateOf("pokemon") }
    var format by remember { mutableStateOf("") }
    val sources = listOf("text", "ydk", "arena", "moxfield", "archidekt")
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Import deck") },
        text = {
            Column(Modifier.fillMaxWidth().heightIn(max = 580.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Source", fontWeight = FontWeight.SemiBold)
                sources.chunked(3).forEach { row -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    row.forEach { item -> FilterChip(source == item, { source = item }, { Text(item.gameLabel()) }) }
                } }
                OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("Deck name (optional)") })
                if (source != "ydk") {
                    Text("Game", fontWeight = FontWeight.SemiBold)
                    supportedDeckGames.chunked(3).forEach { row -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        row.forEach { item -> FilterChip(game == item, { game = item }, { Text(item.gameLabel()) }) }
                    } }
                }
                OutlinedTextField(format, { format = it }, Modifier.fillMaxWidth(), label = { Text("Format (optional)") })
                OutlinedTextField(
                    data, { data = it }, Modifier.fillMaxWidth(),
                    label = { Text(if (source in setOf("moxfield", "archidekt")) "URL" else "Deck list") },
                    minLines = 6,
                )
            }
        },
        confirmButton = { TextButton(onClick = { onConfirm(DeckImportRequest(source, data.trim(), name.clean(), if (source == "ydk") null else game, format.clean())) }, enabled = data.isNotBlank()) { Text("Import") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun DeckCardDialog(game: String, initial: DeckCard?, onDismiss: () -> Unit, onConfirm: (DeckCardDraft) -> Unit) {
    var externalId by remember(initial?.id) { mutableStateOf(initial?.externalId.orEmpty()) }
    var name by remember(initial?.id) { mutableStateOf(initial?.name.orEmpty()) }
    var quantity by remember(initial?.id) { mutableIntStateOf(initial?.quantity ?: 1) }
    var zone by remember(initial?.id) { mutableStateOf(initial?.zone ?: "main") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initial == null) "Add card" else "Edit card") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (initial == null) {
                    OutlinedTextField(externalId, { externalId = it }, Modifier.fillMaxWidth(), label = { Text("Catalog card ID") }, singleLine = true)
                    OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("Card name") }, singleLine = true)
                } else Text(initial.name, fontWeight = FontWeight.SemiBold)
                OutlinedTextField(quantity.toString(), { quantity = it.toIntOrNull()?.coerceIn(1, 999) ?: quantity }, Modifier.fillMaxWidth(), label = { Text("Quantity") }, singleLine = true)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    deckZones.forEach { item -> FilterChip(zone == item, { zone = item }, { Text(item.gameLabel()) }) }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onConfirm(DeckCardDraft(externalId, game, name, quantity, zone)) }, enabled = initial != null || (externalId.isNotBlank() && name.isNotBlank())) { Text(if (initial == null) "Add" else "Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun DeckExportDialog(export: DeckYdkExport?, loading: Boolean, onDismiss: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("YDK export") },
        text = {
            if (loading && export == null) SocialLoading("Preparing export…")
            else Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(export?.content ?: "Export is not available yet.", maxLines = 18, overflow = TextOverflow.Ellipsis)
                export?.skipped?.takeIf { it.isNotEmpty() }?.let { skipped ->
                    Text("Skipped", fontWeight = FontWeight.Bold)
                    skipped.forEach { Text("${it.name}: ${it.reason}", style = MaterialTheme.typography.bodySmall) }
                }
            }
        },
        confirmButton = { TextButton(onClick = { export?.content?.let { clipboard.setText(AnnotatedString(it)) } }, enabled = export != null) { Text("Copy") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Done") } },
    )
}

internal fun String.gameLabel(): String = when (lowercase()) {
    "yugioh" -> "Yu-Gi-Oh!"
    "onepiece" -> "One Piece"
    "dragonball" -> "Dragon Ball"
    "ydk" -> "YDK"
    "moxfield" -> "Moxfield"
    "archidekt" -> "Archidekt"
    else -> replaceFirstChar { it.uppercase() }
}
