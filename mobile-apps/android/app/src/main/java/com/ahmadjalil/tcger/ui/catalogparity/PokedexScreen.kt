package com.ahmadjalil.tcger.ui.catalogparity

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

data class PokedexCatalogLoadResult(
    val cards: List<CatalogParityCard>,
    val failedSetIds: List<String>,
)

class PokedexCatalogLoader(private val dataSource: CatalogParityDataSource) {
    suspend fun load(gameIds: Set<String> = setOf("pokemon")): PokedexCatalogLoadResult {
        val sets = gameIds.flatMap { gameId -> dataSource.sets(gameId).sets }
        val cards = mutableListOf<CatalogParityCard>()
        val failures = mutableListOf<String>()
        // Bound parallelism without introducing a second networking stack.
        sets.chunked(4).forEach { batch ->
            coroutineScope {
                batch.map { set ->
                    async { set to runCatching { dataSource.setCards(set.tcg, set.code) } }
                }.awaitAll()
            }.forEach { (set, result) ->
                result.onSuccess(cards::addAll).onFailure { failures += set.id }
            }
        }
        return PokedexCatalogLoadResult(cards.distinctBy { "${it.tcg}:${it.id}" }, failures)
    }
}

/** Server/on-device loading wrapper for integrations that do not already own a catalog snapshot. */
@Composable
fun LoadedPokedexScreen(
    dataSource: CatalogParityDataSource,
    ownedCards: List<OwnedPrinting>,
    gameIds: Set<String> = setOf("pokemon"),
    nationalDex: List<PokedexEntry> = emptyList(),
    contentPadding: PaddingValues = PaddingValues(),
    onOpenSpecies: (PokedexSpeciesProgress) -> Unit,
) {
    var catalogCards by remember(dataSource, gameIds) { mutableStateOf<List<CatalogParityCard>>(emptyList()) }
    var loading by remember(dataSource, gameIds) { mutableStateOf(true) }
    var error by remember(dataSource, gameIds) { mutableStateOf<String?>(null) }
    var warning by remember(dataSource, gameIds) { mutableStateOf<String?>(null) }
    var reload by remember { mutableStateOf(0) }
    LaunchedEffect(dataSource, gameIds, reload) {
        loading = true; error = null; warning = null
        runCatching { PokedexCatalogLoader(dataSource).load(gameIds) }
            .onSuccess { result ->
                catalogCards = result.cards
                if (result.failedSetIds.isNotEmpty()) warning = "Some compatible sets are unavailable; progress is based on the available catalog."
            }
            .onFailure { error = it.message ?: "The Pokédex catalog could not be loaded." }
        loading = false
    }
    when {
        loading -> Column(
            Modifier.fillMaxSize().padding(top = contentPadding.calculateTopPadding() + 72.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) { CircularProgressIndicator(); Text("Building your Pokédex…") }
        error != null && catalogCards.isEmpty() -> Column(
            Modifier.fillMaxSize().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Pokédex unavailable", style = MaterialTheme.typography.headlineSmall)
            Text(error.orEmpty(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button({ reload++ }, Modifier.padding(top = 12.dp)) { Text("Try again") }
        }
        else -> Column {
            warning?.let { Text(it, Modifier.fillMaxWidth().padding(12.dp), color = MaterialTheme.colorScheme.error) }
            PokedexScreen(catalogCards, ownedCards, nationalDex, contentPadding, onOpenSpecies)
        }
    }
}

@Composable
fun PokedexScreen(
    catalogCards: List<CatalogParityCard>,
    ownedCards: List<OwnedPrinting>,
    nationalDex: List<PokedexEntry> = emptyList(),
    contentPadding: PaddingValues = PaddingValues(),
    onOpenSpecies: (PokedexSpeciesProgress) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf(PokedexOwnershipFilter.ALL) }
    var generation by remember { mutableStateOf<PokedexGeneration?>(null) }
    val species = remember(catalogCards, ownedCards, nationalDex) {
        PokedexProgressBuilder.build(catalogCards, ownedCards, nationalDex)
    }
    val progressSpecies = remember(species, generation) { species.filter { generation?.range?.contains(it.entry.number) ?: true } }
    val ownedCount = progressSpecies.count(PokedexSpeciesProgress::isOwned)
    val visible = remember(progressSpecies, query, filter) {
        progressSpecies.filter { item ->
            (query.isBlank() || item.entry.name.contains(query.trim(), true) || item.entry.number.toString().contains(query.trim())) &&
                when (filter) {
                    PokedexOwnershipFilter.ALL -> true
                    PokedexOwnershipFilter.OWNED -> item.isOwned
                    PokedexOwnershipFilter.MISSING -> !item.isOwned
                }
        }
    }

    if (species.isEmpty()) {
        Column(
            Modifier.fillMaxSize().padding(
                start = 24.dp, end = 24.dp,
                top = contentPadding.calculateTopPadding() + 72.dp,
                bottom = contentPadding.calculateBottomPadding(),
            ),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Pokédex unavailable", style = MaterialTheme.typography.headlineSmall)
            Text(
                "Install and enable the Pokémon catalog in Settings to track species completion.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }

    Column(
        Modifier.fillMaxSize().padding(
            top = contentPadding.calculateTopPadding() + 16.dp,
            bottom = contentPadding.calculateBottomPadding(),
        ),
    ) {
        Text("Pokédex", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Card(
            Modifier.fillMaxWidth().padding(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth()) {
                    Text("Species collected", fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    Text("$ownedCount / ${progressSpecies.size}", fontWeight = FontWeight.SemiBold)
                }
                LinearProgressIndicator(
                    progress = { if (progressSpecies.isEmpty()) 0f else ownedCount.toFloat() / progressSpecies.size },
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "A species counts as owned when any of its Pokémon card printings is in your collection.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        OutlinedTextField(
            query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            label = { Text("Name or Pokédex number") }, singleLine = true,
        )
        LazyRow(
            Modifier.padding(top = 10.dp),
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(PokedexOwnershipFilter.entries) { value ->
                FilterChip(filter == value, { filter = value }, label = { Text(value.title) })
            }
        }
        LazyRow(
            Modifier.padding(bottom = 8.dp),
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item { FilterChip(generation == null, { generation = null }, label = { Text("All regions") }) }
            items(PokedexGeneration.all) { value ->
                FilterChip(generation == value, { generation = value }, label = { Text(value.name) })
            }
        }
        if (visible.isEmpty()) {
            Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text("No species found", style = MaterialTheme.typography.titleMedium)
                Text("Try another search or filter.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else LazyVerticalGrid(
            columns = GridCells.Adaptive(104.dp),
            modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainerLowest),
            contentPadding = PaddingValues(12.dp, 8.dp, 12.dp, 24.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(visible, key = { it.entry.number }) { item -> PokedexTile(item, onOpenSpecies) }
        }
    }
}

@Composable
private fun PokedexTile(item: PokedexSpeciesProgress, onOpen: (PokedexSpeciesProgress) -> Unit) {
    Card(
        Modifier.fillMaxWidth().clickable { onOpen(item) },
        colors = CardDefaults.cardColors(
            containerColor = if (item.isOwned) Color(0xFF2E7D32).copy(alpha = .09f)
            else MaterialTheme.colorScheme.surfaceContainerLow,
        ),
    ) {
        Column(Modifier.padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box {
                AsyncImage(
                    item.artworkUrl, item.entry.name,
                    Modifier.fillMaxWidth().height(100.dp).alpha(if (item.isOwned) 1f else .45f),
                    contentScale = ContentScale.Fit,
                )
                Icon(
                    if (item.isOwned) Icons.Default.CheckCircle else Icons.Outlined.Circle,
                    contentDescription = if (item.isOwned) "Owned" else "Missing",
                    tint = if (item.isOwned) Color(0xFF2E7D32) else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.align(Alignment.TopEnd),
                )
            }
            Text("#${item.entry.number}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(item.entry.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun PokedexSpeciesDetailScreen(
    species: PokedexSpeciesProgress,
    contentPadding: PaddingValues = PaddingValues(),
    onBack: () -> Unit,
    onCardSelected: (CatalogParityCard) -> Unit,
) {
    Column(
        Modifier.fillMaxSize().padding(top = contentPadding.calculateTopPadding(), bottom = contentPadding.calculateBottomPadding()),
    ) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onBack) { Icon(Icons.Default.ArrowBack, "Back") }
            Column(Modifier.weight(1f)) {
                Text("#${species.entry.number} ${species.entry.name}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(
                    if (species.isOwned) "Owned: ${species.ownedCopies}" else "Not collected yet",
                    color = if (species.isOwned) Color(0xFF2E7D32) else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text("${species.printings.size} printings", style = MaterialTheme.typography.labelMedium)
        }
        if (species.printings.isEmpty()) {
            Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text("No catalog printings available")
            }
        } else LazyVerticalGrid(
            GridCells.Adaptive(132.dp), Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            items(species.printings, key = CatalogParityCard::id) { card ->
                Column(Modifier.clickable { onCardSelected(card) }) {
                    AsyncImage(
                        card.imageUrl ?: card.imageUrlSmall, card.name,
                        Modifier.fillMaxWidth().height(184.dp).background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(10.dp)),
                        contentScale = ContentScale.Fit,
                    )
                    Text(card.setName ?: card.setCode ?: "Unknown set", fontWeight = FontWeight.SemiBold, maxLines = 1)
                    Text(card.collectorNumber.orEmpty(), style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}
