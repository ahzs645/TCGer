package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.data.gamepackage.CommunityCatalogCard
import com.ahmadjalil.tcger.data.gamepackage.GamePackageFilter
import com.ahmadjalil.tcger.data.gamepackage.GamePackageState
import com.ahmadjalil.tcger.data.gamepackage.InstalledGamePackage
import com.ahmadjalil.tcger.ui.AppViewModel
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

@Composable
fun CommunityGamePackagesSection(
    state: GamePackageState,
    viewModel: AppViewModel,
    onOpenStore: (() -> Unit)? = null,
    onInstallFromUrl: (() -> Unit)? = null,
) {
    var browsing by remember { mutableStateOf<InstalledGamePackage?>(null) }
    var cards by remember { mutableStateOf<List<CommunityCatalogCard>>(emptyList()) }
    val scope = rememberCoroutineScope()

    Column {
        Text("Community game libraries", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 6.dp))
        Card {
            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Install a publisher's HTTPS GamePackageManifest. Catalogs are checksum-verified and stored offline.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (onOpenStore != null && onInstallFromUrl != null) {
                    FilledTonalButton(onClick = onOpenStore, modifier = Modifier.fillMaxWidth()) {
                        Text("Game Store")
                    }
                    FilledTonalButton(onClick = onInstallFromUrl, modifier = Modifier.fillMaxWidth()) {
                        Text("Install from URL")
                    }
                } else {
                    Text("Open the Game Store for TCGer packages, or install another publisher's manifest URL.")
                }
                state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                state.installed.forEachIndexed { index, game ->
                    if (index > 0) HorizontalDivider()
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column(Modifier.weight(1f)) {
                            Text(game.manifest.effectiveDefinition.label, fontWeight = FontWeight.Medium)
                            Text("${game.manifest.catalog.cardCount} cards · v${game.manifest.packageVersion}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(
                                if (game.trust?.status == "verified") "Verified key ${game.trust.fingerprint?.take(12).orEmpty()}" else "Unsigned publisher",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            val interfaces = game.manifest.effectiveDefinition.interfaces?.enabledLabels().orEmpty()
                            if (interfaces.isNotEmpty()) Text("Declared support: ${interfaces.joinToString()}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            state.availableUpdates[game.id]?.let { candidate ->
                                Text(
                                    buildString {
                                        append("Update v${candidate.packageVersion}")
                                        candidate.update?.releaseNotes?.let { append(" · $it") }
                                    },
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                        }
                        TextButton(onClick = { scope.launch { cards = viewModel.communityGameCards(game.id); browsing = game } }) { Text("Browse") }
                        if (state.availableUpdates.containsKey(game.id)) {
                            TextButton(onClick = { viewModel.updateGamePackage(game.id) }) { Text("Update") }
                        }
                        TextButton(onClick = { viewModel.removeGamePackage(game.id) }) { Text("Remove") }
                    }
                }
                if (state.installed.isEmpty()) Text("No community libraries installed.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (state.installed.isNotEmpty()) {
                    TextButton(onClick = viewModel::checkGamePackageUpdates, modifier = Modifier.fillMaxWidth()) {
                        Text("Check for library updates")
                    }
                }
            }
        }
    }
    browsing?.let { CommunityLibraryDialog(it, cards, onDismiss = { browsing = null }) }
}

