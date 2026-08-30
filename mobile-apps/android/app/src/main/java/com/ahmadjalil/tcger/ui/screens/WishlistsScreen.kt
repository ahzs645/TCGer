package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.domain.Wishlist
import com.ahmadjalil.tcger.domain.WishlistInput
import com.ahmadjalil.tcger.generated.ParityControlIDs
import com.ahmadjalil.tcger.generated.ParityFeatureIDs
import com.ahmadjalil.tcger.ui.AppUiState

private val wishlistColors = listOf("C43D73") + binderColors

@Composable
fun WishlistsScreen(
    state: AppUiState,
    contentPadding: PaddingValues,
    onCreate: (WishlistInput) -> Unit,
    onDelete: (String) -> Unit,
    onOpen: (String) -> Unit,
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
                WishlistRow(wishlist, onOpen, onDelete)
            }
        }
    }
    if (creating) WishlistEditorDialog(
        title = "New wishlist",
        confirmLabel = "Create",
        onDismiss = { creating = false },
        inputTestId = ParityControlIDs.INPUT_WISHLISTS_NAME,
        confirmTestId = ParityControlIDs.ACTION_WISHLISTS_CONFIRM_CREATE,
        onConfirm = {
            onCreate(it)
            creating = false
        },
    )
}

@Composable
private fun WishlistRow(wishlist: Wishlist, onOpen: (String) -> Unit, onDelete: (String) -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable { onOpen(wishlist.id) },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(42.dp).clip(CircleShape).background(wishlist.colorHex.toComposeColor()),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Default.Favorite, null, tint = Color.White) }
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(wishlist.name, fontWeight = FontWeight.SemiBold)
                    wishlist.description?.takeIf(String::isNotBlank)?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(
                        "${wishlist.ownedCards} of ${wishlist.cards.size} owned",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(onClick = { onDelete(wishlist.id) }) {
                    Icon(Icons.Default.Delete, "Delete ${wishlist.name}")
                }
            }
            LinearProgressIndicator(
                progress = { wishlist.completionPercent / 100f },
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
        }
    }
}

@Composable
@OptIn(ExperimentalComposeUiApi::class)
fun WishlistEditorDialog(
    title: String,
    confirmLabel: String,
    onDismiss: () -> Unit,
    onConfirm: (WishlistInput) -> Unit,
    initial: Wishlist? = null,
    inputTestId: String? = null,
    confirmTestId: String? = null,
) {
    var name by remember(initial?.id) { mutableStateOf(initial?.name.orEmpty()) }
    var description by remember(initial?.id) { mutableStateOf(initial?.description.orEmpty()) }
    var colorHex by remember(initial?.id) { mutableStateOf(initial?.colorHex ?: wishlistColors.first()) }
    var matchAnyPrinting by remember(initial?.id) { mutableStateOf(initial?.matchAnyPrinting ?: false) }

    AlertDialog(
        modifier = Modifier.semantics { testTagsAsResourceId = true },
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    modifier = (if (inputTestId == null) Modifier else Modifier.testTag(inputTestId)).fillMaxWidth(),
                    label = { Text("Wishlist name") },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Description (optional)") },
                    minLines = 2,
                    maxLines = 4,
                )
                Text("Color", style = MaterialTheme.typography.labelLarge)
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    wishlistColors.distinct().forEach { option ->
                        val selected = colorHex.equals(option, ignoreCase = true)
                        Box(
                            Modifier.size(38.dp).clip(CircleShape).background(option.toComposeColor()).then(
                                if (selected) Modifier.border(3.dp, MaterialTheme.colorScheme.onSurface, CircleShape)
                                else Modifier,
                            ).clickable { colorHex = option },
                        )
                    }
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Any printing counts as owned", fontWeight = FontWeight.Medium)
                        Text(
                            "When enabled, another printing of the same card can complete this entry.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(checked = matchAnyPrinting, onCheckedChange = { matchAnyPrinting = it })
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(WishlistInput(name, description, colorHex, matchAnyPrinting)) },
                modifier = if (confirmTestId == null) Modifier else Modifier.testTag(confirmTestId),
                enabled = name.isNotBlank(),
            ) { Text(confirmLabel) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
