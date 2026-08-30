package com.ahmadjalil.tcger.feature.libraryoperations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowOutward
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Calculate
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.Paid
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Currency
import kotlinx.coroutines.launch

private enum class OperationsDestination(val title: String) {
    MENU("Library Operations"),
    STORAGE("Physical Storage"),
    DECK_CHECKOUT("Deck Checkout"),
    RAPID_ENTRY("Rapid Set Entry"),
    COST_SPLIT("Acquisition Cost Split"),
    PSA("PSA Intake"),
    PRINTED_IDENTITY("Printed Identity"),
    PRICING("Price Provenance"),
}

private sealed interface AsyncState {
    data object Idle : AsyncState
    data object Loading : AsyncState
    data object Loaded : AsyncState
    data class Failed(val message: String) : AsyncState
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryOperationsHostScreen(
    repository: LibraryOperationsRepository?,
    contentPadding: PaddingValues,
    onBack: () -> Unit,
) {
    var destination by remember { mutableStateOf(OperationsDestination.MENU) }
    Scaffold(
        modifier = Modifier.padding(bottom = contentPadding.calculateBottomPadding()),
        topBar = {
            TopAppBar(
                title = { Text(destination.title) },
                navigationIcon = {
                    IconButton(onClick = {
                        if (destination == OperationsDestination.MENU) onBack()
                        else destination = OperationsDestination.MENU
                    }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        if (repository == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text(
                    "Connect and sign in to a TCGer server to use synchronized library operations.",
                    modifier = Modifier.padding(24.dp),
                )
            }
            return@Scaffold
        }
        when (destination) {
            OperationsDestination.MENU -> OperationsMenu(padding) { destination = it }
            OperationsDestination.STORAGE -> PhysicalStorageScreen(repository, padding)
            OperationsDestination.DECK_CHECKOUT -> DeckCheckoutScreen(repository, padding)
            OperationsDestination.RAPID_ENTRY -> RapidSetEntryScreen(repository, padding)
            OperationsDestination.COST_SPLIT -> AcquisitionCostSplitScreen(repository, padding)
            OperationsDestination.PSA -> PsaIntakeScreen(repository, padding)
            OperationsDestination.PRINTED_IDENTITY -> PrintedIdentityScreen(repository, padding)
            OperationsDestination.PRICING -> PriceProvenanceScreen(repository, padding)
        }
    }
}

@Composable
private fun OperationsMenu(padding: PaddingValues, onDestination: (OperationsDestination) -> Unit) {
    val rows = listOf(
        Triple(OperationsDestination.STORAGE, "Binders, boxes, pages, slots, locks, and Unsorted", Icons.Default.Inventory2),
        Triple(OperationsDestination.DECK_CHECKOUT, "Reserve copies and generate pull/refile lists", Icons.Default.ArrowOutward),
        Triple(OperationsDestination.RAPID_ENTRY, "Pin a set and keep collector-number focus", Icons.Default.Keyboard),
        Triple(OperationsDestination.COST_SPLIT, "Allocate exact cents with an audit receipt", Icons.Default.Calculate),
        Triple(OperationsDestination.PSA, "Look up a cert and confirm exact printing", Icons.Default.Verified),
        Triple(OperationsDestination.PRINTED_IDENTITY, "Localized names and search aliases", Icons.Default.Language),
        Triple(OperationsDestination.PRICING, "Native quotes, FX source, confidence, and coverage", Icons.Default.Paid),
    )
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp, padding.calculateTopPadding() + 8.dp, 16.dp, 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        items(rows, key = { it.first.name }) { (destination, subtitle, icon) ->
            Card(
                onClick = { onDestination(destination) },
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
            ) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(14.dp))
                    Column {
                        Text(destination.title, fontWeight = FontWeight.SemiBold)
                        Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable
private fun PhysicalStorageScreen(repository: LibraryOperationsRepository, padding: PaddingValues) {
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf<AsyncState>(AsyncState.Loading) }
    var containers by remember { mutableStateOf(emptyList<StorageContainer>()) }
    var selected by remember { mutableStateOf<StorageContainer?>(null) }
    var showCreate by remember { mutableStateOf(false) }
    var showCreateCompartment by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var operationError by remember { mutableStateOf<String?>(null) }

    fun load() {
        scope.launch {
            if (containers.isEmpty()) state = AsyncState.Loading
            runCatching { repository.getStorageContainers() }
                .onSuccess {
                    containers = it
                    selected = selected?.let { current -> it.firstOrNull { item -> item.id == current.id } }
                    state = AsyncState.Loaded
                }
                .onFailure { state = AsyncState.Failed(it.message ?: "Could not load storage") }
        }
    }
    LaunchedEffect(Unit) { load() }

    fun mutate(action: suspend () -> Unit) {
        scope.launch {
            busy = true
            operationError = null
            runCatching { action() }
                .onSuccess { load() }
                .onFailure { operationError = it.message ?: "Storage update failed" }
            busy = false
        }
    }

    fun reorderContainers(container: StorageContainer, direction: Int) {
        val ordered = containers.sortedBy(StorageContainer::order)
        val index = ordered.indexOfFirst { it.id == container.id }
        val neighbor = ordered.getOrNull(index + direction) ?: return
        mutate {
            repository.updateStorageContainer(container.id, UpdateStorageContainerRequest(order = neighbor.order))
            repository.updateStorageContainer(neighbor.id, UpdateStorageContainerRequest(order = container.order))
        }
    }

    fun reorderCompartments(container: StorageContainer, compartment: StorageCompartment, direction: Int) {
        val ordered = container.compartments.sortedBy(StorageCompartment::order)
        val index = ordered.indexOfFirst { it.id == compartment.id }
        val neighbor = ordered.getOrNull(index + direction) ?: return
        mutate {
            repository.updateStorageCompartment(compartment.id, UpdateStorageCompartmentRequest(order = neighbor.order))
            repository.updateStorageCompartment(neighbor.id, UpdateStorageCompartmentRequest(order = compartment.order))
        }
    }

    Column(
        Modifier.fillMaxSize().padding(
            start = 16.dp,
            end = 16.dp,
            top = padding.calculateTopPadding() + 8.dp,
            bottom = 16.dp,
        ),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            if (selected != null) TextButton(onClick = { selected = null }, enabled = !busy) { Text("All storage") }
            else Spacer(Modifier.width(1.dp))
            FilledTonalButton(onClick = { showCreate = true }) {
                Icon(Icons.Default.Add, contentDescription = null)
                Text("Create")
            }
        }
        operationError?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(8.dp))
        }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        when (val current = state) {
            AsyncState.Loading -> LoadingState("Loading storage…")
            is AsyncState.Failed -> ErrorState(current.message, ::load)
            else -> if (selected != null) {
                val container = selected!!
                StorageContainerDetail(
                    container = container,
                    enabled = !busy,
                    onToggleLock = {
                        mutate { repository.updateStorageContainer(container.id, UpdateStorageContainerRequest(locked = !container.locked)) }
                    },
                    onMoveContainer = { reorderContainers(container, it) },
                    onCreateCompartment = { showCreateCompartment = true },
                    onToggleCompartmentLock = { compartment ->
                        mutate {
                            repository.updateStorageCompartment(
                                compartment.id,
                                UpdateStorageCompartmentRequest(locked = !compartment.locked),
                            )
                        }
                    },
                    onMoveCompartment = { compartment, direction -> reorderCompartments(container, compartment, direction) },
                    onPlace = { request -> mutate { repository.placeCollectionEntry(request) } },
                    onMovePlacement = { compartment, placement, slotIndex, allowStacking ->
                        mutate {
                            repository.removeStoragePlacement(placement.id)
                            runCatching {
                                repository.placeCollectionEntry(
                                    PlaceCollectionEntryRequest(
                                        compartmentId = compartment.id,
                                        collectionEntryId = placement.collectionEntryId,
                                        slotIndex = slotIndex,
                                        quantity = placement.quantity,
                                        allowDuplicateStacking = allowStacking,
                                    ),
                                )
                            }.getOrElse { moveFailure ->
                                // A move is represented by remove + place. Restore the original slot
                                // when the destination rejects the placement.
                                runCatching {
                                    repository.placeCollectionEntry(
                                        PlaceCollectionEntryRequest(
                                            compartmentId = compartment.id,
                                            collectionEntryId = placement.collectionEntryId,
                                            slotIndex = placement.slotIndex,
                                            quantity = placement.quantity,
                                            allowDuplicateStacking = true,
                                        ),
                                    )
                                }
                                throw moveFailure
                            }
                        }
                    },
                    onRemove = { placement -> mutate { repository.removeStoragePlacement(placement.id) } },
                )
            } else if (containers.isEmpty()) {
                EmptyState("No physical storage", "Create a binder or box to begin assigning exact slots.")
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(containers, key = StorageContainer::id) { container ->
                        Card(onClick = { selected = container }, modifier = Modifier.fillMaxWidth()) {
                            Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(container.name, fontWeight = FontWeight.SemiBold)
                                    Text(
                                        "${container.compartments.size} sections · ${container.compartments.sumOf { it.placements.sumOf(StoragePlacement::quantity) }} placed",
                                        style = MaterialTheme.typography.bodySmall,
                                    )
                                }
                                if (container.locked) Icon(Icons.Default.Lock, contentDescription = "Locked")
                            }
                        }
                    }
                }
            }
        }
    }
    if (showCreate) CreateStorageDialog(
        onDismiss = { showCreate = false },
        onCreate = { request ->
            scope.launch {
                runCatching { repository.createStorageContainer(request) }
                    .onSuccess { showCreate = false; load() }
                    .onFailure { state = AsyncState.Failed(it.message ?: "Could not create storage") }
            }
        },
    )
    val selectedContainer = selected
    if (showCreateCompartment && selectedContainer != null) {
        CreateStorageCompartmentDialog(
            container = selectedContainer,
            onDismiss = { showCreateCompartment = false },
            onCreate = { request ->
                showCreateCompartment = false
                mutate { repository.createStorageCompartment(request) }
            },
        )
    }
}

