package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.domain.*
import com.ahmadjalil.tcger.ui.AppViewModel
import kotlinx.coroutines.launch

@Composable
fun WishlistRulesPanel(wishlist: Wishlist, viewModel: AppViewModel) {
    var open by remember { mutableStateOf(false) }
    var type by remember { mutableStateOf("name") }
    var game by remember { mutableStateOf("pokemon") }
    var value by remember { mutableStateOf("") }
    var allPrintings by remember { mutableStateOf(true) }
    var autoSync by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun run(block: suspend () -> Unit) { scope.launch {
        busy = true
        runCatching { block() }.onFailure { error = it.message }
        busy = false
    } }
    LaunchedEffect(wishlist.id) {
        runCatching { wishlist.rules.filter { it.autoSync }.forEach { viewModel.syncWishlistRule(wishlist.id, it) } }.onFailure { error = it.message }
    }
    TextButton(onClick = { open = true }) { Text("Wishlist rules (${wishlist.rules.size})") }
    if (open) AlertDialog(onDismissRequest = { if (!busy) open = false }, title = { Text("Auto-updating wishlist rules") },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            wishlist.rules.forEach { rule ->
                Text(rule.label)
                Text(rule.lastSyncedAt?.let { "${rule.lastMatchCount ?: 0} matches · $it" } ?: "Not synced yet")
                Row {
                    TextButton(enabled = !busy, onClick = { run { viewModel.syncWishlistRule(wishlist.id, rule) } }) { Text("Sync") }
                    TextButton(enabled = !busy, onClick = { run { viewModel.saveWishlistRule(wishlist.id, rule.copy(autoSync = !rule.autoSync)) } }) { Text(if (rule.autoSync) "Pause auto-sync" else "Enable auto-sync") }
                    TextButton(enabled = !busy, onClick = { run { viewModel.deleteWishlistRule(wishlist.id, rule.id) } }) { Text("Remove") }
                }
                HorizontalDivider()
            }
            Text("Add a rule")
            listOf("name", "set", "artist", "tag").forEach { option -> Row {
                RadioButton(type == option, { type = option }); Text(option.replaceFirstChar(Char::uppercase))
            } }
            OutlinedTextField(game, { game = it }, label = { Text("Game code (blank for all games)") })
            OutlinedTextField(value, { value = it }, label = { Text(if (type == "set") "Set code" else "Search value") })
            Row { Checkbox(allPrintings, { allPrintings = it }); Text("Include every printing") }
            Row { Checkbox(autoSync, { autoSync = it }); Text("Sync when opening this wishlist") }
            Button(enabled = !busy && value.isNotBlank(), onClick = { run {
                viewModel.saveWishlistRule(wishlist.id, WishlistRule(type = type, tcg = game.trim().ifBlank { null },
                    query = value.trim().takeUnless { type == "set" }, setCode = value.trim().takeIf { type == "set" },
                    includeAllPrintings = allPrintings, autoSync = autoSync))
                value = ""
            } }) { Text(if (busy) "Working…" else "Add and sync rule") }
        } }, confirmButton = { TextButton(enabled = !busy, onClick = { open = false }) { Text("Done") } })
}
