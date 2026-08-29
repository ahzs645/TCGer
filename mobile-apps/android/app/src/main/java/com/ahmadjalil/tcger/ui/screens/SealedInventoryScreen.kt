package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.ahmadjalil.tcger.domain.SealedInventoryItem
import com.ahmadjalil.tcger.domain.SealedOpeningLedger
import com.ahmadjalil.tcger.domain.SealedProduct
import com.ahmadjalil.tcger.ui.AppUiState
import com.ahmadjalil.tcger.ui.AppViewModel
import java.text.NumberFormat

private enum class SealedSection { INVENTORY, HISTORY }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SealedInventoryScreen(
    state: AppUiState,
    contentPadding: PaddingValues,
    viewModel: AppViewModel,
    onOpenPacks: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var section by remember { mutableStateOf(SealedSection.INVENTORY) }
    var showingCatalog by remember { mutableStateOf(false) }
    var showingBarcode by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<SealedInventoryItem?>(null) }
    var opening by remember { mutableStateOf<SealedInventoryItem?>(null) }
    var deleting by remember { mutableStateOf<SealedInventoryItem?>(null) }

    LaunchedEffect(Unit) { viewModel.loadSealedData() }

    val inventory = state.sealedInventory.filter { item ->
        query.isBlank() || listOfNotNull(
            item.product.name,
            item.product.tcg,
            item.product.setCode,
            item.product.upc,
        ).any { it.contains(query.trim(), ignoreCase = true) }
    }
    val ledgers = state.sealedOpeningLedgers.filter {
        query.isBlank() || it.productName.contains(query.trim(), ignoreCase = true)
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = contentPadding.calculateTopPadding() + 18.dp,
            bottom = contentPadding.calculateBottomPadding() + 28.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            ScreenTitle("Sealed Products", "Track sealed inventory and openings") {
                TextButton(onClick = viewModel::loadSealedData) { Text("Refresh") }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onOpenPacks, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.AutoAwesome, contentDescription = null)
                    Spacer(Modifier.size(6.dp))
                    Text("Open packs")
                }
                OutlinedButton(onClick = { showingCatalog = true }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.Add, contentDescription = null)
                    Spacer(Modifier.size(6.dp))
                    Text("Add product")
                }
                IconButton(onClick = { showingBarcode = true }) {
                    Icon(Icons.Default.QrCodeScanner, contentDescription = "Look up barcode")
                }
            }
        }
        item {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Search inventory") },
                singleLine = true,
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = section == SealedSection.INVENTORY,
                    onClick = { section = SealedSection.INVENTORY },
                    label = { Text("Inventory (${state.sealedInventory.size})") },
                )
                FilterChip(
                    selected = section == SealedSection.HISTORY,
                    onClick = { section = SealedSection.HISTORY },
                    label = { Text("Opening history (${state.sealedOpeningLedgers.size})") },
                )
            }
        }

        if (state.isLoadingSealed) {
            item {
                Row(Modifier.fillMaxWidth().padding(24.dp), horizontalArrangement = Arrangement.Center) {
                    CircularProgressIndicator()
                }
            }
        } else if (state.sealedInventoryError != null) {
            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Sealed inventory unavailable", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text(state.sealedInventoryError, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        TextButton(onClick = viewModel::loadSealedData) { Text("Retry") }
                    }
                }
            }
        } else if (section == SealedSection.INVENTORY && inventory.isEmpty()) {
            item {
                EmptyPane(
                    if (query.isBlank()) "No sealed products" else "No matching products",
                    if (query.isBlank()) "Add from the catalog to start tracking sealed inventory." else "Try a different search.",
                )
            }
        } else if (section == SealedSection.HISTORY && ledgers.isEmpty()) {
            item { EmptyPane("No recorded openings", "Open an inventory item or link it while saving pack pulls.") }
        }

        if (section == SealedSection.INVENTORY) {
            items(inventory, key = { it.id }) { item ->
                SealedInventoryCard(
                    item = item,
                    onEdit = { editing = item },
                    onOpen = { opening = item },
                    onDelete = { deleting = item },
                )
            }
        } else {
            items(ledgers, key = { it.id }, itemContent = { SealedOpeningCard(it) })
        }
    }

    if (showingCatalog) {
        SealedCatalogSheet(
            products = state.sealedProducts.filter { it.tcg in state.preferences.enabledGames },
            onDismiss = { showingCatalog = false },
            onAdd = { product, quantity, price ->
                viewModel.addSealedInventory(product.id, quantity, price) { saved ->
                    if (saved) showingCatalog = false
                }
            },
        )
    }
    if (showingBarcode) {
        BarcodeLookupDialog(
            onDismiss = { showingBarcode = false },
            onLookup = { code ->
                viewModel.findSealedProductByBarcode(code) { result ->
                    result.onSuccess { product ->
                        viewModel.addSealedInventory(product.id, 1, null) { saved ->
                            if (saved) showingBarcode = false
                        }
                    }
                }
            },
        )
    }
    editing?.let { item ->
        EditSealedDialog(item, onDismiss = { editing = null }) { quantity, price, notes ->
            viewModel.updateSealedInventory(item.id, quantity, price, item.purchaseDate, notes) { saved ->
                if (saved) editing = null
            }
        }
    }
    opening?.let { item ->
        RecordOpeningDialog(item, onDismiss = { opening = null }) { quantity, notes ->
            viewModel.recordSealedOpening(item.id, quantity, emptyList(), notes) { saved ->
                if (saved) opening = null
            }
        }
    }
    deleting?.let { item ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete sealed product?") },
            text = { Text("Remove ${item.product.name} from inventory? Opening history is kept.") },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.deleteSealedInventory(item.id) { deleted -> if (deleted) deleting = null }
                }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun SealedInventoryCard(
    item: SealedInventoryItem,
    onEdit: () -> Unit,
    onOpen: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            if (item.product.imageUrl != null) {
                AsyncImage(
                    model = item.product.imageUrl,
                    contentDescription = null,
                    modifier = Modifier.size(58.dp),
                )
                Spacer(Modifier.size(12.dp))
            } else {
                Icon(Icons.Default.Inventory2, contentDescription = null, modifier = Modifier.size(42.dp))
                Spacer(Modifier.size(12.dp))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(item.product.name, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    AssistChip(onClick = {}, label = { Text(item.product.tcg.displayGame()) })
                    AssistChip(onClick = {}, label = { Text(item.product.productType.replace('_', ' ')) })
                }
                Text(
                    buildString {
                        append("Qty ${item.quantity}")
                        item.product.setCode?.let { append(" · Set $it") }
                        item.purchasePrice?.let { append(" · ${it.money()}") }
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                item.notes?.let { Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 2) }
            }
            Column {
                IconButton(onClick = onOpen, enabled = item.quantity > 0) {
                    Icon(Icons.Default.AutoAwesome, contentDescription = "Record opening")
                }
                IconButton(onClick = onEdit) { Icon(Icons.Default.Edit, contentDescription = "Edit") }
                IconButton(onClick = onDelete) { Icon(Icons.Default.Delete, contentDescription = "Delete") }
            }
        }
    }
}

