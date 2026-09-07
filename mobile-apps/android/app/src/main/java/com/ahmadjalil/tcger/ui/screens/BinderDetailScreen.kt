package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Link
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material3.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material3.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.domain.Binder
import com.ahmadjalil.tcger.domain.BinderInput
import com.ahmadjalil.tcger.domain.BinderShareLink
import com.ahmadjalil.tcger.R
import coil.compose.AsyncImage
import com.ahmadjalil.tcger.domain.*
import androidx.compose.material3.Checkbox
import java.net.URI
import kotlinx.coroutines.launch

@Composable
fun BinderDetailScreen(
    binder: Binder?,
    contentPadding: PaddingValues,
    showPricing: Boolean,
    showCardNumbers: Boolean,
    currency: String,
    shareSiteUrl: String,
    onBack: () -> Unit,
    onAddCard: () -> Unit,
    onScan: () -> Unit,
    onRemove: (String, String) -> Unit,
    binders: List<Binder>,
    local: Boolean,
    onSaveCopy: suspend (OwnedCard, CollectionEdit, String, Int) -> Unit,
    onSellCopy: suspend (OwnedCard, com.ahmadjalil.tcger.feature.settingsparity.CreateFinanceTransaction, Boolean) -> Unit,
    onBulk: suspend (List<OwnedCard>, String?, String?, Boolean) -> Unit,
    onUpdate: (String, BinderInput) -> Unit,
    onLoadShareLinks: suspend (String) -> List<BinderShareLink>,
    onCreateShareLink: suspend (String, String) -> BinderShareLink,
    onRevokeShareLink: suspend (String, String) -> Unit,
    canEdit: Boolean = true,
) {
    if (binder == null) {
        EmptyPane("Binder unavailable", "It may have been removed or is still loading.")
        return
    }
    var editedCopyId by rememberSaveable(binder.id) { mutableStateOf<String?>(null) }
    val editedCopy = binder.cards.firstOrNull { it.id == editedCopyId }
    var pendingDelete by rememberSaveable(binder.id) { mutableStateOf<String?>(null) }
    var query by rememberSaveable(binder.id) { mutableStateOf("") }
    var condition by rememberSaveable(binder.id) { mutableStateOf<String?>(null) }
    var tag by rememberSaveable(binder.id) { mutableStateOf<String?>(null) }
    var sort by rememberSaveable(binder.id) { mutableStateOf(BinderSort.NAME) }
    var grid by rememberSaveable { mutableStateOf(false) }
    var filtering by rememberSaveable { mutableStateOf(false) }
    var selecting by rememberSaveable { mutableStateOf(false) }
    val visibleCards = remember(binder.cards, query, condition, tag, sort) { browseCopies(binder.cards, query, condition, tag, sort) }
    var selected by remember(binder.id) { mutableStateOf<Set<String>>(emptySet()) }
    var bulk by remember { mutableStateOf(false) }
    var editing by remember(binder.id) { mutableStateOf(false) }
    var sharing by remember(binder.id) { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().padding(
            start = 16.dp,
            end = 16.dp,
            top = contentPadding.calculateTopPadding() + 12.dp,
            bottom = contentPadding.calculateBottomPadding(),
        ),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            binder.imageUrl?.takeIf(String::isNotBlank)?.let { coverUrl ->
                AsyncImage(
                    model = coverUrl,
                    contentDescription = "${binder.name} cover",
                    modifier = Modifier.size(48.dp).padding(end = 8.dp),
                )
            }
            Column(Modifier.weight(1f)) {
                Text(binder.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    "${binder.uniqueCards} unique · ${binder.totalCopies} copies" +
                        if (showPricing) " · ${binder.totalValue.asCurrency(currency)}" else "",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                binder.description?.takeIf(String::isNotBlank)?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                binder.defaultCondition?.takeIf(String::isNotBlank)?.let {
                    Text(
                        stringResource(R.string.default_condition_value, it),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                binder.containerType?.takeIf(String::isNotBlank)?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (canEdit) IconButton(onClick = { editing = true }) {
                Icon(Icons.Default.Edit, stringResource(R.string.edit_binder))
            }
            if (!local && canEdit) IconButton(onClick = { sharing = true }) {
                Icon(Icons.Default.Link, "Manage share links")
            }
        }
        OutlinedTextField(query, { query = it }, modifier = Modifier.fillMaxWidth(), singleLine = true, label = { Text("Search this binder") })
        androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item { FilterChip(filtering || condition != null || tag != null, { filtering = !filtering }, { Text("Filter & sort") }) }
            item { FilterChip(grid, { grid = !grid }, { Text(if (grid) "Grid" else "List") }) }
            if (canEdit) item { FilterChip(selecting, { selecting = !selecting; if (!selecting) selected = emptySet() }, { Text("Select copies") }) }
            if (canEdit) item { TextButton(onClick = onAddCard) { Text("Add card") } }
            if (canEdit) item { TextButton(onClick = onScan) { Text("Scan") } }
        }
        if (selected.isNotEmpty()) androidx.compose.foundation.lazy.LazyRow {
            item { TextButton(onClick = { bulk = true }) { Text("Edit ${selected.size} selected") } }
            item { TextButton(onClick = { selected = visibleCards.map { it.id }.toSet() }) { Text("Select visible") } }
            item { TextButton(onClick = { selected = emptySet() }) { Text("Clear selection") } }
        }
        if (binder.cards.isEmpty()) EmptyPane("This binder is empty", "Add a card from search or scan your first card.")
        else if (visibleCards.isEmpty()) {
            EmptyPane("No matching copies", "Try another name or clear your filters.")
            TextButton(onClick = { query = ""; condition = null; tag = null }) { Text("Clear filters") }
        } else {
            Text("${visibleCards.size} of ${binder.cards.size} copies", style = MaterialTheme.typography.labelMedium)
            LazyVerticalGrid(columns = if (grid) GridCells.Adaptive(160.dp) else GridCells.Fixed(1),
                modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
                items(visibleCards, key = { it.id }) { owned ->
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.clickable(enabled = canEdit) { if (selecting) selected = if (owned.id in selected) selected - owned.id else selected + owned.id else editedCopyId = owned.id }.padding(12.dp)) {
                            if (grid) {
                                CardArtwork(owned.card, Modifier.fillMaxWidth().aspectRatio(0.716f))
                                Text(owned.card.name, fontWeight = FontWeight.SemiBold)
                            } else Row(verticalAlignment = Alignment.CenterVertically) {
                                CardArtwork(owned.card, Modifier.size(52.dp, 72.dp))
                                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                                    Text(owned.card.name, style = MaterialTheme.typography.titleSmall)
                                    Text(listOfNotNull(owned.card.setName, owned.card.collectorNumber.takeIf { showCardNumbers }).joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                                    Text(listOfNotNull(owned.condition, owned.details.language).joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                                }
                            }
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                if (selecting) Checkbox(owned.id in selected, { selected = if (it) selected + owned.id else selected - owned.id }, modifier = Modifier.semantics { contentDescription = "Select ${owned.card.name}, ${owned.condition.orEmpty()} copy" })
                                Text("×${owned.quantity}" + if (showPricing && owned.price != null) " · ${owned.price.asCurrency(currency)}" else "", modifier = Modifier.weight(1f))
                                if (!selecting && canEdit) IconButton(onClick = { pendingDelete = owned.id }) { Icon(Icons.Default.Delete, "Remove ${owned.card.name}") }
                            }
                        }
                    }
                }
            }
        }
    }
    if (filtering) AlertDialog(onDismissRequest = { filtering = false }, title = { Text("Filter & sort") },
        text = { Column {
            ChoiceField("Sort by", sort.name, BinderSort.entries.map { it.name to it.label }) { sort = BinderSort.valueOf(it) }
            ChoiceField("Condition", condition.orEmpty(), listOf("" to "All conditions") + binder.cards.mapNotNull { it.condition }.distinct().sorted().map { it to it }) { condition = it.ifBlank { null } }
            ChoiceField("Tag", tag.orEmpty(), listOf("" to "All tags") + binder.cards.flatMap { it.details.tags }.map { it.label }.distinct().sorted().map { it to it }) { tag = it.ifBlank { null } }
        } }, confirmButton = { TextButton(onClick = { filtering = false }) { Text("Done") } }, dismissButton = { TextButton(onClick = { condition = null; tag = null; sort = BinderSort.NAME }) { Text("Reset") } })
    pendingDelete?.let { id -> AlertDialog(onDismissRequest = { pendingDelete = null }, title = { Text("Remove this copy?") },
        text = { Text("${binder.cards.firstOrNull { it.id == id }?.card?.name.orEmpty()} will be removed from this binder.") },
        confirmButton = { TextButton(onClick = { onRemove(binder.id, id); selected = selected - id; pendingDelete = null }) { Text("Remove") } },
        dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("Cancel") } }) }

    editedCopy?.let { copy -> CollectionCopyEditor(copy, binders, local, { editedCopyId = null },
        onSave = { edit, target, extra -> onSaveCopy(copy, edit, target, extra) },
        onSell = { amount, remove -> onSellCopy(copy, amount, remove) }) }
    if (bulk) CollectionBulkEditor(binder.cards.filter { it.id in selected }, binders, { bulk = false; selected = emptySet() }) { condition, target, delete ->
        onBulk(binder.cards.filter { it.id in selected }, condition, target, delete)
    }

    if (editing) BinderEditorDialog(
        title = stringResource(R.string.edit_binder),
        confirmLabel = stringResource(R.string.save),
        initial = binder,
        onDismiss = { editing = false },
        onConfirm = {
            onUpdate(binder.id, it)
            editing = false
        },
    )
    if (sharing) BinderShareLinksDialog(
        binder = binder,
        shareSiteUrl = shareSiteUrl,
        onDismiss = { sharing = false },
        onLoad = onLoadShareLinks,
        onCreate = onCreateShareLink,
        onRevoke = onRevokeShareLink,
    )
}

