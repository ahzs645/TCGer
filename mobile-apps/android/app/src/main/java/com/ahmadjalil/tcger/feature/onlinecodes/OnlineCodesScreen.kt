package com.ahmadjalil.tcger.feature.onlinecodes

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.PersistableBundle
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

@Composable
fun OnlineCodesScreen(
    repository: OnlineCodeRepository,
    enabledGames: List<String>,
    contentPadding: PaddingValues = PaddingValues(),
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val holder = remember(repository) { OnlineCodeStateHolder(repository, scope) }
    val state by holder.state.collectAsStateWithLifecycle()
    var query by remember { mutableStateOf("") }
    var game by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<OnlineCodeStatus?>(null) }
    var adding by remember { mutableStateOf(false) }
    var addInitialRaw by remember { mutableStateOf("") }
    var addSource by remember { mutableStateOf(OnlineCodeSource.MANUAL) }
    var scanMessage by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<OnlineCode?>(null) }
    var deleting by remember { mutableStateOf<OnlineCode?>(null) }
    val scanCode = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
        if (bitmap == null) return@rememberLauncherForActivityResult
        scanMessage = "Reading code…"
        val image = InputImage.fromBitmap(bitmap, 0)
        val barcodeClient = BarcodeScanning.getClient()
        barcodeClient.process(image)
            .addOnSuccessListener { barcodes ->
                val values = barcodes.mapNotNull { it.rawValue?.trim()?.takeIf(String::isNotBlank) }.distinct()
                barcodeClient.close()
                if (values.isNotEmpty()) {
                    addInitialRaw = values.joinToString("\n")
                    addSource = OnlineCodeSource.CAMERA
                    scanMessage = null
                    adding = true
                } else {
                    val textClient = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
                    textClient.process(image)
                        .addOnSuccessListener { result ->
                            val valuesFromText = scannedOnlineCodes(result.text)
                            scanMessage = if (valuesFromText.isEmpty()) {
                                "No printed or QR redemption code was readable. Try filling the camera frame."
                            } else null
                            if (valuesFromText.isNotEmpty()) {
                                addInitialRaw = valuesFromText.joinToString("\n")
                                addSource = OnlineCodeSource.CAMERA
                                adding = true
                            }
                            textClient.close()
                        }
                        .addOnFailureListener {
                            scanMessage = it.message ?: "The printed code could not be read."
                            textClient.close()
                        }
                }
            }
            .addOnFailureListener {
                scanMessage = it.message ?: "The QR code could not be read."
                barcodeClient.close()
            }
    }

    LaunchedEffect(holder) { holder.load() }
    val filtered = remember(state.codes, query, game, status) {
        val needle = query.trim()
        state.codes.filter { code ->
            (game == null || code.tcg.equals(game, true)) &&
                (status == null || code.status == status) &&
                (needle.isBlank() || listOfNotNull(code.code, code.productName, code.notes, code.tcg)
                    .any { it.contains(needle, ignoreCase = true) })
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp, end = 16.dp,
            top = contentPadding.calculateTopPadding() + 18.dp,
            bottom = contentPadding.calculateBottomPadding() + 28.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Code Vault", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    Text("Redemption codes stay hidden until you reveal or copy them", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(holder::load) { Icon(Icons.Default.Refresh, "Refresh codes") }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    addInitialRaw = ""
                    addSource = OnlineCodeSource.MANUAL
                    adding = true
                }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.Add, null); Spacer(Modifier.size(6.dp)); Text("Add codes")
                }
                Button(onClick = { scanCode.launch(null) }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.PhotoCamera, null); Spacer(Modifier.size(6.dp)); Text("Scan")
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CodeStat("Unused", state.codes.count { it.status == OnlineCodeStatus.UNUSED }, Modifier.weight(1f))
                CodeStat("Used", state.codes.count { it.status == OnlineCodeStatus.REDEEMED }, Modifier.weight(1f))
            }
        }
        item {
            OutlinedTextField(
                value = query, onValueChange = { query = it }, modifier = Modifier.fillMaxWidth(),
                label = { Text("Search codes, products, or notes") }, singleLine = true,
            )
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    item { FilterChip(game == null, { game = null }, { Text("All games") }) }
                    items(enabledGames.distinct(), key = { it }) { value ->
                        FilterChip(game == value, { game = value }, { Text(value.replaceFirstChar(Char::uppercase)) })
                    }
                }
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    item { FilterChip(status == null, { status = null }, { Text("All statuses") }) }
                    items(OnlineCodeStatus.entries, key = { it.name }) { value ->
                        FilterChip(status == value, { status = value }, { Text(value.title) })
                    }
                }
            }
        }
        state.message?.let { item { Text(it, color = MaterialTheme.colorScheme.primary) } }
        scanMessage?.let { item { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
        state.error?.let {
            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text("Code vault unavailable", fontWeight = FontWeight.Bold)
                        Text(it, color = MaterialTheme.colorScheme.error)
                        TextButton(holder::load) { Text("Retry") }
                    }
                }
            }
        }
        if (state.loading && state.codes.isEmpty()) {
            item { Row(Modifier.fillMaxWidth().padding(32.dp), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator() } }
        } else if (filtered.isEmpty() && state.error == null) {
            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(22.dp)) {
                        Text("No matching codes", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text("Scan a printed or QR redemption card, add codes manually, or adjust the filters.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        items(filtered, key = OnlineCode::id) { code ->
            OnlineCodeCard(code, onUpdate = { holder.update(code.id, it) }, onEdit = { editing = code }, onDelete = { deleting = code })
        }
    }

    if (adding) {
        AddOnlineCodesDialog(
            games = enabledGames.ifEmpty { listOf("pokemon") },
            initialRaw = addInitialRaw,
            source = addSource,
            saving = state.saving,
            onDismiss = { adding = false; addInitialRaw = "" },
            onSave = { input -> holder.create(input) { adding = false } },
        )
    }
    editing?.let { code ->
        EditOnlineCodeDialog(code, state.saving, onDismiss = { editing = null }) { input ->
            holder.update(code.id, input)
            editing = null
        }
    }
    deleting?.let { code ->
        AlertDialog(
            onDismissRequest = { deleting = null }, title = { Text("Delete code?") },
            text = { Text("This permanently removes the code ending in ${code.code.takeLast(4)}.") },
            confirmButton = { TextButton(onClick = { holder.delete(code.id); deleting = null }) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun CodeStat(label: String, count: Int, modifier: Modifier) {
    Card(modifier) { Column(Modifier.padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(count.toString(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(label, style = MaterialTheme.typography.labelSmall)
    } }
}

@Composable
private fun OnlineCodeCard(
    code: OnlineCode,
    onUpdate: (UpdateOnlineCodeInput) -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    var revealed by remember(code.id) { mutableStateOf(false) }
    val context = LocalContext.current
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (revealed) code.code else maskedOnlineCode(code.code),
                    modifier = Modifier.weight(1f), fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                IconButton(onClick = { revealed = !revealed }) {
                    Icon(if (revealed) Icons.Default.VisibilityOff else Icons.Default.Visibility, if (revealed) "Hide code" else "Reveal code")
                }
                IconButton(onClick = { copySensitive(context, code.code) }) { Icon(Icons.Default.ContentCopy, "Copy code") }
                IconButton(onClick = { shareSensitive(context, code.code) }) { Icon(Icons.Default.Share, "Share code") }
            }
            Text("${code.tcg.replaceFirstChar(Char::uppercase)} · ${code.status.title}", color = MaterialTheme.colorScheme.primary)
            code.productName?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            code.notes?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                OnlineCodeStatus.entries.forEach { next ->
                    FilterChip(
                        selected = code.status == next,
                        onClick = { if (code.status != next) onUpdate(UpdateOnlineCodeInput(status = next)) },
                        label = { Text(next.title) },
                    )
                }
                Spacer(Modifier.weight(1f))
                IconButton(onEdit) { Icon(Icons.Default.Edit, "Edit code") }
                IconButton(onDelete) { Icon(Icons.Default.Delete, "Delete code") }
            }
        }
    }
}

@Composable
private fun AddOnlineCodesDialog(
    games: List<String>,
    initialRaw: String,
    source: OnlineCodeSource,
    saving: Boolean,
    onDismiss: () -> Unit,
    onSave: (CreateOnlineCodeBatch) -> Unit,
) {
    var raw by remember(initialRaw) { mutableStateOf(initialRaw) }
    var game by remember(games) { mutableStateOf(games.first()) }
    var product by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    val parsed = remember(raw) { parseOnlineCodes(raw) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (source == OnlineCodeSource.CAMERA) "Review scanned codes" else "Add codes manually") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(games.distinct()) { value -> FilterChip(game == value, { game = value }, { Text(value.replaceFirstChar(Char::uppercase)) }) }
                }
                OutlinedTextField(raw, { raw = it }, label = { Text("Codes (line, comma, or semicolon separated)") }, minLines = 3)
                Text("${parsed.size} unique code${if (parsed.size == 1) "" else "s"}", style = MaterialTheme.typography.labelMedium)
                OutlinedTextField(product, { product = it }, label = { Text("Product (optional)") }, singleLine = true)
                OutlinedTextField(notes, { notes = it }, label = { Text("Notes (optional)") }, minLines = 2)
            }
        },
        confirmButton = {
            TextButton(
                enabled = parsed.isNotEmpty() && !saving,
                onClick = { onSave(CreateOnlineCodeBatch(game, parsed.map(::OnlineCodeInput), source, product.trim().ifBlank { null }, notes.trim().ifBlank { null })) },
            ) { Text("Save") }
        },
        dismissButton = { TextButton(onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun EditOnlineCodeDialog(
    code: OnlineCode,
    saving: Boolean,
    onDismiss: () -> Unit,
    onSave: (UpdateOnlineCodeInput) -> Unit,
) {
    var product by remember(code.id) { mutableStateOf(code.productName.orEmpty()) }
    var notes by remember(code.id) { mutableStateOf(code.notes.orEmpty()) }
    var status by remember(code.id) { mutableStateOf(code.status) }
    AlertDialog(
        onDismissRequest = onDismiss, title = { Text("Edit code") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(maskedOnlineCode(code.code), fontFamily = FontFamily.Monospace)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(OnlineCodeStatus.entries) { value -> FilterChip(status == value, { status = value }, { Text(value.title) }) }
            }
            OutlinedTextField(product, { product = it }, label = { Text("Product") }, singleLine = true)
            OutlinedTextField(notes, { notes = it }, label = { Text("Notes") }, minLines = 2)
        } },
        confirmButton = { TextButton(enabled = !saving, onClick = { onSave(UpdateOnlineCodeInput(status, product.trim().ifBlank { null }, notes.trim().ifBlank { null }, productNameSpecified = true, notesSpecified = true)) }) { Text("Save") } },
        dismissButton = { TextButton(onDismiss) { Text("Cancel") } },
    )
}

private fun copySensitive(context: Context, value: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    val clip = ClipData.newPlainText("Redemption code", value)
    clip.description.extras = PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) }
    clipboard.setPrimaryClip(clip)
    Toast.makeText(context, "Code copied", Toast.LENGTH_SHORT).show()
}

internal fun scannedOnlineCodes(raw: String): List<String> = Regex("[A-Za-z0-9][A-Za-z0-9-]{5,}")
    .findAll(raw)
    .map { it.value.trim() }
    .filter { token -> token.any(Char::isDigit) }
    .distinctBy(String::uppercase)
    .toList()

private fun shareSensitive(context: Context, value: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, value)
    }
    context.startActivity(Intent.createChooser(intent, "Share redemption code"))
}
