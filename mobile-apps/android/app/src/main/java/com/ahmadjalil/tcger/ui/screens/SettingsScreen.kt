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
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricManager
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
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.domain.AccentChoice
import com.ahmadjalil.tcger.domain.DataSourceMode
import com.ahmadjalil.tcger.domain.ThemeMode
import com.ahmadjalil.tcger.R
import com.ahmadjalil.tcger.data.scanner.model.ScannerAssetInstallStatus
import com.ahmadjalil.tcger.data.scanner.ScannerOptionsStore
import com.ahmadjalil.tcger.data.backup.CollectionBackupJson
import com.ahmadjalil.tcger.data.preferences.AppCacheManager
import com.ahmadjalil.tcger.generated.ParityFeatureIDs
import com.ahmadjalil.tcger.feature.libraryoperations.LibraryOperationsHostScreen
import com.ahmadjalil.tcger.feature.libraryoperations.RemoteLibraryOperationsRepository
import com.ahmadjalil.tcger.ui.AppUiState
import com.ahmadjalil.tcger.ui.AppViewModel

@Composable
fun SettingsScreen(
    state: AppUiState,
    contentPadding: PaddingValues,
    viewModel: AppViewModel,
    onServerDebugCaptures: () -> Unit = {},
    onCustomizeBottomNavigation: () -> Unit = {},
    onPricingSources: () -> Unit = {},
    onServerAccess: () -> Unit = {},
    onFinanceHistory: () -> Unit = {},
    onGameStore: () -> Unit = {},
    onInstallGameFromUrl: () -> Unit = {},
) {
    val context = LocalContext.current
    var serverDialog by remember { mutableStateOf(false) }
    var signInDialog by remember { mutableStateOf(false) }
    var showingLibraryOperations by remember { mutableStateOf(false) }
    var transferMessage by remember { mutableStateOf<String?>(null) }
    var pendingExport by remember { mutableStateOf("") }
    val cacheManager = remember(context) { AppCacheManager(context) }
    val scannerOptionsStore = remember(context) { ScannerOptionsStore(context) }
    var scannerOptions by remember { mutableStateOf(scannerOptionsStore.load()) }
    var cacheBytes by remember { mutableStateOf(cacheManager.sizeBytes()) }
    val exportDocument = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openOutputStream(uri)?.bufferedWriter()?.use { it.write(pendingExport) }
                ?: error("Could not open the selected file")
        }.onSuccess { transferMessage = "Export saved." }
            .onFailure { transferMessage = it.message }
    }
    val importBackup = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                ?: error("Could not read the selected backup")
        }.onSuccess(viewModel::importPortableBackup)
            .onFailure { transferMessage = it.message }
    }
    val games = (state.gamePackages.official.map { it.game.id } + state.preferences.enabledGames)
        .distinct()
        .sorted()
    val biometricAvailable = remember(context) {
        BiometricManager.from(context).canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL,
        ) == BiometricManager.BIOMETRIC_SUCCESS
    }
    val libraryOperationsRepository = remember(
        state.preferences.serverUrl,
        state.preferences.authToken,
        state.preferences.dataSourceMode,
    ) {
        val token = state.preferences.authToken
        if (state.preferences.dataSourceMode == DataSourceMode.SERVER && !token.isNullOrBlank()) {
            runCatching {
                RemoteLibraryOperationsRepository.create(state.preferences.serverUrl, token)
            }.getOrNull()
        } else null
    }

    if (showingLibraryOperations) {
        LibraryOperationsHostScreen(
            repository = libraryOperationsRepository,
            contentPadding = contentPadding,
            onBack = { showingLibraryOperations = false },
        )
        return
    }

    LaunchedEffect(state.scannerSupportedGames) {
        state.scannerSupportedGames.forEach(viewModel::refreshScannerAssets)
    }

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
                        FilledTonalButton(onClick = onServerAccess, modifier = Modifier.fillMaxWidth()) {
                            Text("Server access controls")
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
                FilledTonalButton(
                    onClick = onCustomizeBottomNavigation,
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                ) {
                    Text(stringResource(R.string.navigation_customize_action))
                }
            }
        }
        item {
            SettingsSection("Collection display") {
                SwitchRow("Show pricing", "Display estimated card and binder values", state.preferences.showPricing, viewModel::setShowPricing)
                SwitchRow(
                    "Show card numbers",
                    "Include collector numbers beside card set names",
                    state.preferences.showCardNumbers,
                    viewModel::setShowCardNumbers,
                )
                Text("Currency", fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("USD", "CAD", "EUR", "GBP").forEach { currency ->
                        AssistChip(onClick = { viewModel.setCurrency(currency) }, label = {
                            Text(if (state.preferences.currency == currency) "✓ $currency" else currency)
                        })
                    }
                }
                FilledTonalButton(onClick = onPricingSources, modifier = Modifier.fillMaxWidth()) {
                    Text("Pricing sources")
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
                Text("Default game", fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 12.dp))
                Text(
                    "Used when Search and Scanner first open.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                LazyRow(
                    modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    item {
                        FilterChip(
                            selected = state.preferences.defaultGame == null,
                            onClick = { viewModel.setDefaultGame(null) },
                            label = { Text("None") },
                        )
                    }
                    items(games.filter(state.preferences.enabledGames::contains)) { game ->
                        FilterChip(
                            selected = state.preferences.defaultGame == game,
                            onClick = { viewModel.setDefaultGame(game) },
                            label = { Text(game.displayGame()) },
                        )
                    }
                }
            }
        }
        item {
            SettingsSection("Security") {
                SwitchRow(
                    "Require device unlock",
                    if (biometricAvailable) "Lock TCGer when it leaves the foreground"
                    else "Set up biometrics or a device screen lock to enable this option",
                    state.preferences.biometricLockEnabled,
                ) { if (biometricAvailable) viewModel.setBiometricLockEnabled(it) }
            }
        }
        item {
            SettingsSection("Offline scanner models") {
                SwitchRow(
                    "Use OCR for difficult scans",
                    "Read card titles and collector numbers only when visual matching is uncertain",
                    scannerOptions.ocrEnabled,
                ) { enabled ->
                    scannerOptions = scannerOptions.copy(ocrEnabled = enabled)
                    scannerOptionsStore.save(scannerOptions)
                }
                androidx.compose.material3.HorizontalDivider(Modifier.padding(vertical = 10.dp))
                state.scannerSupportedGames.forEachIndexed { index, game ->
                    if (index > 0) {
                        androidx.compose.material3.HorizontalDivider(Modifier.padding(vertical = 10.dp))
                    }
                    Text("${game.displayGame()} ArcFace", fontWeight = FontWeight.Medium)
                    when (val status = state.scannerAssets[game] ?: ScannerAssetInstallStatus.NotInstalled) {
                        ScannerAssetInstallStatus.NotInstalled -> {
                            Text(
                                "Download this game's model and card index for offline scanning.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            FilledTonalButton(
                                onClick = { viewModel.installScannerAssets(game) },
                                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                            ) { Text("Install") }
                        }
                        is ScannerAssetInstallStatus.Installing -> {
                            LinearProgressIndicator(
                                progress = { status.progress },
                                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                            )
                            Text(
                                "${formatAssetBytes(status.completedBytes)} of ${formatAssetBytes(status.totalBytes)}",
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.padding(top = 4.dp),
                            )
                        }
                        is ScannerAssetInstallStatus.Installed -> {
                            val updateAvailable = state.scannerAssetManifests[game]?.version
                                ?.let { it != status.manifest.version } == true
                            Text(
                                if (updateAvailable) {
                                    "Installed · update available · ${status.manifest.displayedCardCount} cards"
                                } else {
                                    "Installed · ${status.manifest.displayedCardCount} cards · ${formatAssetBytes(status.manifest.downloadBytes)}"
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Row(
                                Modifier.fillMaxWidth().padding(top = 6.dp),
                                horizontalArrangement = Arrangement.End,
                            ) {
                                TextButton(onClick = { viewModel.removeScannerAssets(game) }) { Text("Remove") }
                                TextButton(onClick = {
                                    if (updateAvailable) viewModel.installScannerAssets(game)
                                    else viewModel.refreshScannerAssets(game)
                                }) {
                                    Text(if (updateAvailable) "Update" else "Check for update")
                                }
                            }
                        }
                        is ScannerAssetInstallStatus.Failed -> {
                            Text(
                                if (status.installedManifest == null) status.message
                                else "The installed version remains active. Update failed: ${status.message}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error,
                            )
                            Row(
                                Modifier.fillMaxWidth().padding(top = 6.dp),
                                horizontalArrangement = Arrangement.End,
                            ) {
                                if (status.installedManifest != null) {
                                    TextButton(onClick = { viewModel.removeScannerAssets(game) }) { Text("Remove") }
                                }
                                FilledTonalButton(onClick = { viewModel.installScannerAssets(game) }) { Text("Retry") }
                            }
                        }
                    }
                }
            }
        }
        item {
            CommunityGamePackagesSection(
                state.gamePackages,
                viewModel,
                onOpenStore = onGameStore,
                onInstallFromUrl = onInstallGameFromUrl,
            )
        }
        item {
            SettingsSection("Data & storage") {
                FilledTonalButton(onClick = viewModel::refresh, modifier = Modifier.fillMaxWidth()) {
                    Text(if (state.preferences.dataSourceMode == DataSourceMode.SERVER) "Sync with server now" else "Refresh on-device data")
                }
                Text(
                    "Offline cache · ${formatStorageBytes(cacheBytes)}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                FilledTonalButton(
                    onClick = {
                        transferMessage = if (cacheManager.clear()) "Offline cache cleared." else "Some cached files could not be removed."
                        cacheBytes = cacheManager.sizeBytes()
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Clear offline cache") }
                FilledTonalButton(
                    onClick = {
                        pendingExport = CollectionBackupJson.encode(
                            CollectionBackupJson.create(state.binders, state.wishlists, state.sealedInventory),
                        )
                        exportDocument.launch("tcger-backup.json")
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Export complete JSON backup") }
                FilledTonalButton(
                    onClick = {
                        pendingExport = CollectionBackupJson.collectionCsv(state.binders)
                        exportDocument.launch("tcger-collection.csv")
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Export collection CSV") }
                FilledTonalButton(
                    onClick = { importBackup.launch(arrayOf("application/json", "text/json", "text/plain")) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Import JSON backup") }
                FilledTonalButton(onClick = onFinanceHistory, modifier = Modifier.fillMaxWidth()) {
                    Text("Purchase, sale & trade history")
                }
                FilledTonalButton(
                    onClick = { showingLibraryOperations = true },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Library operations") }
                Text(
                    "Imports merge into the current data. Existing records are not erased.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                transferMessage?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                }
            }
        }
        item {
            Text(
                "Android parity build · Collection, catalog, scanner, sealed, social, and analytics",
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

private fun formatStorageBytes(bytes: Long): String = when {
    bytes >= 1_048_576 -> "%.1f MB".format(bytes / 1_048_576.0)
    bytes >= 1_024 -> "%.1f KB".format(bytes / 1_024.0)
    else -> "$bytes B"
}

private fun formatAssetBytes(bytes: Long): String = when {
    bytes <= 0L -> "preparing…"
    bytes < 1_000_000L -> "${bytes / 1_000} KB"
    else -> String.format("%.1f MB", bytes / 1_000_000.0)
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