@Composable
fun OfficialGameStoreScreen(
    state: GamePackageState,
    enabledGames: Set<String>,
    contentPadding: PaddingValues,
    onRefresh: () -> Unit,
    onEnable: (String) -> Unit,
    onBack: (() -> Unit)? = null,
) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = contentPadding.calculateTopPadding() + 16.dp,
            bottom = contentPadding.calculateBottomPadding() + 24.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (onBack != null) item { TextButton(onClick = onBack) { Text("Back") } }
        item {
            Text("Game Store", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(
                "Official libraries are generated from the same signed manifests used by every client.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        item {
            FilledTonalButton(onClick = onRefresh, enabled = !state.isRefreshingOfficial) {
                Text(if (state.isRefreshingOfficial) "Refreshing…" else "Refresh store")
            }
        }
        state.error?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error) } }
        if (state.official.isEmpty() && !state.isRefreshingOfficial) {
            item { Text("The store is unavailable. You can retry or install from a publisher URL.") }
        }
        items(state.official, key = { it.installedId }) { manifest ->
            Card {
                Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(manifest.game.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(
                        "${manifest.catalog.cardCount} cards · v${manifest.packageVersion}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    manifest.game.description?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    val installed = state.installed.any { it.id == manifest.installedId }
                    if (manifest.game.id in enabledGames && !installed) {
                        Text("Enabled with the existing app catalog", style = MaterialTheme.typography.labelSmall)
                    }
                    FilledTonalButton(
                        onClick = { onEnable(manifest.game.id) },
                        enabled = !installed && !state.isInstalling,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (installed) "Downloaded" else if (state.isInstalling) "Installing…" else "Download")
                    }
                }
            }
        }
    }
}

@Composable
fun InstallGamePackageScreen(
    state: GamePackageState,
    contentPadding: PaddingValues,
    onInstall: (String) -> Unit,
    onBack: (() -> Unit)? = null,
) {
    var url by remember { mutableStateOf("") }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = contentPadding.calculateTopPadding() + 16.dp,
            bottom = contentPadding.calculateBottomPadding() + 24.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (onBack != null) item { TextButton(onClick = onBack) { Text("Back") } }
        item {
            Text("Install from URL", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(
                "Paste an HTTPS GamePackageManifest URL. The manifest, signature, and catalog checksum are validated before installation.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        item {
            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Game package URL") },
                singleLine = true,
            )
        }
        item {
            FilledTonalButton(
                onClick = { onInstall(url); url = "" },
                enabled = !state.isInstalling && url.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (state.isInstalling) "Installing…" else "Install game") }
        }
        state.error?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error) } }
    }
}

@Composable
fun GameInstallationScreen(
    state: GamePackageState,
    enabledGames: Set<String>,
    onRefresh: () -> Unit,
    onEnable: (String) -> Unit,
    onInstall: (String) -> Unit,
) {
    var page by remember { mutableStateOf("choose") }
    when (page) {
        "store" -> OfficialGameStoreScreen(
            state = state,
            enabledGames = enabledGames,
            contentPadding = PaddingValues(0.dp),
            onRefresh = onRefresh,
            onEnable = onEnable,
            onBack = { page = "choose" },
        )
        "url" -> InstallGamePackageScreen(
            state = state,
            contentPadding = PaddingValues(0.dp),
            onInstall = onInstall,
            onBack = { page = "choose" },
        )
        else -> LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Text("Install a game to get started", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    "TCGer has no active game libraries. Enable an official game or connect one from another publisher.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            item {
                FilledTonalButton(onClick = { page = "store" }, modifier = Modifier.fillMaxWidth()) {
                    Text("Browse Game Store")
                }
            }
            item {
                FilledTonalButton(onClick = { page = "url" }, modifier = Modifier.fillMaxWidth()) {
                    Text("Install from URL")
                }
            }
        }
    }
}