@Composable
private fun SealedOpeningCard(ledger: SealedOpeningLedger) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(ledger.productName, fontWeight = FontWeight.SemiBold)
            Text(
                "${ledger.openedQuantity} opened · ${ledger.openedAt.substringBefore('T')}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                "${ledger.invested.money()} invested · ${ledger.liveValue.money()} live · ${ledger.profitLoss.money()} P&L",
                style = MaterialTheme.typography.bodySmall,
            )
            if (ledger.activeCopies > 0 || ledger.soldCopies > 0) {
                Text("${ledger.activeCopies} active cards · ${ledger.soldCopies} sold", style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SealedCatalogSheet(
    products: List<SealedProduct>,
    onDismiss: () -> Unit,
    onAdd: (SealedProduct, Int, Double?) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf<SealedProduct?>(null) }
    var quantity by remember { mutableIntStateOf(1) }
    var price by remember { mutableStateOf("") }
    val filtered = products.filter { query.isBlank() || it.name.contains(query, ignoreCase = true) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp)) {
            Text("Product Catalog", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), label = { Text("Search products") })
            Spacer(Modifier.height(8.dp))
            LazyColumn(Modifier.heightIn(max = 520.dp)) {
                if (filtered.isEmpty()) item { EmptyPane("No products found", "Try another search or enable more games.") }
                items(filtered, key = { it.id }) { product ->
                    Row(
                        Modifier.fillMaxWidth().clickable { selected = product }.padding(vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(product.name, fontWeight = FontWeight.SemiBold)
                            Text(
                                listOfNotNull(product.tcg.displayGame(), product.productType, product.msrp?.let { "MSRP ${it.money()}" }).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Icon(Icons.Default.Add, contentDescription = "Add")
                    }
                }
            }
        }
    }
    selected?.let { product ->
        AlertDialog(
            onDismissRequest = { selected = null },
            title = { Text("Add ${product.name}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    QuantitySelector(quantity, onQuantity = { quantity = it })
                    OutlinedTextField(price, { price = it }, label = { Text("Purchase price (optional)") }, singleLine = true)
                }
            },
            confirmButton = {
                TextButton(onClick = { onAdd(product, quantity, price.toDoubleOrNull()) }) { Text("Add") }
            },
            dismissButton = { TextButton(onClick = { selected = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun EditSealedDialog(
    item: SealedInventoryItem,
    onDismiss: () -> Unit,
    onSave: (Int, Double?, String?) -> Unit,
) {
    var quantity by remember(item.id) { mutableIntStateOf(item.quantity.coerceAtLeast(1)) }
    var price by remember(item.id) { mutableStateOf(item.purchasePrice?.toString().orEmpty()) }
    var notes by remember(item.id) { mutableStateOf(item.notes.orEmpty()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit sealed product") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(item.product.name, fontWeight = FontWeight.SemiBold)
                QuantitySelector(quantity, onQuantity = { quantity = it })
                OutlinedTextField(price, { price = it }, label = { Text("Purchase price") }, singleLine = true)
                OutlinedTextField(notes, { notes = it }, label = { Text("Notes") }, minLines = 2)
            }
        },
        confirmButton = {
            TextButton(
                enabled = price.isBlank() || price.toDoubleOrNull()?.let { it >= 0 } == true,
                onClick = { onSave(quantity, price.toDoubleOrNull(), notes.trim().ifBlank { null }) },
            ) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun RecordOpeningDialog(
    item: SealedInventoryItem,
    onDismiss: () -> Unit,
    onSave: (Int, String?) -> Unit,
) {
    var quantity by remember(item.id) { mutableIntStateOf(1) }
    var notes by remember(item.id) { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Record opening") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(item.product.name)
                QuantitySelector(quantity, max = item.quantity, onQuantity = { quantity = it })
                OutlinedTextField(notes, { notes = it }, label = { Text("Notes (optional)") }, minLines = 2)
                Text("To link pulled cards automatically, use Open packs and choose this inventory item when saving.", style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { TextButton(onClick = { onSave(quantity, notes.trim().ifBlank { null }) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun BarcodeLookupDialog(onDismiss: () -> Unit, onLookup: (String) -> Unit) {
    var barcode by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Look up barcode") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Enter the 8–14 digit UPC/EAN printed on the product.")
                OutlinedTextField(barcode, { barcode = it.filter(Char::isDigit).take(14) }, label = { Text("UPC or EAN") }, singleLine = true)
            }
        },
        confirmButton = { TextButton(enabled = barcode.length in 8..14, onClick = { onLookup(barcode) }) { Text("Add") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun QuantitySelector(quantity: Int, max: Int = 9_999, onQuantity: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedButton(onClick = { onQuantity((quantity - 1).coerceAtLeast(1)) }, enabled = quantity > 1) { Text("−") }
        Text("Quantity $quantity", modifier = Modifier.weight(1f), fontWeight = FontWeight.Medium)
        OutlinedButton(onClick = { onQuantity((quantity + 1).coerceAtMost(max)) }, enabled = quantity < max) { Text("+") }
    }
}

private fun Double.money(): String = NumberFormat.getCurrencyInstance().format(this)
