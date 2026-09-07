@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.ahmadjalil.tcger.domain.*
import com.ahmadjalil.tcger.data.gamepackage.gamePresentation
import com.ahmadjalil.tcger.feature.settingsparity.CreateFinanceTransaction
import com.ahmadjalil.tcger.feature.settingsparity.TransactionType
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.time.Instant
import java.time.ZoneOffset

val copyConditions = listOf("" to "Not specified", "GM" to "Gem mint", "M" to "Mint", "NM" to "Near mint", "EX" to "Excellent", "VG" to "Very good", "GD" to "Good", "LP" to "Lightly played", "MP" to "Moderately played", "HP" to "Heavily played", "DMG" to "Damaged")

@Composable
fun ChoiceField(label: String, value: String, choices: List<Pair<String, String>>, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val options = if (choices.any { it.first == value }) choices else listOf(value to value) + choices
    Box(Modifier.fillMaxWidth()) {
        OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.weight(1f)) { Text(label, style = MaterialTheme.typography.labelSmall); Text(options.firstOrNull { it.first == value }?.second ?: value) }
            Text("▾")
        }
        DropdownMenu(expanded, { expanded = false }, modifier = Modifier.heightIn(max = 360.dp)) {
            options.forEach { (key, title) -> DropdownMenuItem(text = { Text(title) }, onClick = { onSelect(key); expanded = false }) }
        }
    }
}

@Composable
private fun CopyToggle(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().toggleable(checked, role = Role.Checkbox, onValueChange = onChange).padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked, null); Text(label, Modifier.padding(start = 8.dp))
    }
}

