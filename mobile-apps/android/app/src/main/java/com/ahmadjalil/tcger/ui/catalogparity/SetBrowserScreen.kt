package com.ahmadjalil.tcger.ui.catalogparity

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage

@Composable
fun SetBrowserScreen(
    dataSource: CatalogParityDataSource,
    ownedCards: List<OwnedPrinting>,
    enabledGames: Set<String>,
    contentPadding: PaddingValues = PaddingValues(),
    onOpenSet: (CatalogSet) -> Unit,
    onAddSetToWishlist: (CatalogSet) -> Unit,
) {
    var sets by remember { mutableStateOf<List<CatalogSet>>(emptyList()) }
    var failedProviders by remember { mutableStateOf<List<String>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var reloadKey by remember { mutableStateOf(0) }
    var query by remember { mutableStateOf("") }
    var selectedGame by remember { mutableStateOf<String?>(null) }
    var mode by remember { mutableStateOf(SetCompletionMode.STANDARD) }
    var sort by remember { mutableStateOf(SetBrowserSort.NEWEST) }
    var progressFilter by remember { mutableStateOf(SetProgressFilter.ALL) }
    var menuOpen by remember { mutableStateOf(false) }

    LaunchedEffect(reloadKey) {
        loading = true
        error = null
        runCatching { dataSource.sets() }
            .onSuccess { sets = it.sets; failedProviders = it.failedProviders }
            .onFailure { error = it.message ?: "The set catalog could not be loaded." }
        loading = false
    }
    LaunchedEffect(enabledGames) {
        if (selectedGame !in enabledGames) selectedGame = null
    }

    val progress = remember(sets, ownedCards, mode) { SetProgressCalculator.bySet(sets, ownedCards, mode) }
    val visibleSets = remember(sets, enabledGames, selectedGame, query, progressFilter, sort, progress) {
        sets.asSequence()
            .filter { it.tcg.lowercase() in enabledGames.map(String::lowercase) }
            .filter { selectedGame == null || it.tcg.equals(selectedGame, true) }
            .filter { query.isBlank() || it.name.contains(query.trim(), true) || it.code.contains(query.trim(), true) }
            .filter { set ->
                val item = progress.getValue(set.id)
                when (progressFilter) {
                    SetProgressFilter.ALL -> true
                    SetProgressFilter.STARTED -> item.owned > 0 && !item.complete
                    SetProgressFilter.COMPLETE -> item.complete
                    SetProgressFilter.NOT_STARTED -> item.owned == 0
                }
            }
            .sortedWith(compareBy<CatalogSet> { set ->
                when (sort) {
                    SetBrowserSort.NEWEST -> ""
                    SetBrowserSort.NAME -> set.name.lowercase()
                    SetBrowserSort.COMPLETION -> ""
                    SetBrowserSort.CLOSEST -> ""
                }
            }.let { base ->
                Comparator { left, right ->
                    when (sort) {
                        SetBrowserSort.NEWEST -> (right.releaseDate ?: right.releaseYear?.toString().orEmpty())
                            .compareTo(left.releaseDate ?: left.releaseYear?.toString().orEmpty())
                        SetBrowserSort.NAME -> base.compare(left, right)
                        SetBrowserSort.COMPLETION -> progress.getValue(right.id).fraction.compareTo(progress.getValue(left.id).fraction)
                        SetBrowserSort.CLOSEST -> {
                            val l = progress.getValue(left.id).let { if (it.total > 0) it.total - it.owned else Int.MAX_VALUE }
                            val r = progress.getValue(right.id).let { if (it.total > 0) it.total - it.owned else Int.MAX_VALUE }
                            l.compareTo(r).takeUnless { it == 0 } ?: left.name.compareTo(right.name, true)
                        }
                    }
                }
            }).toList()
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp, end = 16.dp,
            top = contentPadding.calculateTopPadding() + 20.dp,
            bottom = contentPadding.calculateBottomPadding() + 24.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Sets", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    Text("Track standard or master-set completion", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { menuOpen = true }) { Icon(Icons.Default.FilterList, "Set filters and sorting") }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    SetProgressFilter.entries.forEach { value ->
                        DropdownMenuItem(text = { Text("Progress: ${value.title}") }, onClick = { progressFilter = value; menuOpen = false })
                    }
                    SetCompletionMode.entries.forEach { value ->
                        DropdownMenuItem(text = { Text("Goal: ${value.title}") }, onClick = { mode = value; menuOpen = false })
                    }
                    SetBrowserSort.entries.forEach { value ->
                        DropdownMenuItem(text = { Text("Sort: ${value.title}") }, onClick = { sort = value; menuOpen = false })
                    }
                }
                IconButton(onClick = { reloadKey++ }) { Icon(Icons.Default.Refresh, "Refresh sets") }
            }
        }
        item {
            OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), label = { Text("Search sets") }, singleLine = true)
        }
        if (enabledGames.size > 1) item {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item { FilterChip(selectedGame == null, { selectedGame = null }, label = { Text("All games") }) }
                items(enabledGames.sorted()) { game ->
                    FilterChip(selectedGame == game, { selectedGame = game }, label = { Text(game.gameDisplayName()) })
                }
            }
        }
        if (failedProviders.isNotEmpty()) item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                Text("Some catalogs are unavailable: ${failedProviders.joinToString { it.gameDisplayName() }}", Modifier.padding(12.dp))
            }
        }
        when {
            loading -> item { CenterStatus { CircularProgressIndicator(); Text("Loading sets…") } }
            error != null -> item {
                CenterStatus {
                    Text("Failed to load sets", style = MaterialTheme.typography.titleMedium)
                    Text(error.orEmpty(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Button({ reloadKey++ }) { Text("Try again") }
                }
            }
            visibleSets.isEmpty() -> item { CenterStatus { Text("No sets found"); Text("Try another game, search, or progress filter.") } }
            else -> items(visibleSets, key = CatalogSet::id) { set ->
                SetRow(set, progress.getValue(set.id), onOpenSet, onAddSetToWishlist)
            }
        }
    }
}

