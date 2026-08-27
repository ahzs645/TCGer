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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.ui.AppUiState
import com.ahmadjalil.tcger.generated.ParityControlIDs
import com.ahmadjalil.tcger.generated.ParityFeatureIDs

@Composable
fun WishlistsScreen(
    state: AppUiState,
    contentPadding: PaddingValues,
    onCreate: (String) -> Unit,
    onDelete: (String) -> Unit,
) {
    var creating by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().testTag(ParityFeatureIDs.screen(ParityFeatureIDs.WISHLISTS_BROWSE)).padding(
            start = 16.dp,
            end = 16.dp,
            top = contentPadding.calculateTopPadding() + 20.dp,
            bottom = contentPadding.calculateBottomPadding(),
        ),
    ) {
        ScreenTitle("Wishlists", "Cards you're hunting for") {
            FloatingActionButton(
                onClick = { creating = true },
                modifier = Modifier.testTag(ParityControlIDs.ACTION_WISHLISTS_CREATE),
            ) { Icon(Icons.Default.Add, "New wishlist") }
        }
        if (state.isLoading) LoadingPane()
        else if (state.wishlists.isEmpty()) EmptyPane("No wishlists yet", "Create a wishlist, then add cards from Search.")
        else LazyColumn(
            Modifier.fillMaxSize().padding(top = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            items(state.wishlists, key = { it.id }) { wishlist ->
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
                    Column(Modifier.fillMaxWidth().padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Favorite, null, tint = MaterialTheme.colorScheme.primary)
                            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                                Text(wishlist.name, fontWeight = FontWeight.SemiBold)
                                Text("${wishlist.ownedCards} of ${wishlist.cards.size} owned", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            IconButton(onClick = { onDelete(wishlist.id) }) { Icon(Icons.Default.Delete, "Delete ${wishlist.name}") }
                        }
                        LinearProgressIndicator(
                            progress = { wishlist.completionPercent / 100f },
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        )
                        if (wishlist.cards.isNotEmpty()) {
                            Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                wishlist.cards.take(4).forEach { card ->
                                    Text("• ${card.card.name}${if (card.ownedQuantity > 0) " — owned" else ""}")
                                }
                                if (wishlist.cards.size > 4) Text("+ ${wishlist.cards.size - 4} more", color = MaterialTheme.colorScheme.primary)
                            }
                        }
                    }
                }
            }
        }
    }
    if (creating) NameDialog(
        title = "New wishlist",
        label = "Wishlist name",
        onDismiss = { creating = false },
        inputTestId = ParityControlIDs.INPUT_WISHLISTS_NAME,
        confirmTestId = ParityControlIDs.ACTION_WISHLISTS_CONFIRM_CREATE,
    ) {
        onCreate(it)
        creating = false
    }
}
