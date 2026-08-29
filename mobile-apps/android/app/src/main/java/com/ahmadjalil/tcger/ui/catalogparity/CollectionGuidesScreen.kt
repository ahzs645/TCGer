package com.ahmadjalil.tcger.ui.catalogparity

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage

@Composable
fun CollectionGuidesScreen(
    dataSource: CatalogParityDataSource,
    enabledGames: Set<String>,
    contentPadding: PaddingValues = PaddingValues(),
    onOpenGuide: (CollectionGuide) -> Unit,
) {
    var guides by remember { mutableStateOf<List<CollectionGuide>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var selectedGame by remember { mutableStateOf<String?>(null) }
    var selectedCategory by remember { mutableStateOf<GuideCategory?>(null) }
    var reload by remember { mutableStateOf(0) }
    LaunchedEffect(reload) {
        loading = true; error = null
        runCatching { dataSource.guides() }
            .onSuccess { guides = it }
            .onFailure { error = it.message ?: "Collection guides could not be loaded." }
        loading = false
    }
    val enabled = enabledGames.mapTo(hashSetOf(), String::lowercase)
    val visible = remember(guides, query, selectedGame, selectedCategory, enabled) {
        guides.filter { guide ->
            guide.tcg.lowercase() in enabled &&
                (selectedGame == null || guide.tcg.equals(selectedGame, true)) &&
                (selectedCategory == null || guide.category == selectedCategory) &&
                (query.isBlank() || guide.title.contains(query.trim(), true) ||
                    guide.description.contains(query.trim(), true) || guide.tags.any { it.contains(query.trim(), true) })
        }.sortedWith(compareByDescending<CollectionGuide> { it.featured }.thenBy { it.title })
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            16.dp, contentPadding.calculateTopPadding() + 20.dp,
            16.dp, contentPadding.calculateBottomPadding() + 24.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Collection Guides", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    Text("Curated collecting goals that stay current", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton({ reload++ }) { Icon(Icons.Default.Refresh, "Refresh guides") }
            }
        }
        item { OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), label = { Text("Search guides") }, singleLine = true) }
        if (enabledGames.size > 1) item {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item { FilterChip(selectedGame == null, { selectedGame = null }, label = { Text("All games") }) }
                items(enabledGames.sorted()) { game -> FilterChip(selectedGame == game, { selectedGame = game }, label = { Text(game.gameDisplayName()) }) }
            }
        }
        item {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item { FilterChip(selectedCategory == null, { selectedCategory = null }, label = { Text("All themes") }) }
                items(GuideCategory.entries) { category ->
                    FilterChip(selectedCategory == category, { selectedCategory = category }, label = { Text(category.label) })
                }
            }
        }
        when {
            loading -> item { CenterStatus { CircularProgressIndicator(); Text("Loading guides…") } }
            error != null -> item { CenterStatus { Text("Couldn't load guides", fontWeight = FontWeight.SemiBold); Text(error.orEmpty()); Button({ reload++ }) { Text("Try again") } } }
            visible.isEmpty() -> item { CenterStatus { Text("No guides found"); Text("Try another search, game, or theme.") } }
            else -> items(visible, key = CollectionGuide::id) { guide -> GuideRow(guide, onOpenGuide) }
        }
    }
}