@Composable
private fun AmountField(label: String, value: String, onChange: (String) -> Unit) {
    OutlinedTextField(value, onChange, modifier = Modifier.fillMaxWidth(), label = { Text(label) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
}

@Composable
fun CollectionCopyEditor(owned: OwnedCard, binders: List<Binder>, local: Boolean, onDismiss: () -> Unit,
    onSave: suspend (CollectionEdit, String, Int) -> Unit, onSell: suspend (CreateFinanceTransaction, Boolean) -> Unit) {
    val editSaver = Saver<CollectionEdit, String>(save = { Json.encodeToString(it) }, restore = { Json.decodeFromString<CollectionEdit>(it) })
    var draft by rememberSaveable(owned.id, stateSaver = editSaver) { mutableStateOf(owned.edit()) }
    var destination by rememberSaveable(owned.id) { mutableStateOf(owned.binderId) }
    var price by rememberSaveable(owned.id) { mutableStateOf(owned.price?.toString().orEmpty()) }
    var cost by rememberSaveable(owned.id) { mutableStateOf(owned.acquisitionPrice?.toString().orEmpty()) }
    var copies by rememberSaveable(owned.id) { mutableStateOf("0") }
    var advanced by rememberSaveable { mutableStateOf(false) }
    var selling by rememberSaveable { mutableStateOf(false) }
    var newTag by rememberSaveable { mutableStateOf("") }
    var datePicker by rememberSaveable { mutableStateOf(false) }
    var discard by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val dirty = draft != owned.edit() || destination != owned.binderId || price != owned.price?.toString().orEmpty() || cost != owned.acquisitionPrice?.toString().orEmpty() || copies != "0"
    fun close() { if (!busy) { if (dirty) discard = true else onDismiss() } }
    Dialog(onDismissRequest = ::close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Surface(Modifier.fillMaxSize().testTag("collection.copy.editor")) {
            Column(Modifier.safeDrawingPadding().imePadding().padding(horizontal = 20.dp).widthIn(max = 640.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(enabled = !busy, onClick = ::close) { Text("Cancel") }
                    Text("Edit copy", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                    TextButton(enabled = !busy, onClick = { scope.launch {
                        busy = true; error = null
                        runCatching {
                            fun amount(text: String): Double? = if (text.isBlank()) null else requireNotNull(text.toDoubleOrNull()) { "Enter a valid price" }
                            val updated = draft.copy(price = amount(price), acquisitionPrice = amount(cost)); updated.validate()
                            val extra = requireNotNull(copies.toIntOrNull()) { "Enter a whole number of additional copies" }
                            require(extra in 0..1000) { "Use between 0 and 1,000 additional copies" }
                            onSave(updated, destination, extra)
                        }.onSuccess { onDismiss() }.onFailure { error = it.message }
                        busy = false
                    } }) { Text(if (busy) "Saving…" else "Save copy") }
                }
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(owned.card.name, style = MaterialTheme.typography.headlineSmall)
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    ChoiceField("Condition", draft.condition.orEmpty(), copyConditions) { draft = draft.copy(condition = it.ifBlank { null }) }
                    ChoiceField("Language", draft.details.language.orEmpty(), listOf("" to "Not specified") + listOf("English", "Japanese", "French", "German", "Italian", "Spanish", "Portuguese", "Korean", "Chinese").map { it to it }) { draft = draft.copy(details = draft.details.copy(language = it.ifBlank { null })) }
                    AmountField("Purchase cost (USD)", cost) { cost = it }
                    if (local) AmountField("Market value (USD)", price) { price = it }
                    ChoiceField("Binder", destination, binders.map { it.id to it.name }) { destination = it }
                    OutlinedTextField(draft.details.notes.orEmpty(), { draft = draft.copy(details = draft.details.copy(notes = it.ifBlank { null })) }, Modifier.fillMaxWidth(), label = { Text("Notes") })
                    Text("Tags", style = MaterialTheme.typography.titleMedium)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        draft.details.tags.forEach { tag -> InputChip(selected = true, onClick = { draft = draft.copy(details = draft.details.copy(tags = draft.details.tags - tag)) }, label = { Text("${tag.label} ×") }) }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(newTag, { newTag = it }, Modifier.weight(1f), label = { Text("New tag") }, singleLine = true)
                        TextButton(enabled = newTag.isNotBlank(), onClick = { val label = newTag.trim(); if (draft.details.tags.none { it.label.equals(label, true) }) draft = draft.copy(details = draft.details.copy(tags = draft.details.tags + CollectionTag(label = label))); newTag = "" }) { Text("Add") }
                    }
                    CopyToggle("Foil", draft.details.isFoil) { draft = draft.copy(details = draft.details.copy(isFoil = it)) }
                    TextButton(onClick = { advanced = !advanced }) { Text(if (advanced) "Hide additional details" else "Grading, dates & additional details") }
                    if (advanced) {
                        OutlinedButton(onClick = { datePicker = true }) { Text("Acquired: ${draft.details.acquiredAt?.take(10) ?: "Choose date"}") }
                        if (draft.details.acquiredAt != null) TextButton(onClick = { draft = draft.copy(details = draft.details.copy(acquiredAt = null)) }) { Text("Clear acquired date") }
                        OutlinedTextField(draft.details.storageLocation.orEmpty(), { draft = draft.copy(details = draft.details.copy(storageLocation = it.ifBlank { null })) }, Modifier.fillMaxWidth(), label = { Text("Storage location") })
                        ChoiceField("Grading company", draft.details.gradingCompany.orEmpty(), listOf("" to "Not graded") + listOf("PSA", "BGS", "CGC", "SGC", "ACE").map { it to it }) { draft = draft.copy(details = draft.details.copy(gradingCompany = it.ifBlank { null })) }
                        AmountField("Grade", draft.details.gradingScore.orEmpty()) { draft = draft.copy(details = draft.details.copy(gradingScore = it.ifBlank { null })) }
                        OutlinedTextField(draft.details.certNumber.orEmpty(), { draft = draft.copy(details = draft.details.copy(certNumber = it.ifBlank { null })) }, Modifier.fillMaxWidth(), label = { Text("Certification number") })
                        OutlinedTextField(draft.details.serialNumber.orEmpty(), { draft = draft.copy(details = draft.details.copy(serialNumber = it.ifBlank { null })) }, Modifier.fillMaxWidth(), label = { Text("Serial number") })
                        val finishes = owned.card.gamePresentation()?.printings?.finishes
                        val finishChoices = finishes?.map { it.code to it.label } ?: listOf("normal" to "Regular", "holo" to "Holo", "reverse_holo" to "Reverse holo", "etched" to "Etched")
                        ChoiceField("Finish", draft.details.finishCode.orEmpty(), listOf("" to "Not specified") + finishChoices) { value ->
                            val finish = finishes?.find { it.code == value }
                            draft = draft.copy(details = draft.details.copy(finishCode = value.ifBlank { null }, finishLabel = finish?.label ?: value.replace('_', ' ').ifBlank { null }, isFoil = finish?.foil ?: draft.details.isFoil))
                        }
                        OutlinedTextField(draft.details.edition.orEmpty(), { draft = draft.copy(details = draft.details.copy(edition = it.ifBlank { null })) }, Modifier.fillMaxWidth(), label = { Text("Edition") })
                        OutlinedTextField(draft.details.stamp.orEmpty(), { draft = draft.copy(details = draft.details.copy(stamp = it.ifBlank { null })) }, Modifier.fillMaxWidth(), label = { Text("Stamp") })
                        CopyToggle("Signed", draft.details.isSigned) { draft = draft.copy(details = draft.details.copy(isSigned = it)) }
                        CopyToggle("Altered", draft.details.isAltered) { draft = draft.copy(details = draft.details.copy(isAltered = it)) }
                        CopyToggle("Sealed promo", draft.details.isSealedPromo) { draft = draft.copy(details = draft.details.copy(isSealedPromo = it)) }
                        CopyToggle("Oversized", draft.details.isOversized) { draft = draft.copy(details = draft.details.copy(isOversized = it)) }
                        CopyToggle("Peel-off", draft.details.isPeelOff) { draft = draft.copy(details = draft.details.copy(isPeelOff = it)) }
                        OutlinedTextField(copies, { copies = it }, Modifier.fillMaxWidth(), label = { Text("Additional identical copies") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                    }
                    HorizontalDivider()
                    OutlinedButton(enabled = !busy && !dirty, onClick = { selling = true }) { Text("Record a sale") }
                    if (dirty) Text("Save your edits before recording a sale.", style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(16.dp))
                }
            }
        }
    }
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text("Discard unsaved changes?") }, confirmButton = { TextButton(onClick = onDismiss) { Text("Discard") } }, dismissButton = { TextButton(onClick = { discard = false }) { Text("Keep editing") } })
    if (datePicker) {
        val date = rememberDatePickerState(initialSelectedDateMillis = runCatching { java.time.LocalDate.parse(draft.details.acquiredAt?.take(10)).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }.getOrNull())
        DatePickerDialog(onDismissRequest = { datePicker = false }, confirmButton = { TextButton(onClick = { date.selectedDateMillis?.let { draft = draft.copy(details = draft.details.copy(acquiredAt = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString())) }; datePicker = false }) { Text("Set date") } }) { DatePicker(date) }
    }
    if (selling) CollectionSaleDialog(owned, { selling = false }) { input, remove -> onSell(input, remove); onDismiss() }
}

@Composable
private fun CollectionSaleDialog(owned: OwnedCard, onDismiss: () -> Unit, onSell: suspend (CreateFinanceTransaction, Boolean) -> Unit) {
    var sale by rememberSaveable { mutableStateOf("") }
    var currency by rememberSaveable { mutableStateOf("USD") }
    var cost by rememberSaveable { mutableStateOf(owned.acquisitionPrice?.toString().orEmpty()) }
    var fees by rememberSaveable { mutableStateOf("") }
    var shipping by rememberSaveable { mutableStateOf("") }
    var platform by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }
    var remove by rememberSaveable { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { Text("Record sale") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(owned.card.name)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            ChoiceField("Currency", currency, java.util.Currency.getAvailableCurrencies().map { it.currencyCode }.sorted().map { it to it }) { currency = it; cost = "" }
            AmountField("Sale proceeds ($currency)", sale) { sale = it }
            AmountField("Cost basis ($currency)", cost) { cost = it }
            AmountField("Fees ($currency)", fees) { fees = it }
            AmountField("Shipping ($currency)", shipping) { shipping = it }
            OutlinedTextField(platform, { platform = it }, label = { Text("Platform") })
            OutlinedTextField(notes, { notes = it }, label = { Text("Notes") })
            CopyToggle("Remove sold copy from binder", remove) { remove = it }
        }
    }, confirmButton = { TextButton(enabled = !busy && sale.toDoubleOrNull()?.let { it > 0 && it.isFinite() } == true, onClick = { scope.launch {
        busy = true
        runCatching {
            fun amount(value: String) = if (value.isBlank()) null else requireNotNull(value.toDoubleOrNull()) { "Enter a valid amount" }
            val input = CreateFinanceTransaction(type = TransactionType.SALE, collectionEntryId = owned.id, externalId = owned.card.id, cardName = owned.card.name, tcg = owned.card.tcg, quantity = 1, amount = sale.toDouble(), currency = currency, fees = amount(fees), shippingCost = amount(shipping), platform = platform.ifBlank { null }, notes = notes.ifBlank { null }, costBasis = amount(cost), acquiredAt = owned.details.acquiredAt)
            require(input.isValid) { "Check the amounts and currency" }; onSell(input, remove)
        }.onFailure { error = it.message }; busy = false
    } }) { Text(if (busy) "Saving…" else "Record sale") } }, dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Cancel") } })
}
@Composable
fun CollectionBulkEditor(selected: List<OwnedCard>, binders: List<Binder>, onDismiss: () -> Unit,
    onApply: suspend (String?, String?, Boolean) -> Unit) {
    var condition by remember { mutableStateOf("") }
    var destination by remember { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { Text("${selected.size} selected copies") },
        text = { Column(Modifier.verticalScroll(rememberScrollState())) {
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            OutlinedTextField(condition, { condition = it }, label = { Text("Set condition (leave blank to keep)") })
            Text("Move to binder (optional)")
            Row { RadioButton(destination == null, { destination = null }); Text("Keep current binder") }
            binders.forEach { binder -> Row { RadioButton(destination == binder.id, { destination = binder.id }); Text(binder.name) } }
            Row { Checkbox(deleting, { deleting = it }); Text("Delete selected copies") }
        } },
        confirmButton = { TextButton(enabled = !busy, onClick = {
            scope.launch {
                busy = true
                runCatching { onApply(condition.ifBlank { null }, destination, deleting) }.onSuccess { onDismiss() }.onFailure { error = it.message }
                busy = false
            }
        }) { Text(if (deleting) "Delete ${selected.size} copies" else "Apply") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Cancel") } })
}
