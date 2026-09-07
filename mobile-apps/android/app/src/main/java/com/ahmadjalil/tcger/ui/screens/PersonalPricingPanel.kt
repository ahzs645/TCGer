package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.feature.settingsparity.*
import kotlinx.coroutines.launch

@Composable
fun PersonalPricingPanel() {
    val context = LocalContext.current
    val store = remember { PersonalPricingStore(context) }
    var key by remember { mutableStateOf("") }
    var configured by remember { mutableStateOf(store.key() != null) }
    var condition by remember { mutableStateOf(store.condition) }
    var language by remember { mutableStateOf(store.language) }
    var notice by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Personal JustTCG pricing", style = MaterialTheme.typography.titleMedium)
        Text("Use your own JustTCG key for local collection pricing. It stays encrypted on this device and is excluded from backups. Live refresh uses your provider quota.", style = MaterialTheme.typography.bodySmall)
        OutlinedTextField(key, { key = it }, Modifier.fillMaxWidth(), label = { Text(if (configured) "Replacement API key" else "Personal API key") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
        Row {
            TextButton(enabled = key.isNotBlank() && !busy, onClick = { runCatching { store.saveKey(key) }.onSuccess { key = ""; configured = true; notice = "Key saved" }.onFailure { notice = "Could not securely save the key" } }) { Text("Save key") }
            TextButton(enabled = configured && !busy, onClick = { busy = true; scope.launch { runCatching { PersonalPricingClient(store) { "justtcg" }.test() }.onSuccess { notice = "Connection verified in $it ms" }.onFailure { notice = it.message }; busy = false } }) { Text(if (busy) "Testing…" else "Test connection") }
            if (configured) TextButton(onClick = { store.removeKey(); configured = false; notice = "Key removed" }) { Text("Remove") }
        }
        ChoiceField("Condition preference", condition, listOf("match" to "Match each copy") + listOf("Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged").map { it to it }) { condition = it; store.condition = it }
        ChoiceField("Language preference", language, listOf("match" to "Match each copy") + listOf("English", "Japanese", "French", "German", "Italian", "Spanish").map { it to it }) { language = it; store.language = it }
        notice?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
}