@Composable
private fun CommunityLibraryDialog(game: InstalledGamePackage, cards: List<CommunityCatalogCard>, onDismiss: () -> Unit) {
    var query by remember(game.id) { mutableStateOf("") }
    var selected by remember(game.id) { mutableStateOf<Map<String, Set<String>>>(emptyMap()) }
    var ranges by remember(game.id) { mutableStateOf<Map<String, Pair<String, String>>>(emptyMap()) }
    val filtered = remember(cards, query, selected, ranges) {
        cards.asSequence().filter { card ->
            (query.isBlank() || card.name.contains(query, ignoreCase = true)) && game.manifest.effectiveDefinition.search.facets.all { filter -> matches(card, filter, selected[filter.id].orEmpty(), ranges[filter.id]) }
        }.take(500).toList()
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(game.manifest.effectiveDefinition.label) },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
        text = {
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 620.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item { OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), label = { Text("Search cards") }, singleLine = true) }
                game.manifest.effectiveDefinition.search.facets.forEach { filter ->
                    item {
                        Text(filter.label, fontWeight = FontWeight.Medium)
                        when (filter.type) {
                            "select", "multiSelect", "boolean" -> {
                                val options = if (filter.type == "boolean") listOf("true" to (filter.trueLabel ?: "Yes"), "false" to (filter.falseLabel ?: "No")) else filter.options.map { option -> option.value.scalarString() to option.label }
                                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    items(options) { option ->
                                        val active = option.first in selected[filter.id].orEmpty()
                                        FilterChip(selected = active, onClick = {
                                            val current = selected[filter.id].orEmpty()
                                            val next = if (active) current - option.first else if (filter.type == "multiSelect") current + option.first else setOf(option.first)
                                            selected = selected + (filter.id to next)
                                        }, label = { Text(option.second) })
                                    }
                                }
                            }
                            "numberRange" -> {
                                val current = ranges[filter.id] ?: ("" to "")
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedTextField(current.first, { ranges = ranges + (filter.id to (it to current.second)) }, Modifier.weight(1f), label = { Text("Min") }, singleLine = true)
                                    OutlinedTextField(current.second, { ranges = ranges + (filter.id to (current.first to it)) }, Modifier.weight(1f), label = { Text("Max") }, singleLine = true)
                                }
                            }
                            else -> OutlinedTextField(selected[filter.id]?.firstOrNull().orEmpty(), { selected = selected + (filter.id to setOf(it)) }, Modifier.fillMaxWidth(), singleLine = true)
                        }
                    }
                }
                item { Text("Showing ${filtered.size}${if (filtered.size == 500) "+" else ""} matching cards", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                items(filtered, key = { it.id }) { card -> Column(Modifier.padding(vertical = 3.dp)) { Text(card.name); card.setCode?.let { Text("$it ${card.collectorNumber.orEmpty()}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } } }
            }
        },
    )
}

private fun matches(card: CommunityCatalogCard, filter: GamePackageFilter, values: Set<String>, range: Pair<String, String>?): Boolean {
    if (filter.type == "numberRange") {
        val numeric = card.value(filter.property)?.let { (it as? JsonPrimitive)?.doubleOrNull } ?: return range?.let { it.first.isBlank() && it.second.isBlank() } ?: true
        return range == null || (range.first.toDoubleOrNull()?.let { numeric >= it } != false && range.second.toDoubleOrNull()?.let { numeric <= it } != false)
    }
    if (values.isEmpty() || values.all { it.isBlank() }) return true
    val actual = card.value(filter.property) ?: return false
    val actualValues = if (actual is JsonArray) actual.map { it.scalarString() } else listOf(actual.scalarString())
    return if (filter.type == "text") {
        val needle = values.first()
        actualValues.any { if (filter.mode == "equals") it.equals(needle, true) else it.contains(needle, true) }
    } else actualValues.any { actualValue -> values.any { it.equals(actualValue, true) } }
}

private fun CommunityCatalogCard.value(path: String): kotlinx.serialization.json.JsonElement? {
    val builtIn = mapOf(
        "id" to id, "name" to name, "setCode" to setCode, "setName" to setName,
        "collectorNumber" to collectorNumber, "rarity" to rarity, "artist" to artist,
        "type" to type, "category" to category, "supertype" to supertype, "language" to language,
        "regulationMark" to regulationMark, "releasedAt" to releasedAt,
    )
    if (path in builtIn) return builtIn[path]?.let(::JsonPrimitive)
    if (path == "sanctionedPlayLegal") return sanctionedPlayLegal?.let(::JsonPrimitive)
    if (path.startsWith("formatLegality.")) return formatLegality[path.removePrefix("formatLegality.")]
    if (path == "dexEntries.number") return JsonArray(dexEntries.mapNotNull { (it as? JsonObject)?.get("number") })
    if (!path.startsWith("attributes.")) return null
    var current: kotlinx.serialization.json.JsonElement = JsonObject(effectiveAttributes())
    path.removePrefix("attributes.").split('.').forEach { key -> current = (current as? JsonObject)?.get(key) ?: return null }
    return current
}

private fun kotlinx.serialization.json.JsonElement.scalarString(): String = (this as? JsonPrimitive)?.let { it.contentOrNull ?: it.booleanOrNull?.toString() } ?: toString()