@Composable
private fun StorageContainerDetail(
    container: StorageContainer,
    enabled: Boolean,
    onToggleLock: () -> Unit,
    onMoveContainer: (Int) -> Unit,
    onCreateCompartment: () -> Unit,
    onToggleCompartmentLock: (StorageCompartment) -> Unit,
    onMoveCompartment: (StorageCompartment, Int) -> Unit,
    onPlace: (PlaceCollectionEntryRequest) -> Unit,
    onMovePlacement: (StorageCompartment, StoragePlacement, Int, Boolean) -> Unit,
    onRemove: (StoragePlacement) -> Unit,
) {
    var editingPlacement by remember { mutableStateOf<Pair<StorageCompartment, StoragePlacement?>?>(null) }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(container.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Text("${container.kind.replaceFirstChar(Char::uppercase)} · order ${container.order}", style = MaterialTheme.typography.bodySmall)
                        }
                        Icon(if (container.locked) Icons.Default.Lock else Icons.Default.LockOpen, contentDescription = null)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedButton(onClick = { onMoveContainer(-1) }, enabled = enabled) { Text("↑") }
                        OutlinedButton(onClick = { onMoveContainer(1) }, enabled = enabled) { Text("↓") }
                        FilledTonalButton(onClick = onToggleLock, enabled = enabled) {
                            Text(if (container.locked) "Unlock" else "Lock")
                        }
                        Button(onClick = onCreateCompartment, enabled = enabled && !container.locked) { Text("Add section") }
                    }
                    if (container.locked) Text("Unlock this container to edit sections or placements.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        items(container.compartments.sortedBy(StorageCompartment::order), key = StorageCompartment::id) { compartment ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(compartment.label, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        compartment.pageNumber?.let { Text("Page $it", style = MaterialTheme.typography.labelMedium) }
                        if (compartment.locked) Icon(Icons.Default.Lock, contentDescription = "Locked")
                    }
                    Text(
                        "${compartment.rows} × ${compartment.columns} · ${compartment.capacity} slots · order ${compartment.order}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedButton(onClick = { onMoveCompartment(compartment, -1) }, enabled = enabled && !container.locked) { Text("↑") }
                        OutlinedButton(onClick = { onMoveCompartment(compartment, 1) }, enabled = enabled && !container.locked) { Text("↓") }
                        TextButton(
                            onClick = { onToggleCompartmentLock(compartment) },
                            enabled = enabled && !container.locked,
                        ) { Text(if (compartment.locked) "Unlock" else "Lock") }
                        TextButton(
                            onClick = { editingPlacement = compartment to null },
                            enabled = enabled && !container.locked && !compartment.locked,
                        ) { Text("Place") }
                    }
                    Spacer(Modifier.height(8.dp))
                    compartment.placements.groupBy(StoragePlacement::slotIndex).toSortedMap().forEach { (slot, placements) ->
                        placements.forEach { placement ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text("Slot ${slot + 1}", modifier = Modifier.width(64.dp), style = MaterialTheme.typography.labelMedium)
                                Text(
                                    placement.printedName ?: placement.cardName ?: placement.collectionEntryId,
                                    modifier = Modifier.weight(1f),
                                    maxLines = 1,
                                )
                                Text("×${placement.quantity}")
                                TextButton(
                                    onClick = { editingPlacement = compartment to placement },
                                    enabled = enabled && !container.locked && !compartment.locked,
                                ) { Text("Move") }
                                TextButton(
                                    onClick = { onRemove(placement) },
                                    enabled = enabled && !container.locked && !compartment.locked,
                                ) { Text("Remove") }
                            }
                        }
                    }
                    if (compartment.placements.isEmpty()) {
                        Text("${compartment.capacity} empty slots", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
    editingPlacement?.let { (compartment, placement) ->
        StoragePlacementDialog(
            container = container,
            compartment = compartment,
            placement = placement,
            onDismiss = { editingPlacement = null },
            onSubmit = { entryId, slotIndex, quantity, allowStacking ->
                editingPlacement = null
                if (placement == null) {
                    onPlace(PlaceCollectionEntryRequest(compartment.id, entryId, slotIndex, quantity, allowStacking))
                } else {
                    onMovePlacement(compartment, placement, slotIndex, allowStacking)
                }
            },
        )
    }
}

@Composable
private fun CreateStorageCompartmentDialog(
    container: StorageContainer,
    onDismiss: () -> Unit,
    onCreate: (CreateStorageCompartmentRequest) -> Unit,
) {
    var label by remember { mutableStateOf("") }
    var page by remember { mutableStateOf("") }
    var rows by remember { mutableStateOf("3") }
    var columns by remember { mutableStateOf("3") }
    var capacity by remember { mutableStateOf("9") }
    val rowsValue = rows.toIntOrNull() ?: 0
    val columnsValue = columns.toIntOrNull() ?: 0
    val capacityValue = capacity.toIntOrNull() ?: 0
    val error = StoragePlacementRules.compartmentError(rowsValue, columnsValue, capacityValue)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add section") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(label, { label = it }, label = { Text("Label") }, singleLine = true)
                OutlinedTextField(page, { page = it.filter(Char::isDigit) }, label = { Text("Page number (optional)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(rows, { rows = it.filter(Char::isDigit) }, label = { Text("Rows") }, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                    OutlinedTextField(columns, { columns = it.filter(Char::isDigit) }, label = { Text("Columns") }, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                }
                OutlinedTextField(capacity, { capacity = it.filter(Char::isDigit) }, label = { Text("Capacity") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = label.isNotBlank() && error == null && (page.isBlank() || (page.toIntOrNull() ?: 0) > 0),
                onClick = {
                    onCreate(
                        CreateStorageCompartmentRequest(
                            containerId = container.id,
                            label = label.trim(),
                            order = (container.compartments.maxOfOrNull(StorageCompartment::order) ?: -1) + 1,
                            pageNumber = page.toIntOrNull(),
                            rows = rowsValue,
                            columns = columnsValue,
                            capacity = capacityValue,
                        ),
                    )
                },
            ) { Text("Create") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun StoragePlacementDialog(
    container: StorageContainer,
    compartment: StorageCompartment,
    placement: StoragePlacement?,
    onDismiss: () -> Unit,
    onSubmit: (entryId: String, slotIndex: Int, quantity: Int, allowStacking: Boolean) -> Unit,
) {
    var entryId by remember { mutableStateOf(placement?.collectionEntryId.orEmpty()) }
    var slot by remember { mutableStateOf(placement?.slotIndex?.plus(1)?.toString() ?: "1") }
    var quantity by remember { mutableStateOf(placement?.quantity?.toString() ?: "1") }
    var allowStacking by remember { mutableStateOf(false) }
    val slotIndex = (slot.toIntOrNull() ?: 0) - 1
    val quantityValue = quantity.toIntOrNull() ?: 0
    val error = StoragePlacementRules.placementError(
        container = container,
        compartment = compartment,
        slotIndex = slotIndex,
        quantity = quantityValue,
        allowDuplicateStacking = allowStacking,
        movingPlacementId = placement?.id,
    )
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (placement == null) "Place collection entry" else "Move placement") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    entryId,
                    { entryId = it },
                    label = { Text("Collection entry ID") },
                    enabled = placement == null,
                    singleLine = true,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(slot, { slot = it.filter(Char::isDigit) }, label = { Text("Slot (1–${compartment.capacity})") }, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                    OutlinedTextField(quantity, { quantity = it.filter(Char::isDigit) }, label = { Text("Quantity") }, enabled = placement == null, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Allow same-printing stack", modifier = Modifier.weight(1f))
                    Switch(checked = allowStacking, onCheckedChange = { allowStacking = it })
                }
                Text("Stacking is accepted only when the server confirms the slot contains the same printing.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = entryId.isNotBlank() && error == null,
                onClick = { onSubmit(entryId.trim(), slotIndex, quantityValue, allowStacking) },
            ) { Text(if (placement == null) "Place" else "Move") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun CreateStorageDialog(onDismiss: () -> Unit, onCreate: (CreateStorageContainerRequest) -> Unit) {
    var name by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("binder") }
    var unsorted by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New physical storage") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("binder", "box", "case", "other").forEach { option ->
                        OutlinedButton(onClick = { kind = option }) { Text(if (kind == option) "✓ ${option.replaceFirstChar(Char::uppercase)}" else option.replaceFirstChar(Char::uppercase)) }
                    }
                }
                TextButton(onClick = { unsorted = !unsorted }) { Text(if (unsorted) "✓ Unsorted queue" else "Make this the Unsorted queue") }
            }
        },
        confirmButton = {
            TextButton(
                enabled = name.isNotBlank(),
                onClick = { onCreate(CreateStorageContainerRequest(name.trim(), kind, isUnsorted = unsorted)) },
            ) { Text("Create") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun DeckCheckoutScreen(repository: LibraryOperationsRepository, padding: PaddingValues) {
    val scope = rememberCoroutineScope()
    var deckId by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var session by remember { mutableStateOf<DeckCheckoutSession?>(null) }
    var state by remember { mutableStateOf<AsyncState>(AsyncState.Idle) }

    fun load() {
        if (deckId.isBlank()) return
        scope.launch {
            state = AsyncState.Loading
            runCatching { repository.getDeckCheckout(deckId.trim()) }
                .onSuccess { session = it; state = AsyncState.Loaded }
                .onFailure { state = AsyncState.Failed(it.message ?: "Could not load checkout") }
        }
    }
    OperationForm(padding) {
        OutlinedTextField(deckId, { deckId = it }, label = { Text("Deck ID") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        OutlinedTextField(note, { note = it }, label = { Text("Checkout note (optional)") }, modifier = Modifier.fillMaxWidth())
        Button(onClick = ::load, enabled = deckId.isNotBlank() && state != AsyncState.Loading) { Text("Load checkout") }
        when (val current = state) {
            AsyncState.Loading -> LoadingState("Loading checkout…")
            is AsyncState.Failed -> Text(current.message, color = MaterialTheme.colorScheme.error)
            else -> Unit
        }
        val checkout = session
        if (checkout == null && state == AsyncState.Loaded) {
            Button(onClick = {
                scope.launch {
                    state = AsyncState.Loading
                    runCatching { repository.checkoutDeck(deckId.trim(), note.trim().ifBlank { null }) }
                        .onSuccess { session = it; state = AsyncState.Loaded }
                        .onFailure { state = AsyncState.Failed(it.message ?: "Checkout failed") }
                }
            }) { Text("Reserve copies and check out") }
        }
        checkout?.let { value ->
            Text(if (value.isCheckedOut) "Pull list" else "Refiling list", style = MaterialTheme.typography.titleMedium)
            value.allocations.sortedWith(compareBy({ it.containerName }, { it.compartmentLabel }, { it.slotIndex })).forEach { allocation ->
                Card(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(allocation.printedName ?: allocation.cardName ?: allocation.collectionEntryId)
                            Text(allocation.locationDescription, style = MaterialTheme.typography.bodySmall)
                        }
                        Text("×${allocation.quantity}", fontWeight = FontWeight.Bold)
                    }
                }
            }
            if (value.isCheckedOut) Button(onClick = {
                scope.launch {
                    state = AsyncState.Loading
                    runCatching { repository.checkinDeck(deckId.trim()) }
                        .onSuccess { session = it; state = AsyncState.Loaded }
                        .onFailure { state = AsyncState.Failed(it.message ?: "Check-in failed") }
                }
            }) { Text("Check in and release reservations") }
        }
    }
}

@Composable
private fun RapidSetEntryScreen(repository: LibraryOperationsRepository, padding: PaddingValues) {
    val scope = rememberCoroutineScope()
    val focusRequester = remember { FocusRequester() }
    var binderId by remember { mutableStateOf("") }
    var tcg by remember { mutableStateOf("pokemon") }
    var setCode by remember { mutableStateOf("") }
    var collectorNumber by remember { mutableStateOf("") }
    var printedName by remember { mutableStateOf("") }
    var quantity by remember { mutableStateOf("1") }
    val receipts = remember { mutableStateListOf<Pair<RapidSetEntryReceipt, RapidCardData>>() }
    var state by remember { mutableStateOf<AsyncState>(AsyncState.Idle) }

    fun submit() {
        val count = quantity.toIntOrNull() ?: return
        if (binderId.isBlank() || setCode.isBlank() || collectorNumber.isBlank() || count < 1) return
        scope.launch {
            state = AsyncState.Loading
            runCatching {
                val card = repository.resolveRapidCard(tcg.trim().lowercase(), setCode.trim(), collectorNumber.trim())
                val localizedCard = card.copy(printedName = printedName.trim().ifBlank { null })
                repository.rapidSetEntry(
                    RapidSetEntryRequest(
                        binderId.trim(),
                        tcg.trim().lowercase(),
                        setCode.trim(),
                        listOf(
                            RapidSetEntryRow(
                                java.util.UUID.randomUUID().toString(),
                                collectorNumber.trim(),
                                localizedCard,
                                count,
                            ),
                        ),
                    ),
                ) to localizedCard
            }.onSuccess { result ->
                receipts.add(0, result)
                collectorNumber = ""
                printedName = ""
                quantity = "1"
                state = AsyncState.Loaded
                focusRequester.requestFocus()
            }.onFailure { state = AsyncState.Failed(it.message ?: "Could not add card") }
        }
    }
    OperationForm(padding) {
        Text("Pinned destination", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(binderId, { binderId = it }, label = { Text("Binder ID") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        OutlinedTextField(tcg, { tcg = it }, label = { Text("Game") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        OutlinedTextField(
            setCode,
            { setCode = it },
            label = { Text("Set code") },
            modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
            singleLine = true,
        )
        HorizontalDivider()
        OutlinedTextField(
            collectorNumber,
            { collectorNumber = it },
            label = { Text("Collector number") },
            modifier = Modifier.fillMaxWidth().focusRequester(focusRequester),
            singleLine = true,
        )
        OutlinedTextField(printedName, { printedName = it }, label = { Text("Printed name (optional)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        OutlinedTextField(
            quantity,
            { quantity = it.filter(Char::isDigit) },
            label = { Text("Quantity") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            singleLine = true,
        )
        Button(onClick = ::submit, enabled = state != AsyncState.Loading) { Text("Add and keep typing") }
        if (state == AsyncState.Loading) LoadingState("Adding card…")
        if (state is AsyncState.Failed) Text((state as AsyncState.Failed).message, color = MaterialTheme.colorScheme.error)
        if (receipts.isNotEmpty()) Text("Receipt", style = MaterialTheme.typography.titleMedium)
        receipts.forEach { (receipt, card) ->
            Card(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(card.printedName ?: card.name)
                        Text(
                            "$setCode #${receipt.items.firstOrNull()?.collectorNumber.orEmpty()} · ×${receipt.addedCopies}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    TextButton(onClick = {
                        scope.launch {
                            val auditId = receipt.items.firstOrNull()?.auditId ?: return@launch
                            runCatching { repository.undoRapidSetEntry(auditId) }
                                .onSuccess { receipts.remove(receipt to card) }
                                .onFailure { state = AsyncState.Failed(it.message ?: "Undo failed") }
                        }
                    }) { Text("Undo") }
                }
            }
        }
    }
}

@Composable
private fun AcquisitionCostSplitScreen(repository: LibraryOperationsRepository, padding: PaddingValues) {
    val scope = rememberCoroutineScope()
    var total by remember { mutableStateOf("") }
    var currency by remember { mutableStateOf("USD") }
    var method by remember { mutableStateOf("equal") }
    var itemText by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var receipt by remember { mutableStateOf<AcquisitionCostSplitReceipt?>(null) }
    var state by remember { mutableStateOf<AsyncState>(AsyncState.Idle) }
    val items = remember(itemText, method) { parseSplitItems(itemText, method) }
    val cents = remember(total) { parseExactCents(total) }
    val preview = remember(cents, items) { cents?.let { runCatching { ExactCentAllocator.allocate(it, items) }.getOrNull() } }

    OperationForm(padding) {
        OutlinedTextField(total, { total = it }, label = { Text("Purchase total") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), singleLine = true)
        OutlinedTextField(currency, { currency = it.uppercase() }, label = { Text("Currency") }, singleLine = true)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { method = "equal" }) { Text(if (method == "equal") "✓ Equal" else "Equal") }
            OutlinedButton(onClick = { method = "weighted" }) { Text(if (method == "weighted") "✓ Weighted" else "Weighted") }
        }
        OutlinedTextField(
            itemText,
            { itemText = it },
            label = { Text(if (method == "equal") "Entry IDs, one per line" else "Entry ID,weight per line") },
            minLines = 4,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(note, { note = it }, label = { Text("Audit note (optional)") }, modifier = Modifier.fillMaxWidth())
        if (preview != null) {
            Text("Exact-cent preview", style = MaterialTheme.typography.titleMedium)
            preview.forEach { (id, amount) -> Row(Modifier.fillMaxWidth()) { Text(id, Modifier.weight(1f)); Text(formatMoney(amount, currency)) } }
        }
        Button(
            enabled = cents != null && items.isNotEmpty() && state != AsyncState.Loading,
            onClick = {
                scope.launch {
                    state = AsyncState.Loading
                    runCatching {
                        repository.splitAcquisitionCost(
                            AcquisitionCostSplitRequest(cents!!, currency, method, items, note.trim().ifBlank { null }),
                        )
                    }.onSuccess { receipt = it; state = AsyncState.Loaded }
                        .onFailure { state = AsyncState.Failed(it.message ?: "Cost split failed") }
                }
            },
        ) { Text("Record split") }
        if (state == AsyncState.Loading) LoadingState("Recording audited split…")
        if (state is AsyncState.Failed) Text((state as AsyncState.Failed).message, color = MaterialTheme.colorScheme.error)
        receipt?.let { value ->
            Text("Audit receipt ${value.auditId}", style = MaterialTheme.typography.titleMedium)
            value.allocations.forEach { allocation ->
                Row(Modifier.fillMaxWidth()) {
                    Text(allocation.collectionEntryId, Modifier.weight(1f))
                    Text(formatMoney(allocation.allocatedCents, value.currency), fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun PsaIntakeScreen(repository: LibraryOperationsRepository, padding: PaddingValues) {
    val scope = rememberCoroutineScope()
    var cert by remember { mutableStateOf("") }
    var binderId by remember { mutableStateOf("") }
    var entryId by remember { mutableStateOf("") }
    var lookup by remember { mutableStateOf<PsaCertificationLookup?>(null) }
    var state by remember { mutableStateOf<AsyncState>(AsyncState.Idle) }
    var success by remember { mutableStateOf<String?>(null) }
    OperationForm(padding) {
        OutlinedTextField(cert, { cert = it.filter(Char::isDigit) }, label = { Text("PSA certification number") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
        Button(
            onClick = {
                scope.launch {
                    state = AsyncState.Loading
                    runCatching { repository.lookupPsaCertification(cert) }
                        .onSuccess {
                            lookup = it
                            state = AsyncState.Loaded
                        }
                        .onFailure { state = AsyncState.Failed(it.message ?: "PSA lookup failed") }
                }
            },
            enabled = cert.isNotBlank() && state != AsyncState.Loading,
        ) { Text("Look up cert") }
        if (state == AsyncState.Loading) LoadingState("Checking PSA…")
        if (state is AsyncState.Failed) Text((state as AsyncState.Failed).message, color = MaterialTheme.colorScheme.error)
        lookup?.let { result ->
            Text(result.searchableName ?: result.subject ?: "Unknown card", style = MaterialTheme.typography.titleMedium)
            Text("${result.grader} ${result.gradeLabel ?: result.grade ?: "Unknown"} · fetched ${result.retrievedAt}")
            result.variety?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            Text("Confirm exact printing", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(binderId, { binderId = it }, label = { Text("Binder ID") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            OutlinedTextField(entryId, { entryId = it }, label = { Text("Owned collection entry ID") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            result.cardId?.let { Text("Provider printing: $it", style = MaterialTheme.typography.bodySmall) }
            Button(
                enabled = binderId.isNotBlank() && entryId.isNotBlank(),
                onClick = {
                    scope.launch {
                        state = AsyncState.Loading
                        runCatching {
                            repository.intakePsaCertification(
                                PsaCertIntakeRequest(
                                    binderId.trim(),
                                    entryId.trim(),
                                    result.grader,
                                    result.gradeLabel ?: result.grade?.toString(),
                                    result.certNumber,
                                ),
                            )
                        }.onSuccess { success = "Updated ${it.name} with ${result.grader} ${result.gradeLabel ?: result.grade ?: "grade"}"; state = AsyncState.Loaded }
                            .onFailure { state = AsyncState.Failed(it.message ?: "Could not add graded card") }
                    }
                },
            ) { Text("Add graded card") }
        }
        success?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
    }
}

@Composable
private fun PrintedIdentityScreen(repository: LibraryOperationsRepository, padding: PaddingValues) {
    val scope = rememberCoroutineScope()
    var binderId by remember { mutableStateOf("") }
    var entryId by remember { mutableStateOf("") }
    var printedName by remember { mutableStateOf("") }
    var aliases by remember { mutableStateOf("") }
    var state by remember { mutableStateOf<AsyncState>(AsyncState.Idle) }
    OperationForm(padding) {
        OutlinedTextField(binderId, { binderId = it }, label = { Text("Binder ID") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        OutlinedTextField(entryId, { entryId = it }, label = { Text("Collection entry ID") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        OutlinedTextField(printedName, { printedName = it }, label = { Text("Name printed on the card") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        OutlinedTextField(aliases, { aliases = it }, label = { Text("Search aliases, comma-separated") }, modifier = Modifier.fillMaxWidth())
        Button(
            enabled = binderId.isNotBlank() && entryId.isNotBlank() && state != AsyncState.Loading,
            onClick = {
                scope.launch {
                    state = AsyncState.Loading
                    runCatching {
                        repository.updatePrintedIdentity(
                            binderId.trim(),
                            entryId.trim(),
                            PrintedIdentityUpdateRequest(
                                printedName.trim().ifBlank { null },
                                aliases.split(',').map(String::trim).filter(String::isNotBlank),
                            ),
                        )
                    }.onSuccess { state = AsyncState.Loaded }
                        .onFailure { state = AsyncState.Failed(it.message ?: "Could not save printed identity") }
                }
            },
        ) { Text("Save printed identity") }
        when (val current = state) {
            AsyncState.Loading -> LoadingState("Saving…")
            AsyncState.Loaded -> Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.CheckCircle, null); Text(" Printed identity saved") }
            is AsyncState.Failed -> Text(current.message, color = MaterialTheme.colorScheme.error)
            else -> Unit
        }
    }
}

@Composable
private fun PriceProvenanceScreen(repository: LibraryOperationsRepository, padding: PaddingValues) {
    val scope = rememberCoroutineScope()
    var tcg by remember { mutableStateOf("pokemon") }
    var externalId by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<TrackedPriceResult?>(null) }
    var state by remember { mutableStateOf<AsyncState>(AsyncState.Idle) }
    OperationForm(padding) {
        OutlinedTextField(tcg, { tcg = it }, label = { Text("Game") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        OutlinedTextField(externalId, { externalId = it }, label = { Text("Card external ID") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        Button(
            enabled = externalId.isNotBlank() && state != AsyncState.Loading,
            onClick = {
                scope.launch {
                    state = AsyncState.Loading
                    runCatching { repository.getTrackedPrice(tcg.trim().lowercase(), externalId.trim()) }
                        .onSuccess { result = it; state = AsyncState.Loaded }
                        .onFailure { state = AsyncState.Failed(it.message ?: "Could not load tracked quote") }
                }
            },
        ) { Text("Load tracked quote") }
        if (state == AsyncState.Loading) LoadingState("Loading tracked quote…")
        if (state is AsyncState.Failed) Text((state as AsyncState.Failed).message, color = MaterialTheme.colorScheme.error)
        result?.let { value ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(Modifier.fillMaxWidth()) {
                        Text(value.source ?: value.provenance?.provider ?: "Unavailable", fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        if (value.price != null && value.currency != null) {
                            Text(formatMoney((value.price * 100).toLong(), value.currency), fontWeight = FontWeight.Bold)
                        }
                    }
                    Text(if (value.cached) "Cached quote" else "Fresh quote", style = MaterialTheme.typography.bodySmall)
                    value.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            }
            value.provenance?.let { provenance ->
                Text("Native currency & match", style = MaterialTheme.typography.titleMedium)
                provenance.originalQuotes.forEach { quote ->
                    Row(Modifier.fillMaxWidth()) {
                        Text(quote.source, Modifier.weight(1f))
                        Text("${quote.amount} ${quote.currency}")
                    }
                }
                provenance.fx?.let { fx ->
                    Text("FX ${fx.fromCurrency} → ${fx.toCurrency}: ${fx.rate} · ${fx.source} · ${fx.asOf}", style = MaterialTheme.typography.bodySmall)
                }
                provenance.match?.let { match ->
                    Text(
                        "Match ${match.method} · ${(match.confidence * 100).toInt()}%${if (match.ambiguous == true) " · ambiguous" else ""}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

@Composable
private fun OperationForm(padding: PaddingValues, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(
            start = 16.dp,
            end = 16.dp,
            top = padding.calculateTopPadding() + 8.dp,
            bottom = 32.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) { content() }
}

@Composable private fun LoadingState(label: String) = Row(verticalAlignment = Alignment.CenterVertically) {
    CircularProgressIndicator(Modifier.width(24.dp))
    Spacer(Modifier.width(10.dp))
    Text(label)
}

@Composable private fun ErrorState(message: String, retry: () -> Unit) = Column(horizontalAlignment = Alignment.CenterHorizontally) {
    Text(message, color = MaterialTheme.colorScheme.error)
    TextButton(onClick = retry) { Text("Retry") }
}

@Composable private fun EmptyState(title: String, detail: String) = Column(
    Modifier.fillMaxWidth().padding(32.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
) {
    Text(title, style = MaterialTheme.typography.titleMedium)
    Text(detail, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

private fun parseSplitItems(value: String, method: String): List<AcquisitionCostSplitItem> =
    value.lineSequence().mapNotNull { raw ->
        val parts = raw.split(',', limit = 2).map(String::trim)
        val id = parts.firstOrNull()?.takeIf(String::isNotBlank) ?: return@mapNotNull null
        val weight = if (method == "equal") 1 else parts.getOrNull(1)?.toIntOrNull() ?: return@mapNotNull null
        weight.takeIf { it > 0 }?.let { AcquisitionCostSplitItem(id, it) }
    }.toList()

private fun parseExactCents(value: String): Long? = runCatching {
    BigDecimal(value).movePointRight(2).setScale(0, RoundingMode.UNNECESSARY).longValueExact()
}.getOrNull()

private fun formatMoney(cents: Long, code: String): String = runCatching {
    NumberFormat.getCurrencyInstance().apply { currency = Currency.getInstance(code.uppercase()) }.format(cents / 100.0)
}.getOrDefault("${cents / 100.0} $code")
