package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.domain.AccentChoice
import com.ahmadjalil.tcger.domain.DataSourceMode
import com.ahmadjalil.tcger.domain.ThemeMode
import com.ahmadjalil.tcger.generated.ParityFeatureIDs
import com.ahmadjalil.tcger.ui.AppUiState
import com.ahmadjalil.tcger.ui.AppViewModel

@Composable
fun SettingsScreen(
    state: AppUiState,
    contentPadding: PaddingValues,
    viewModel: AppViewModel,
    onServerDebugCaptures: () -> Unit = {},
) {
    var serverDialog by remember { mutableStateOf(false) }
    var signInDialog by remember { mutableStateOf(false) }
    val games = listOf("pokemon", "magic", "yugioh", "onepiece", "lorcana", "dragonball")

    LazyColumn(
        Modifier.fillMaxSize().testTag(ParityFeatureIDs.screen(ParityFeatureIDs.SETTINGS_BROWSE)),
        contentPadding = PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = contentPadding.calculateTopPadding() + 20.dp,
            bottom = contentPadding.calculateBottomPadding() + 24.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item { ScreenTitle("Settings", "Preferences and app configuration") }
        item {
            SettingsSection("Data source") {
                ChoiceRow(
                    selected = state.preferences.dataSourceMode == DataSourceMode.ON_DEVICE,
                    title = "On this device",
                    subtitle = "Private, offline-first collection storage",
                    icon = { Icon(Icons.Default.PhoneAndroid, null) },
                    onClick = viewModel::useOnDevice,
                )
                ChoiceRow(
                    selected = state.preferences.dataSourceMode == DataSourceMode.SERVER,
                    title = "TCGer server",
                    subtitle = state.preferences.serverUrl.ifBlank { "Connect to a self-hosted server" },
                    icon = { Icon(Icons.Default.Cloud, null) },
                    onClick = { serverDialog = true },
                )
                if (state.preferences.dataSourceMode == DataSourceMode.SERVER) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        if (state.preferences.isSignedIn) {
                            Text("Signed in as ${state.preferences.username}", Modifier.align(Alignment.CenterVertically))
                            TextButton(onClick = viewModel::signOut) { Text("Sign out") }
                        } else {
                            TextButton(onClick = { signInDialog = true }) { Text("Sign in") }
                        }
                        TextButton(onClick = { serverDialog = true }) { Text("Change server") }
                    }
                    if (state.preferences.isSignedIn) {
                        FilledTonalButton(onClick = onServerDebugCaptures, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Default.BugReport, contentDescription = null)
                            Text("Server scan debug captures", Modifier.padding(start = 8.dp))
                        }
                    }
                }
            }
        }
        item {
            SettingsSection("Appearance") {
                Text("Theme", fontWeight = FontWeight.Medium)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(ThemeMode.entries) { theme ->
                        FilterChip(
                            selected = state.preferences.themeMode == theme,
                            onClick = { viewModel.setTheme(theme) },
                            label = { Text(theme.name.lowercase().replaceFirstChar { it.uppercase() }) },
                        )
                    }
                }
                Text("Accent", fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 8.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(AccentChoice.entries) { accent ->
                        FilterChip(
                            selected = state.preferences.accent == accent,
                            onClick = { viewModel.setAccent(accent) },
                            label = { Text(accent.name.lowercase().replaceFirstChar { it.uppercase() }) },
                        )
                    }
                }
            }
        }
        item {
            SettingsSection("Collection display") {
                SwitchRow("Show pricing", "Display estimated card and binder values", state.preferences.showPricing, viewModel::setShowPricing)
                Text("Currency", fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("USD", "CAD", "EUR", "GBP").forEach { currency ->
                        AssistChip(onClick = { viewModel.setCurrency(currency) }, label = {
                            Text(if (state.preferences.currency == currency) "✓ $currency" else currency)
                        })
                    }
                }
            }
        }
        item {
            SettingsSection("Games") {
                games.forEach { game ->
                    SwitchRow(
                        game.displayGame(),
                        "Show $game in search and catalog features",
                        game in state.preferences.enabledGames,
                    ) { viewModel.setGameEnabled(game, it) }
                }
            }
        }
        item {
            Text(
                "Android milestone 1 · Collection vertical slice",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    if (serverDialog) {
        ServerDialog(
            initialUrl = state.preferences.serverUrl,
            busy = state.isLoading,
            onDismiss = { serverDialog = false },
            onConfirm = { url -> viewModel.configureServer(url) { success -> if (success) { serverDialog = false; signInDialog = true } } },
        )
    }
    if (signInDialog) {
        SignInDialog(
            busy = state.isLoading,
            onDismiss = { signInDialog = false },
            onConfirm = { username, password -> viewModel.signIn(username, password) { success -> if (success) signInDialog = false } },
        )
    }
}

@Composable
private fun SettingsSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 6.dp))
        Card { Column(Modifier.fillMaxWidth().padding(14.dp), content = content) }
    }
}

@Composable
private fun ChoiceRow(
    selected: Boolean,
    title: String,
    subtitle: String,
    icon: @Composable () -> Unit,
    onClick: () -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        RadioButton(selected, onClick)
        icon()
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(title, fontWeight = FontWeight.Medium)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SwitchRow(title: String, subtitle: String, checked: Boolean, onChecked: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Medium)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked, onChecked)
    }
}

@Composable
private fun ServerDialog(initialUrl: String, busy: Boolean, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var url by remember(initialUrl) { mutableStateOf(initialUrl) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Connect to TCGer") },
        text = {
            Column {
                Text("Enter the backend address. Local HTTP servers are supported for development.")
                OutlinedTextField(url, { url = it }, Modifier.fillMaxWidth().padding(top = 12.dp), label = { Text("Server URL") }, singleLine = true)
            }
        },
        confirmButton = { TextButton(onClick = { onConfirm(url) }, enabled = url.isNotBlank() && !busy) { Text(if (busy) "Checking…" else "Connect") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun SignInDialog(busy: Boolean, onDismiss: () -> Unit, onConfirm: (String, String) -> Unit) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Sign in") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(username, { username = it }, label = { Text("Username") }, singleLine = true)
                OutlinedTextField(
                    password,
                    { password = it },
                    label = { Text("Password") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(username, password) }, enabled = username.isNotBlank() && password.isNotBlank() && !busy) {
                Text(if (busy) "Signing in…" else "Sign in")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