@Composable
private fun SetRow(set: CatalogSet, progress: SetProgress, onOpen: (CatalogSet) -> Unit, onWishlist: (CatalogSet) -> Unit) {
    Card(
        Modifier.fillMaxWidth().clickable { onOpen(set) },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            AsyncImage(set.iconUrl ?: set.logoUrl, null, Modifier.size(42.dp))
            Column(Modifier.weight(1f).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(set.name, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("${set.code.uppercase()} · ${set.tcg.gameDisplayName()}${set.releaseDate?.let { " · $it" }.orEmpty()}", style = MaterialTheme.typography.labelSmall)
                if (progress.total > 0) {
                    LinearProgressIndicator({ progress.fraction }, Modifier.fillMaxWidth())
                    Text("${progress.owned} of ${progress.total} owned", style = MaterialTheme.typography.labelSmall)
                } else if (progress.owned > 0) Text("${progress.owned} owned", style = MaterialTheme.typography.labelSmall)
            }
            IconButton({ onWishlist(set) }) { Icon(Icons.Default.Add, "Add ${set.name} to wishlist") }
        }
    }
}

@Composable
fun SetDetailScreen(
    set: CatalogSet,
    dataSource: CatalogParityDataSource,
    ownedCards: List<OwnedPrinting>,
    contentPadding: PaddingValues = PaddingValues(),
    onBack: () -> Unit,
    onCardSelected: (CatalogParityCard) -> Unit,
    onAddSetToWishlist: (CatalogSet) -> Unit,
) {
    var cards by remember(set.id) { mutableStateOf<List<CatalogParityCard>>(emptyList()) }
    var loading by remember(set.id) { mutableStateOf(true) }
    var error by remember(set.id) { mutableStateOf<String?>(null) }
    var query by remember(set.id) { mutableStateOf("") }
    var mode by remember { mutableStateOf(SetCompletionMode.STANDARD) }
    var reload by remember { mutableStateOf(0) }
    LaunchedEffect(set.id, reload) {
        loading = true; error = null
        runCatching { dataSource.setCards(set.tcg, set.code) }
            .onSuccess { cards = it }
            .onFailure { error = it.message ?: "The cards in this set could not be loaded." }
        loading = false
    }
    val ownedIds = ownedCards.filter { it.quantity > 0 }.mapTo(hashSetOf()) { it.cardId }
    val visible = cards.filter { card ->
        (query.isBlank() || card.name.contains(query, true) || card.collectorNumber?.contains(query, true) == true) &&
            SetProgressCalculator.includes(card.collectorNumber, set.tcg, set.standardCards, mode)
    }
    val total = SetProgressCalculator.total(set, mode)
    val ownedCount = visible.count { it.id in ownedIds }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp, contentPadding.calculateTopPadding() + 12.dp, 16.dp, contentPadding.calculateBottomPadding() + 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onBack) { Icon(Icons.Default.ArrowBack, "Back") }
                Column(Modifier.weight(1f)) {
                    Text(set.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text("${set.code.uppercase()} · $ownedCount of $total owned")
                }
                OutlinedButton({ onAddSetToWishlist(set) }) { Text("Wishlist") }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SetCompletionMode.entries.forEach { value ->
                    FilterChip(mode == value, { mode = value }, label = { Text(value.title) })
                }
            }
        }
        item { OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), label = { Text("Search this set") }, singleLine = true) }
        when {
            loading -> item { CenterStatus { CircularProgressIndicator(); Text("Loading cards…") } }
            error != null -> item { CenterStatus { Text(error.orEmpty()); Button({ reload++ }) { Text("Try again") } } }
            visible.isEmpty() -> item { CenterStatus { Text("No cards found") } }
            else -> items(visible, key = CatalogParityCard::id) { card ->
                Card(Modifier.fillMaxWidth().clickable { onCardSelected(card) }) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        AsyncImage(card.imageUrlSmall ?: card.imageUrl, null, Modifier.size(52.dp))
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Text(card.name, fontWeight = FontWeight.SemiBold)
                            Text(listOfNotNull(card.collectorNumber, card.rarity).joinToString(" · "), style = MaterialTheme.typography.labelSmall)
                        }
                        Text(if (card.id in ownedIds) "Owned" else "Missing", color = if (card.id in ownedIds) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable
internal fun CenterStatus(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
}

internal fun String.gameDisplayName(): String = when (lowercase()) {
    "pokemon" -> "Pokémon"; "magic" -> "Magic"; "yugioh" -> "Yu-Gi-Oh!"
    "onepiece" -> "One Piece"; "lorcana" -> "Lorcana"; "dragonball" -> "Dragon Ball"
    else -> replaceFirstChar(Char::uppercase)
}
