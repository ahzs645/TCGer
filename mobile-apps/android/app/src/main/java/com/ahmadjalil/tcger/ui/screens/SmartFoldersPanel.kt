package com.ahmadjalil.tcger.ui.screens

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.domain.*
import com.ahmadjalil.tcger.ui.AppUiState
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.UUID

@Composable
fun SmartFoldersPanel(state: AppUiState, onOpenBinder: (String) -> Unit) {
    val context = LocalContext.current
    val scope = if (state.preferences.dataSourceMode == DataSourceMode.ON_DEVICE) "local" else "${state.preferences.serverUrl}:${state.preferences.userId}"
    val store = remember { context.getSharedPreferences("smart_folders", Context.MODE_PRIVATE) }
    var error by remember { mutableStateOf<String?>(null) }
    var folders by remember(scope) { mutableStateOf(runCatching { Json { ignoreUnknownKeys = true }.decodeFromString<List<SmartFolder>>(store.getString(scope, "[]") ?: "[]") }.getOrElse { error = "Could not read saved folders: ${it.message}"; emptyList() }) }
    var open by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<SmartFolder?>(null) }
    var draft by remember { mutableStateOf<SmartFolder?>(null) }
    var ruleType by remember { mutableStateOf("tcg") }
    var ruleValue by remember { mutableStateOf("") }
    fun save(next: List<SmartFolder>): Boolean {
        if (!store.edit().putString(scope, Json.encodeToString(next)).commit()) { error = "Could not save folders. Your previous folders are retained."; return false }
        folders = next; error = null; return true
    }
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    TextButton(onClick = { open = true }) { Text("Smart folders (${folders.size})") }
    if (open) AlertDialog(onDismissRequest = { open = false; selected = null }, title = { Text(selected?.name ?: "Smart folders") },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (selected == null) {
                folders.forEach { folder -> Row {
                    TextButton(onClick = { selected = folder }, modifier = Modifier.weight(1f)) { Text(folder.name) }
                    TextButton(onClick = { draft = folder }) { Text("Edit") }
                    TextButton(onClick = { save(folders.filterNot { it.id == folder.id }) }) { Text("Delete") }
                } }
                Button(onClick = { draft = SmartFolder(UUID.randomUUID().toString(), "", rules = emptyList()) }) { Text("New smart folder") }
            } else {
                val matches = state.binders.flatMap { it.cards }.filter { selected!!.matches(it) }
                Text("${matches.sumOf { it.quantity }} matching copies")
                matches.forEach { copy -> TextButton(onClick = { open = false; onOpenBinder(copy.binderId) }) {
                    Text("${copy.card.name} · ${copy.condition.orEmpty()} · ${state.binders.firstOrNull { it.id == copy.binderId }?.name.orEmpty()}")
                } }
            }
        } }, confirmButton = { TextButton(onClick = { if (selected != null) selected = null else open = false }) { Text(if (selected == null) "Done" else "Back") } })
    draft?.let { editing -> AlertDialog(onDismissRequest = { draft = null }, title = { Text("Edit smart folder") },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(editing.name, { draft = editing.copy(name = it) }, label = { Text("Name") })
            Row { Switch(editing.matchMode == "all", { draft = editing.copy(matchMode = if (it) "all" else "any") }); Text("Match ${editing.matchMode} rules") }
            editing.rules.forEach { rule -> Row {
                Text("${rule.type}: ${rule.value}", Modifier.weight(1f))
                TextButton(onClick = { draft = editing.copy(rules = editing.rules.filterNot { it.id == rule.id }) }) { Text("Remove") }
            } }
            listOf("tcg", "rarity", "condition", "setCode", "isFoil", "tag").forEach { type -> Row {
                RadioButton(ruleType == type, { ruleType = type }); Text(type)
            } }
            OutlinedTextField(ruleValue, { ruleValue = it }, label = { Text("Match value") }, enabled = ruleType != "isFoil")
            TextButton(enabled = ruleType == "isFoil" || ruleValue.isNotBlank(), onClick = {
                draft = editing.copy(rules = editing.rules + SmartFolderRule(UUID.randomUUID().toString(), ruleType, if (ruleType == "isFoil") "true" else ruleValue.trim()))
                ruleValue = ""
            }) { Text("Add rule") }
        } }, confirmButton = { TextButton(enabled = editing.name.isNotBlank(), onClick = {
            if (save(folders.filterNot { it.id == editing.id } + editing)) draft = null
        }) { Text("Save folder") } }, dismissButton = { TextButton(onClick = { draft = null }) { Text("Cancel") } }) }
}