@Composable
private fun GuideRow(guide: CollectionGuide, onOpen: (CollectionGuide) -> Unit) {
    Card(
        Modifier.fillMaxWidth().clickable { onOpen(guide) },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            AsyncImage(
                guide.coverImageUrl, guide.title, Modifier.size(74.dp),
                contentScale = ContentScale.Crop,
            )
            Column(Modifier.weight(1f).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(guide.title, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (guide.followed) Icon(Icons.Default.CheckCircle, "Following", tint = MaterialTheme.colorScheme.primary)
                }
                Text("${guide.tcg.gameDisplayName()} · ${guide.category.label}", style = MaterialTheme.typography.labelSmall)
                Text(guide.description, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                Text("${guide.cardCountHint?.let { "$it cards · " }.orEmpty()}Curated by ${guide.curatorName}", style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable
fun CollectionGuideDetailScreen(
    initialGuide: CollectionGuide,
    dataSource: CatalogParityDataSource,
    contentPadding: PaddingValues = PaddingValues(),
    onBack: () -> Unit,
    onCardSelected: (CatalogParityCard) -> Unit,
    onFollowed: (FollowGuideResponse) -> Unit = {},
) {
    var guide by remember(initialGuide.id) { mutableStateOf(initialGuide) }
    var results by remember(initialGuide.id) { mutableStateOf<List<GuideCardResult>>(emptyList()) }
    var loading by remember(initialGuide.id) { mutableStateOf(true) }
    var error by remember(initialGuide.id) { mutableStateOf<String?>(null) }
    var query by remember(initialGuide.id) { mutableStateOf("") }
    var ownership by remember { mutableStateOf(PokedexOwnershipFilter.ALL) }
    var reload by remember { mutableStateOf(0) }
    var showFollowDialog by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<String?>(null) }
    var pendingFollowName by remember(initialGuide.id) { mutableStateOf(initialGuide.title) }
    var following by remember { mutableStateOf(false) }

    LaunchedEffect(guide.slug, ownership, reload) {
        loading = true; error = null
        val filters = GuideCardFilters(
            guide = guide.slug,
            ownership = ownership.name.lowercase(),
            limit = 2_000,
        )
        runCatching { dataSource.guideCards(filters) }
            .onSuccess { results = it.results; if (it.failedGuideSlugs.isNotEmpty()) error = "Some guide cards could not be expanded." }
            .onFailure { error = it.message ?: "Guide cards could not be loaded." }
        loading = false
    }
    val visible = results.filter { result ->
        query.isBlank() || result.card.name.contains(query.trim(), true) ||
            result.card.setName?.contains(query.trim(), true) == true || result.card.artist?.contains(query.trim(), true) == true
    }
    val ownedCount = results.count(GuideCardResult::owned)
    Column(
        Modifier.fillMaxSize().padding(
            top = contentPadding.calculateTopPadding(), bottom = contentPadding.calculateBottomPadding(),
        ),
    ) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onBack) { Icon(Icons.Default.ArrowBack, "Back") }
            Column(Modifier.weight(1f)) {
                Text(guide.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("${guide.tcg.gameDisplayName()} · ${guide.category.label}", style = MaterialTheme.typography.labelMedium)
            }
            if (guide.followed) OutlinedButton({}, enabled = false) { Text("Following") }
            else Button({ showFollowDialog = true }) { Text("Follow") }
        }
        LazyColumn(
            Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Text(guide.description)
                Text("Curated by ${guide.curatorName} · Version ${guide.version}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (results.isNotEmpty()) item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row { Text("Guide completion", Modifier.weight(1f), fontWeight = FontWeight.SemiBold); Text("$ownedCount / ${results.size}") }
                        LinearProgressIndicator({ if (results.isEmpty()) 0f else ownedCount.toFloat() / results.size }, Modifier.fillMaxWidth())
                    }
                }
            }
            status?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.primary) } }
            item { OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), label = { Text("Search guide cards") }, singleLine = true) }
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(PokedexOwnershipFilter.entries) { value ->
                        FilterChip(ownership == value, { ownership = value }, label = { Text(value.title) })
                    }
                }
            }
            when {
                loading -> item { CenterStatus { CircularProgressIndicator(); Text("Expanding guide…") } }
                error != null && results.isEmpty() -> item { CenterStatus { Text(error.orEmpty()); Button({ reload++ }) { Text("Try again") } } }
                visible.isEmpty() -> item { CenterStatus { Text("No guide cards found") } }
                else -> items(visible, key = { "${it.card.tcg}:${it.card.id}" }) { result ->
                    Card(Modifier.fillMaxWidth().clickable { onCardSelected(result.card) }) {
                        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            AsyncImage(result.card.imageUrlSmall ?: result.card.imageUrl, result.card.name, Modifier.size(58.dp), contentScale = ContentScale.Fit)
                            Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                                Text(result.card.name, fontWeight = FontWeight.SemiBold)
                                Text(listOfNotNull(result.card.setName, result.card.collectorNumber, result.card.artist).joinToString(" · "), style = MaterialTheme.typography.labelSmall, maxLines = 2)
                            }
                            Text(if (result.owned) "Owned ${result.ownedQuantity}" else "Missing", style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            }
        }
    }
    if (showFollowDialog) FollowGuideDialog(
        initialName = guide.title,
        onDismiss = { showFollowDialog = false },
        onConfirm = { name ->
            showFollowDialog = false
            pendingFollowName = name
            status = "Creating wishlist…"
            following = true
        },
    )
    if (following) {
        LaunchedEffect(guide.slug, following) {
            runCatching { dataSource.followGuide(guide.slug, pendingFollowName.ifBlank { guide.title }) }
                .onSuccess { response ->
                    guide = response.guide
                    status = if (response.created) "Guide followed. Wishlist created." else "Guide is already followed."
                    onFollowed(response)
                }
                .onFailure { status = it.message ?: "The guide could not be followed." }
            following = false
        }
    }
}

@Composable
private fun FollowGuideDialog(
    initialName: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var name by remember(initialName) { mutableStateOf(initialName) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Follow collection guide") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Following creates a synced wishlist that keeps this collecting goal together.")
                OutlinedTextField(name, { name = it }, label = { Text("Wishlist name") }, singleLine = true)
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(name) },
                enabled = name.isNotBlank(),
            ) { Text("Follow") }
        },
        dismissButton = { TextButton(onDismiss) { Text("Cancel") } },
    )
}
