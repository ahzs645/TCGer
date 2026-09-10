package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Casino
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.ahmadjalil.tcger.domain.CatalogCard
import com.ahmadjalil.tcger.domain.DataSourceMode
import com.ahmadjalil.tcger.generated.ParityFeatureIDs
import com.ahmadjalil.tcger.ui.AppUiState
import com.ahmadjalil.tcger.ui.AppViewModel

@Composable
fun SearchScreen(
    state: AppUiState,
    contentPadding: PaddingValues,
    viewModel: AppViewModel,
    onScanCard: (ScannerInput, String?) -> Unit,
    initialBinderId: String? = null,
    onBack: (() -> Unit)? = null,
) {
    var selectedCard by remember { mutableStateOf<CatalogCard?>(null) }
    var appliedDefaultGame by rememberSaveable { mutableStateOf(false) }
    var showingFilters by rememberSaveable { mutableStateOf(false) }
    var filters by remember { mutableStateOf(CardSearchFilters()) }
    val packageDefinitions = state.gamePackages.installed
        .filter { it.manifest.effectiveDefinition.interfaces?.search != false }
    val packageLabels = packageDefinitions.associate {
        "package:${it.id}" to "${it.manifest.effectiveDefinition.label} · ${it.manifest.publisher.name}"
    }
    val games = (state.preferences.enabledGames.sorted() + packageDefinitions.map { "package:${it.id}" }).distinct()
    val filteredResults = state.searchResults.filter { filters.matches(it, state.searchGame) }
    val targetBinder = state.binders.firstOrNull { it.id == initialBinderId }
    val canScan = state.scannerSupportedGames.any {
        it in state.preferences.enabledGames && (state.searchGame == null || state.searchGame == it)
    }

    LaunchedEffect(initialBinderId) {
        if (initialBinderId != null) viewModel.setSearchCollectionOnly(false)
    }

    LaunchedEffect(state.preferences.defaultGame, games) {
        val defaultGame = state.preferences.defaultGame
        if (!appliedDefaultGame && defaultGame != null && defaultGame in games) {
            viewModel.setSearchGame(defaultGame)
            appliedDefaultGame = true
        }
    }

    LazyColumn(
        Modifier.fillMaxSize().testTag(ParityFeatureIDs.screen(ParityFeatureIDs.CARDS_SEARCH)).padding(
            start = 16.dp,
            end = 16.dp,
            top = contentPadding.calculateTopPadding() + 20.dp,
            bottom = contentPadding.calculateBottomPadding(),
        ),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        contentPadding = PaddingValues(bottom = 24.dp),
    ) {
        item {
        onBack?.let { back ->
            TextButton(onClick = back) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, null)
                Text(" Back to binder")
            }
        }
        ScreenTitle(
            if (initialBinderId != null) "Add card to binder" else "Card search",
            targetBinder?.let { "Search, scan, or choose a photo to add to ${it.name}" }
                ?: if (state.searchCollectionOnly) "Find cards in your binders" else "Search downloaded libraries and your connected catalog",
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(!state.searchCollectionOnly, { viewModel.setSearchCollectionOnly(false) }, { Text("All cards") })
            FilterChip(state.searchCollectionOnly, { viewModel.setSearchCollectionOnly(true) }, { Text("My collection") })
        }
        OutlinedTextField(
            value = state.searchQuery,
            onValueChange = viewModel::setSearchQuery,
            modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
            leadingIcon = { Icon(Icons.Default.Search, null) },
            label = { Text("Name or card number") },
            singleLine = true,
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = { onScanCard(ScannerInput.CAMERA, state.searchGame) },
                enabled = canScan,
                modifier = Modifier.weight(1f).testTag("addCard.scan"),
            ) {
                Icon(Icons.Default.CameraAlt, null)
                Text(" Scan card")
            }
            OutlinedButton(
                onClick = { onScanCard(ScannerInput.PHOTO_LIBRARY, state.searchGame) },
                enabled = canScan,
                modifier = Modifier.weight(1f).testTag("addCard.photo"),
            ) {
                Icon(Icons.Default.PhotoLibrary, null)
                Text(" Choose photo")
            }
        }
        if (!canScan) {
            Text("Scanning isn’t available for the selected game. You can still search by name.", style = MaterialTheme.typography.bodySmall)
        }
        LazyRow(
            Modifier.fillMaxWidth().padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item { FilterChip(state.searchGame == null, { viewModel.setSearchGame(null) }, { Text("All") }) }
            items(games, key = { it }) { game ->
                FilterChip(state.searchGame == game, { viewModel.setSearchGame(game) }, { Text(packageLabels[game] ?: "${game.displayGame()} · TCGer") })
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { showingFilters = true }, modifier = Modifier.weight(1f)) {
                Icon(Icons.Default.FilterList, null)
                Text(" Filters${if (filters.activeCount > 0) " (${filters.activeCount})" else ""}")
            }
            OutlinedButton(onClick = viewModel::discoverCards, enabled = !state.searchCollectionOnly, modifier = Modifier.weight(1f)) {
                Icon(Icons.Default.Casino, null)
                Text(" Discover")
            }
        }
        }
        if (state.isSearching) item { LoadingPane() }
        else if (state.searchQuery.length >= 2 && state.searchResults.isEmpty()) { item {
            EmptyPane("No matches", if (state.preferences.dataSourceMode == DataSourceMode.ON_DEVICE) "Try another name or download a game library in Settings → Games. You can also add a card manually." else "Try another name or game.")
            if (state.preferences.dataSourceMode == DataSourceMode.ON_DEVICE && state.binders.isNotEmpty()) {
                Button(onClick = { selectedCard = viewModel.manualCard() }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Add, null)
                    Text(" Add “${state.searchQuery.trim()}” manually")
                }
            }
        } } else if (state.searchResults.isNotEmpty() && filteredResults.isEmpty()) {
            item { EmptyPane("No filtered matches", "Clear or broaden the advanced filters.") }
        } else {
            items(filteredResults, key = { "${it.tcg}:${it.id}" }) { card ->
                CatalogCardRow(card, showCardNumbers = state.preferences.showCardNumbers) {
                    TextButton(onClick = { viewModel.openCatalogCard(card) }) { Text("View") }
                    IconButton(onClick = { selectedCard = card }) { Icon(Icons.Default.Add, "Add ${card.name}") }
                }
            }
        }
    }

    selectedCard?.let { card ->
        AddCardDialog(
            card = card,
            state = state,
            onDismiss = { selectedCard = null },
            onBinder = { binderId -> viewModel.addCard(binderId, card); selectedCard = null },
            onWishlist = { wishlistId -> viewModel.addWishlistCard(wishlistId, card); selectedCard = null },
            initialBinderId = initialBinderId,
        )
    }
    if (showingFilters) {
        SearchFiltersDialog(
            game = state.searchGame,
            initial = filters,
            resultCards = state.searchResults,
            onDismiss = { showingFilters = false },
            onApply = { filters = it; showingFilters = false },
        )
    }
}