@Composable
private fun BinderShareLinksDialog(
    binder: Binder,
    shareSiteUrl: String,
    onDismiss: () -> Unit,
    onLoad: suspend (String) -> List<BinderShareLink>,
    onCreate: suspend (String, String) -> BinderShareLink,
    onRevoke: suspend (String, String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var links by remember(binder.id) { mutableStateOf<List<BinderShareLink>>(emptyList()) }
    var label by remember(binder.id) { mutableStateOf("") }
    var loading by remember(binder.id) { mutableStateOf(true) }
    var error by remember(binder.id) { mutableStateOf<String?>(null) }
    var pendingRevoke by remember(binder.id) { mutableStateOf<BinderShareLink?>(null) }

    LaunchedEffect(binder.id) {
        runCatching { onLoad(binder.id) }
            .onSuccess { links = it }
            .onFailure { error = it.message ?: "Could not load share links" }
        loading = false
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Share ${binder.name}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Create separate links and revoke each one independently.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(label, { label = it }, label = { Text("Link label") }, singleLine = true)
                Button(
                    onClick = {
                        scope.launch {
                            runCatching { onCreate(binder.id, label.trim()) }
                                .onSuccess { links = listOf(it) + links; label = "" }
                                .onFailure { error = it.message ?: "Could not create share link" }
                        }
                    },
                    enabled = label.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Create link") }
                if (loading) Text("Loading links…")
                links.forEach { link ->
                    val url = publicShareUrl(shareSiteUrl, link.token)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(link.label, fontWeight = FontWeight.SemiBold)
                            Text(url, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                        }
                        TextButton(onClick = { clipboard.setText(AnnotatedString(url)) }) { Text("Copy") }
                        TextButton(onClick = { pendingRevoke = link }) { Text("Revoke") }
                    }
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
    )

    pendingRevoke?.let { link ->
        AlertDialog(
            onDismissRequest = { pendingRevoke = null },
            title = { Text("Revoke ${link.label}?") },
            text = { Text("Anyone using this link will immediately lose access.") },
            confirmButton = {
                TextButton(onClick = {
                    pendingRevoke = null
                    scope.launch {
                        runCatching { onRevoke(binder.id, link.id) }
                            .onSuccess { links = links.filterNot { it.id == link.id } }
                            .onFailure { error = it.message ?: "Could not revoke share link" }
                    }
                }) { Text("Revoke") }
            },
            dismissButton = { TextButton(onClick = { pendingRevoke = null }) { Text("Cancel") } },
        )
    }
}

private fun publicShareUrl(serverUrl: String, token: String): String = runCatching {
    val source = URI(serverUrl.trim().trimEnd('/'))
    val sitePort = if (source.port == 3004) 3003 else source.port
    val basePath = source.path.orEmpty().trimEnd('/').removeSuffix("/api")
    URI(source.scheme, source.userInfo, source.host, sitePort, "$basePath/shared/$token", null, null).toString()
}.getOrElse { token }
