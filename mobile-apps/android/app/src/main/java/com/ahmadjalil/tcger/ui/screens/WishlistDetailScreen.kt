package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.domain.Wishlist
import com.ahmadjalil.tcger.domain.WishlistInput

private enum class WishlistOwnershipFilter(val label: String) { ALL("All"), OWNED("Owned"), NEEDED("Needed") }

@Composable
fun WishlistDetailScreen(
    wishlist: Wishlist?,
    contentPadding: PaddingValues,
    showCardNumbers: Boolean,
    onBack: () -> Unit,
    onAddCards: () -> Unit,
    onUpdate: (String, WishlistInput) -> Unit,
    onRemoveCard: (String, String) -> Unit,
) {
    if (wishlist == null) {
        EmptyPane("Wishlist unavailable", "It may have been removed or is still loading.")
        return
    }
    var editing by remember(wishlist.id) { mutableStateOf(false) }
    var query by remember(wishlist.id) { mutableStateOf("") }
    var filter by remember(wishlist.id) { mutableStateOf(WishlistOwnershipFilter.ALL) }
    val visibleCards = wishlist.cards.filter { entry ->
        val matchesQuery = query.isBlank() || entry.card.name.contains(query, ignoreCase = true) ||
            entry.card.setName?.contains(query, ignoreCase = true) == true
        val matchesOwnership = when (filter) {
            WishlistOwnershipFilter.ALL -> true
            WishlistOwnershipFilter.OWNED -> entry.ownedQuantity > 0
            WishlistOwnershipFilter.NEEDED -> entry.ownedQuantity == 0
        }
        matchesQuery && matchesOwnership
    }

    Column(
        Modifier.fillMaxSize().padding(
            start = 16.dp,
            end = 16.dp,
            top = contentPadding.calculateTopPadding() + 12.dp,
            bottom = contentPadding.calculateBottomPadding(),
        ),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Column(Modifier.weight(1f)) {
                Text(wishlist.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    "${wishlist.ownedCards} of ${wishlist.cards.size} owned · ${wishlist.completionPercent}%",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                wishlist.description?.takeIf(String::isNotBlank)?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (wishlist.matchAnyPrinting) {
                    Text(
                        "Any printing counts as owned",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
            IconButton(onClick = { editing = true }) { Icon(Icons.Default.Edit, "Edit wishlist") }
        }
        LinearProgressIndicator(
            progress = { wishlist.completionPercent / 100f },
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        )
        Button(onClick = onAddCards, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
            Icon(Icons.Default.Add, null)
            Text(" Add cards")
        }
        if (wishlist.cards.isNotEmpty()) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                label = { Text("Search this wishlist") },
                leadingIcon = { Icon(Icons.Default.Search, null) },
                singleLine = true,
            )
            Row(
                Modifier.fillMaxWidth().padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                WishlistOwnershipFilter.entries.forEach { option ->
                    FilterChip(
                        selected = filter == option,
                        onClick = { filter = option },
                        label = { Text(option.label) },
                    )
                }
            }
        }
        when {
            wishlist.cards.isEmpty() -> EmptyPane("No cards in this wishlist", "Use Add cards to search the catalog.")
            visibleCards.isEmpty() -> EmptyPane("No cards match", "Try a different search or ownership filter.")
            else -> LazyColumn(
                Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = PaddingValues(bottom = 24.dp),
            ) {
                items(visibleCards, key = { it.id }) { entry ->
                    CatalogCardRow(entry.card, showCardNumbers = showCardNumbers) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(horizontalAlignment = Alignment.End) {
                                Text("Want ${entry.desiredQuantity}", style = MaterialTheme.typography.labelMedium)
                                Text(
                                    if (entry.ownedQuantity > 0) "Own ${entry.ownedQuantity}" else "Needed",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (entry.ownedQuantity > 0) MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            IconButton(onClick = { onRemoveCard(wishlist.id, entry.id) }) {
                                Icon(Icons.Default.Delete, "Remove ${entry.card.name}")
                            }
                        }
                    }
                }
            }
        }
    }

    if (editing) WishlistEditorDialog(
        title = "Edit wishlist",
        confirmLabel = "Save",
        initial = wishlist,
        onDismiss = { editing = false },
        onConfirm = {
            onUpdate(wishlist.id, it)
            editing = false
        },
    )
}
