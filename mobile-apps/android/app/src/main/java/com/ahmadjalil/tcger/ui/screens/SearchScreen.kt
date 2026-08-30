package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Casino
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.domain.CatalogCard
import com.ahmadjalil.tcger.domain.DataSourceMode
import com.ahmadjalil.tcger.generated.ParityFeatureIDs
import com.ahmadjalil.tcger.ui.AppUiState
import com.ahmadjalil.tcger.ui.AppViewModel

@Composable
fun SearchScreen(state: AppUiState, contentPadding: PaddingValues, viewModel: AppViewModel) {
    var selectedCard by remember { mutableStateOf<CatalogCard?>(null) }
    var appliedDefaultGame by remember { mutableStateOf(false) }
    var showingFilters by remember { mutableStateOf(false) }
    var filters by remember { mutableStateOf(CardSearchFilters()) }
    val games = listOf("pokemon", "magic", "yugioh", "onepiece", "lorcana", "dragonball")
        .filter { it in state.preferences.enabledGames }
    val filteredResults = state.searchResults.filter { filters.matches(it, state.searchGame) }

    LaunchedEffect(state.preferences.defaultGame, games) {
        val defaultGame = state.preferences.defaultGame
        if (!appliedDefaultGame && defaultGame != null && defaultGame in games) {
            viewModel.setSearchGame(defaultGame)
            appliedDefaultGame = true
        }
    }

    Column(
        Modifier.fillMaxSize().testTag(ParityFeatureIDs.screen(ParityFeatureIDs.CARDS_SEARCH)).padding(
            start = 16.dp,
            end = 16.dp,
            top = contentPadding.calculateTopPadding() + 20.dp,
            bottom = contentPadding.calculateBottomPadding(),
        ),
    ) {
        ScreenTitle("Card search", if (state.preferences.dataSourceMode == DataSourceMode.ON_DEVICE) "Search cards already saved on this device" else "Search the connected TCGer catalog")
        OutlinedTextField(
            value = state.searchQuery,
            onValueChange = viewModel::setSearchQuery,
            modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
            leadingIcon = { Icon(Icons.Default.Search, null) },
            label = { Text("Name or card number") },
            singleLine = true,
        )
        LazyRow(
            Modifier.fillMaxWidth().padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item { FilterChip(state.searchGame == null, { viewModel.setSearchGame(null) }, { Text("All") }) }
            items(games) { game ->
                FilterChip(state.searchGame == game, { viewModel.setSearchGame(game) }, { Text(game.displayGame()) })
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { showingFilters = true }, modifier = Modifier.weight(1f)) {
                Icon(Icons.Default.FilterList, null)
                Text(" Filters${if (filters.activeCount > 0) " (${filters.activeCount})" else ""}")
            }
            OutlinedButton(onClick = viewModel::discoverCards, modifier = Modifier.weight(1f)) {
                Icon(Icons.Default.Casino, null)
                Text(" Discover")
            }
        }
        if (state.isSearching) LoadingPane()
        else if (state.searchQuery.length >= 2 && state.searchResults.isEmpty()) {
            EmptyPane("No matches", if (state.preferences.dataSourceMode == DataSourceMode.ON_DEVICE) "Add a manual card below, or connect to a server for catalog search." else "Try another name or game.")
            if (state.preferences.dataSourceMode == DataSourceMode.ON_DEVICE && state.binders.isNotEmpty()) {
                Button(onClick = { selectedCard = viewModel.manualCard() }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Add, null)
                    Text(" Add “${state.searchQuery.trim()}” manually")
                }
            }
        } else if (state.searchResults.isNotEmpty() && filteredResults.isEmpty()) {
            EmptyPane("No filtered matches", "Clear or broaden the advanced filters.")
        } else LazyColumn(
            Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            items(filteredResults, key = { "${it.tcg}:${it.id}" }) { card ->
                CatalogCardRow(card, showCardNumbers = state.preferences.showCardNumbers) {
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
        )
    }
    if (showingFilters) {
        SearchFiltersDialog(
            game = state.searchGame,
            initial = filters,
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
        if (!(card.setName.containsQuery(set) || card.setCode.containsQuery(set))) return false
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
    onDismiss: () -> Unit,
    onApply: (CardSearchFilters) -> Unit,
) {
    var draft by remember(initial) { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Advanced filters") },
        text = {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item { OutlinedTextField(draft.set, { draft = draft.copy(set = it) }, label = { Text("Set name or code") }) }
                item { OutlinedTextField(draft.rarity, { draft = draft.copy(rarity = it) }, label = { Text("Rarity") }) }
                item { OutlinedTextField(draft.collectorNumber, { draft = draft.copy(collectorNumber = it) }, label = { Text("Collector number") }) }
                item { OutlinedTextField(draft.artist, { draft = draft.copy(artist = it) }, label = { Text("Artist / illustrator") }) }
                item { OutlinedTextField(draft.rulesText, { draft = draft.copy(rulesText = it) }, label = { Text("Rules or card text") }) }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(draft.minimumStat, { draft = draft.copy(minimumStat = it) }, Modifier.weight(1f), label = { Text("Min ${statTitle(game)}") })
                        OutlinedTextField(draft.maximumStat, { draft = draft.copy(maximumStat = it) }, Modifier.weight(1f), label = { Text("Max ${statTitle(game)}") })
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
private fun AddCardDialog(
    card: CatalogCard,
    state: AppUiState,
    onDismiss: () -> Unit,
    onBinder: (String) -> Unit,
    onWishlist: (String) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add ${card.name}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (state.binders.isEmpty() && state.wishlists.isEmpty()) Text("Create a binder or wishlist first.")
                state.binders.forEach { binder ->
                    AssistChip(onClick = { onBinder(binder.id) }, label = { Text("Binder: ${binder.name}") })
                }
                state.wishlists.forEach { wishlist ->
                    AssistChip(onClick = { onWishlist(wishlist.id) }, label = { Text("Wishlist: ${wishlist.name}") })
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
