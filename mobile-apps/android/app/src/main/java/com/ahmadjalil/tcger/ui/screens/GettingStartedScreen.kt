package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.ui.AppUiState
import com.ahmadjalil.tcger.ui.AppViewModel

@Composable
fun GettingStartedScreen(state: AppUiState, viewModel: AppViewModel) {
    var mode by rememberSaveable { mutableStateOf("choose") }
    var games by rememberSaveable { mutableStateOf(listOf("pokemon", "magic", "yugioh")) }
    var url by rememberSaveable { mutableStateOf("") }
    LazyColumn(Modifier.fillMaxSize().safeDrawingPadding(), contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { Text("Welcome to TCGer", style = MaterialTheme.typography.headlineLarge); Text("Your cards, organized your way.", style = MaterialTheme.typography.titleMedium) }
        item {
            if (mode == "choose") {
                Button(modifier = Modifier.fillMaxWidth(), onClick = { mode = "local" }) { Text("Start on this device") }
                Text("Keep your collection privately on this device. Download game libraries for offline browsing.")
                OutlinedButton(modifier = Modifier.fillMaxWidth(), onClick = { mode = "server" }) { Text("Connect to a server") }
                Text("Use your own TCGer server to access your collection across devices.")
                BackupTransferPanel(state, viewModel, restoreOnly = true, onImported = { viewModel.finishSetup() })
            } else if (mode == "local") {
                Text("Which games do you collect?", style = MaterialTheme.typography.titleLarge)
                listOf("pokemon", "magic", "yugioh", "onepiece", "lorcana", "dragonball").forEach { game ->
                    Row(Modifier.fillMaxWidth().toggleable(game in games, role = Role.Checkbox) { games = if (it) games + game else games - game }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(game in games, null); Text(game.displayGame(), Modifier.padding(start = 12.dp))
                    }
                }
                Text("You can change these and download libraries in Settings → Games. Downloads are optional.")
                Button(onClick = { viewModel.finishSetup(games.toSet()) }, modifier = Modifier.fillMaxWidth()) { Text("Continue to TCGer") }
            } else {
                OutlinedTextField(url, { url = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Server address") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
                Text("Enter your TCGer backend address. You can sign in or create an account in Settings after connecting.")
                state.message?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                Button(enabled = url.isNotBlank() && !state.isLoading, onClick = { viewModel.configureServer(url) { if (it) viewModel.finishSetup() } }, modifier = Modifier.fillMaxWidth()) { Text(if (state.isLoading) "Connecting…" else "Connect") }
            }
            if (mode != "choose") TextButton(onClick = { mode = "choose" }) { Text("Back") }
        }
    }
}
