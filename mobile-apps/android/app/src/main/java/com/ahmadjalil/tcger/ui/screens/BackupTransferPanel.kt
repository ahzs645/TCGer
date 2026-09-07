package com.ahmadjalil.tcger.ui.screens

import android.app.Application
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ahmadjalil.tcger.data.backup.*
import com.ahmadjalil.tcger.domain.DataSourceMode
import com.ahmadjalil.tcger.ui.AppUiState
import com.ahmadjalil.tcger.ui.AppViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

/** Only opaque file IDs go in saved instance state; large private payloads stay off Bundle. */
class BackupTransferViewModel(application: Application, private val saved: SavedStateHandle) : AndroidViewModel(application) {
    private val directory = File(application.noBackupFilesDir, "document-transfers").apply { mkdirs() }
    var busy by mutableStateOf(false); private set
    var notice by mutableStateOf<String?>(null); private set
    var review by mutableStateOf<String?>(null); private set
    private fun file(key: String): File? = saved.get<String>(key)?.let { File(directory, it) }
    private fun discard(key: String) { file(key)?.delete(); saved.remove<String>(key) }
    init { file("import")?.takeIf { it.exists() }?.let { launch { review = withContext(Dispatchers.IO) { summary(it.readText()) } } } }
    private fun launch(action: suspend () -> Unit) = viewModelScope.launch {
        busy = true; notice = null
        try { action() } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error; notice = error.message ?: "Transfer failed. Please try again." }
        finally { busy = false }
    }
    private fun summary(raw: String): String {
        val backup = if (raw.trimStart().startsWith("{")) CollectionBackupJson.decode(raw) else parseCollectionCsv(raw)
        return "${backup.binders.size} binders · ${backup.binders.sumOf { it.cards.sumOf { copy -> copy.quantity } }} copies\n${backup.wishlists.size} wishlists · ${backup.sealedInventory.sumOf { it.quantity }} sealed products"
    }
    fun prepareExport(produce: suspend () -> String, ready: () -> Unit) = launch {
        val raw = produce()
        require(raw.isNotBlank()) { "The backup is empty; nothing was exported." }
        discard("export")
        val name = UUID.randomUUID().toString()
        withContext(Dispatchers.IO) { File(directory, name).writeText(raw) }
        saved["export"] = name
        ready()
    }
    fun write(uri: Uri?) = launch {
        if (uri == null) { discard("export"); return@launch }
        withContext(Dispatchers.IO) {
            val source = requireNotNull(file("export")?.takeIf { it.length() > 0 }) { "The prepared export is no longer available. Export again." }
            getApplication<Application>().contentResolver.openOutputStream(uri, "wt")?.use { output -> source.inputStream().use { it.copyTo(output) } }
                ?: error("Could not open the selected file")
            discard("export")
        }
        notice = "Export saved."
    }
    fun read(uri: Uri?, destination: String) = launch {
        if (uri == null) return@launch
        discard("import")
        val name = UUID.randomUUID().toString()
        val description = withContext(Dispatchers.IO) {
            val raw = getApplication<Application>().contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                ?: error("Could not read the selected file")
            val description = summary(raw)
            File(directory, name).writeText(raw)
            description
        }
        saved["import"] = name
        saved["destination"] = destination
        review = description
    }
    fun cancelImport() { discard("import"); review = null }
    fun apply(destination: String, import: suspend (String) -> Unit, done: () -> Unit) = launch {
        require(saved.get<String>("destination") == destination) { "The destination changed. Choose the file again before importing." }
        val raw = withContext(Dispatchers.IO) { requireNotNull(file("import")).readText() }
        import(raw)
        cancelImport(); notice = "Import complete. A recovery point was saved."; done()
    }
}

@Composable
fun BackupTransferPanel(state: AppUiState, app: AppViewModel, restoreOnly: Boolean = false, onImported: () -> Unit = {}) {
    val transfer: BackupTransferViewModel = viewModel(key = "backup-transfer")
    val destination = if (state.preferences.dataSourceMode == DataSourceMode.ON_DEVICE) "this device" else state.preferences.serverUrl + " / " + state.preferences.userId.orEmpty()
    val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json"), transfer::write)
    val csv = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv"), transfer::write)
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { transfer.read(it, destination) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (!restoreOnly) {
            OutlinedButton(enabled = !transfer.busy, modifier = Modifier.fillMaxWidth(), onClick = {
                transfer.prepareExport(app::exportPortableBackup) { export.launch("tcger-backup.json") }
            }) { Text("Export backup") }
            TextButton(enabled = !transfer.busy, onClick = {
                transfer.prepareExport({ CollectionBackupJson.collectionCsv(state.binders) }) { csv.launch("tcger-collection.csv") }
            }) { Text("Export collection CSV") }
        }
        FilledTonalButton(enabled = !transfer.busy, modifier = Modifier.fillMaxWidth(), onClick = {
            picker.launch(arrayOf("application/json", "text/json", "text/plain", "text/csv", "application/octet-stream"))
        }) { Text(if (restoreOnly) "Restore from backup" else "Import backup or CSV") }
        if (transfer.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        transfer.notice?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
    transfer.review?.let { summary -> AlertDialog(
        onDismissRequest = { if (!transfer.busy) transfer.cancelImport() },
        title = { Text("Review import") },
        text = { Text("$summary\n\nDestination: $destination\n\nMatching records will be updated by ID. Other records will be kept. A recovery point is saved before import.") },
        confirmButton = { TextButton(enabled = !transfer.busy, onClick = { transfer.apply(destination, app::importReviewedBackup, onImported) }) { Text("Import") } },
        dismissButton = { TextButton(enabled = !transfer.busy, onClick = transfer::cancelImport) { Text("Cancel") } },
    ) }
}
