package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
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
fun CommunityGamePackagesSection(state: GamePackageState, viewModel: AppViewModel) {
    var url by remember { mutableStateOf("") }
    var browsing by remember { mutableStateOf<InstalledGamePackage?>(null) }
    var cards by remember { mutableStateOf<List<CommunityCatalogCard>>(emptyList()) }
    val scope = rememberCoroutineScope()

    Column {
        Text("Community game libraries", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 6.dp))
        Card {
            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Install a publisher's HTTPS GamePackageManifest. Catalogs are checksum-verified and stored offline.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(url, { url = it }, Modifier.fillMaxWidth(), label = { Text("Game package URL") }, singleLine = true)
                FilledTonalButton(onClick = { viewModel.installGamePackage(url); url = "" }, enabled = !state.isInstalling && url.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text(if (state.isInstalling) "Installing…" else "Install from URL") }
                state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                state.installed.forEachIndexed { index, game ->
                    if (index > 0) HorizontalDivider()
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column(Modifier.weight(1f)) { Text(game.manifest.game.name, fontWeight = FontWeight.Medium); Text("${game.manifest.catalog.cardCount} cards · v${game.manifest.packageVersion}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        TextButton(onClick = { scope.launch { cards = viewModel.communityGameCards(game.id); browsing = game } }) { Text("Browse") }
                        TextButton(onClick = { viewModel.removeGamePackage(game.id) }) { Text("Remove") }
                    }
                }
                if (state.installed.isEmpty()) Text("No community libraries installed.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    browsing?.let { CommunityLibraryDialog(it, cards, onDismiss = { browsing = null }) }
}

@Composable
private fun CommunityLibraryDialog(game: InstalledGamePackage, cards: List<CommunityCatalogCard>, onDismiss: () -> Unit) {
    var query by remember(game.id) { mutableStateOf("") }
    var selected by remember(game.id) { mutableStateOf<Map<String, Set<String>>>(emptyMap()) }
    var ranges by remember(game.id) { mutableStateOf<Map<String, Pair<String, String>>>(emptyMap()) }
    val filtered = remember(cards, query, selected, ranges) {
        cards.asSequence().filter { card ->
            (query.isBlank() || card.name.contains(query, ignoreCase = true)) && game.manifest.filters.all { filter -> matches(card, filter, selected[filter.id].orEmpty(), ranges[filter.id]) }
        }.take(500).toList()
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(game.manifest.game.name) },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
        text = {
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 620.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item { OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), label = { Text("Search cards") }, singleLine = true) }
                game.manifest.filters.forEach { filter ->
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
    val builtIn = mapOf("id" to id, "name" to name, "setCode" to setCode, "collectorNumber" to collectorNumber, "rarity" to rarity, "artist" to artist, "type" to type, "category" to category, "releasedAt" to releasedAt)
    if (path in builtIn) return builtIn[path]?.let(::JsonPrimitive)
    if (!path.startsWith("attributes.")) return null
    var current: kotlinx.serialization.json.JsonElement = JsonObject(attributes)
    path.removePrefix("attributes.").split('.').forEach { key -> current = (current as? JsonObject)?.get(key) ?: return null }
    return current
}

private fun kotlinx.serialization.json.JsonElement.scalarString(): String = (this as? JsonPrimitive)?.let { it.contentOrNull ?: it.booleanOrNull?.toString() } ?: toString()