private data class CardSearchFilters(
    val set: String = "",
    val rarity: String = "",
    val collectorNumber: String = "",
    val artist: String = "",
    val rulesText: String = "",
    val minimumStat: String = "",
    val maximumStat: String = "",
) {
    val activeCount: Int get() = listOf(set, rarity, collectorNumber, artist, rulesText, minimumStat, maximumStat).count(String::isNotBlank)

    fun matches(card: CatalogCard, game: String?): Boolean {
        fun String?.containsQuery(query: String) = query.isBlank() || this?.contains(query.trim(), true) == true
        if (set.isNotBlank() && card.setFilterValue() != set) return false
        if (!card.rarity.containsQuery(rarity)) return false
        if (!card.collectorNumber.containsQuery(collectorNumber)) return false
        if (!card.artist.containsQuery(artist)) return false
        if (rulesText.isNotBlank()) {
            val keys = when (game ?: card.tcg) {
                "magic" -> listOf("oracle_text")
                "yugioh" -> listOf("desc")
                "onepiece" -> listOf("effect")
                "lorcana" -> listOf("body_text")
                "dragonball" -> listOf("skill", "effect")
                else -> listOf("rules", "attacks", "abilities")
            }
            if (keys.flatMap { card.attributes[it].orEmpty() }.none { it.contains(rulesText.trim(), true) }) return false
        }
        val statKey = statKey(game ?: card.tcg)
        if (minimumStat.isNotBlank() || maximumStat.isNotBlank()) {
            val value = statKey?.let { key -> card.attributes[key]?.firstNotNullOfOrNull(String::toDoubleOrNull) } ?: return false
            minimumStat.toDoubleOrNull()?.let { if (value < it) return false }
            maximumStat.toDoubleOrNull()?.let { if (value > it) return false }
        }
        return true
    }
}

private data class ResultSetChoice(
    val value: String,
    val name: String,
    val code: String,
    val tcg: String,
    val symbolUrl: String?,
    val logoUrl: String?,
)

private fun CatalogCard.setFilterValue(): String? {
    val code = setCode?.trim()?.takeIf(String::isNotEmpty) ?: return null
    return "${tcg.lowercase()}::${code.lowercase()}"
}

private fun statKey(game: String?) = when (game) {
    "pokemon" -> "hp"
    "magic" -> "cmc"
    "yugioh" -> "atk"
    "onepiece", "dragonball" -> "power"
    "lorcana" -> "cost"
    else -> null
}

private fun statTitle(game: String?) = when (game) {
    "pokemon" -> "HP"
    "magic" -> "Mana value"
    "yugioh" -> "ATK"
    "onepiece", "dragonball" -> "Power"
    "lorcana" -> "Cost"
    else -> "Game stat"
}

@Composable
private fun SearchFiltersDialog(
    game: String?,
    initial: CardSearchFilters,
    resultCards: List<CatalogCard>,
    onDismiss: () -> Unit,
    onApply: (CardSearchFilters) -> Unit,
) {
    var draft by remember(initial) { mutableStateOf(initial) }
    var setMenuExpanded by remember { mutableStateOf(false) }
    val setChoices = resultCards
        .filter { draft.copy(set = "").matches(it, game) }
        .mapNotNull { card ->
            val value = card.setFilterValue() ?: return@mapNotNull null
            ResultSetChoice(
                value = value,
                name = card.setName ?: card.setCode.orEmpty(),
                code = card.setCode.orEmpty(),
                tcg = card.tcg,
                symbolUrl = card.setSymbolUrl,
                logoUrl = card.setLogoUrl,
            )
        }
        .distinctBy(ResultSetChoice::value)
        .sortedWith(compareBy(ResultSetChoice::tcg, ResultSetChoice::name))
    val selectedSet = setChoices.firstOrNull { it.value == draft.set }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Advanced filters") },
        text = {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Set", style = MaterialTheme.typography.labelMedium)
                        Box {
                            OutlinedButton(
                                onClick = { setMenuExpanded = true },
                                modifier = Modifier.fillMaxWidth(),
                                enabled = setChoices.isNotEmpty(),
                            ) {
                                selectedSet?.let { set ->
                                    AsyncImage(
                                        model = set.symbolUrl ?: set.logoUrl,
                                        contentDescription = null,
                                        modifier = Modifier.size(28.dp),
                                    )
                                }
                                Column(
                                    modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
                                    horizontalAlignment = Alignment.Start,
                                ) {
                                    Text(
                                        selectedSet?.name ?: if (resultCards.isEmpty()) "Search first to choose a set" else "Any set in this search",
                                        color = MaterialTheme.colorScheme.onSurface,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    selectedSet?.let { set ->
                                        Text(
                                            set.code.uppercase(),
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            }
                            DropdownMenu(
                                expanded = setMenuExpanded,
                                onDismissRequest = { setMenuExpanded = false },
                            ) {
                                DropdownMenuItem(
                                    text = {
                                        Column {
                                            Text("Any set", color = MaterialTheme.colorScheme.onSurface)
                                            Text(
                                                "All sets in this search",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    },
                                    onClick = {
                                        draft = draft.copy(set = "")
                                        setMenuExpanded = false
                                    },
                                )
                                setChoices.forEach { set ->
                                    DropdownMenuItem(
                                        leadingIcon = {
                                            AsyncImage(
                                                model = set.symbolUrl ?: set.logoUrl,
                                                contentDescription = null,
                                                modifier = Modifier.size(28.dp),
                                            )
                                        },
                                        text = {
                                            Column {
                                                Text(
                                                    set.name,
                                                    color = MaterialTheme.colorScheme.onSurface,
                                                    fontWeight = FontWeight.Medium,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis,
                                                )
                                                Text(
                                                    "${set.code.uppercase()} · ${set.tcg.displayGame()}",
                                                    style = MaterialTheme.typography.labelSmall,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                )
                                            }
                                        },
                                        onClick = {
                                            draft = draft.copy(set = set.value)
                                            setMenuExpanded = false
                                        },
                                    )
                                }
                            }
                        }
                        Text(
                            if (setChoices.isEmpty()) "Run a search to choose from matching sets." else "${setChoices.size} ${if (setChoices.size == 1) "set" else "sets"} in the current results.",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                item { OutlinedTextField(draft.rarity, { draft = draft.copy(set = "", rarity = it) }, label = { Text("Rarity") }) }
                item { OutlinedTextField(draft.collectorNumber, { draft = draft.copy(set = "", collectorNumber = it) }, label = { Text("Collector number") }) }
                item { OutlinedTextField(draft.artist, { draft = draft.copy(set = "", artist = it) }, label = { Text("Artist / illustrator") }) }
                item { OutlinedTextField(draft.rulesText, { draft = draft.copy(set = "", rulesText = it) }, label = { Text("Rules or card text") }) }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(draft.minimumStat, { draft = draft.copy(set = "", minimumStat = it) }, Modifier.weight(1f), label = { Text("Min ${statTitle(game)}") })
                        OutlinedTextField(draft.maximumStat, { draft = draft.copy(set = "", maximumStat = it) }, Modifier.weight(1f), label = { Text("Max ${statTitle(game)}") })
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onApply(draft) }) { Text("Apply") } },
        dismissButton = {
            Row {
                TextButton(onClick = { draft = CardSearchFilters() }) { Text("Reset") }
                TextButton(onClick = onDismiss) { Text("Cancel") }
            }
        },
    )
}

@Composable
fun AddCardDialog(
    card: CatalogCard,
    state: AppUiState,
    onDismiss: () -> Unit,
    onBinder: (String) -> Unit,
    onWishlist: (String) -> Unit,
    initialBinderId: String? = null,
) {
    val targetBinder = state.binders.firstOrNull { it.id == initialBinderId }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add ${card.name}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                targetBinder?.let { Text("Binder: ${it.name}", fontWeight = FontWeight.SemiBold) }
                if (state.binders.isEmpty() && state.wishlists.isEmpty()) Text("Create a binder or wishlist first.")
                state.binders.filterNot { it.id == targetBinder?.id }.forEach { binder ->
                    AssistChip(onClick = { onBinder(binder.id) }, label = { Text("Binder: ${binder.name}") })
                }
                state.wishlists.forEach { wishlist ->
                    AssistChip(onClick = { onWishlist(wishlist.id) }, label = { Text("Wishlist: ${wishlist.name}") })
                }
            }
        },
        confirmButton = {
            targetBinder?.let { binder ->
                TextButton(onClick = { onBinder(binder.id) }) { Text("Add to ${binder.name}") }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
