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
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.domain.Binder

@Composable
fun BinderDetailScreen(
    binder: Binder?,
    contentPadding: PaddingValues,
    showPricing: Boolean,
    currency: String,
    onBack: () -> Unit,
    onRemove: (String, String) -> Unit,
) {
    if (binder == null) {
        EmptyPane("Binder unavailable", "It may have been removed or is still loading.")
        return
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
                Text(binder.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    "${binder.uniqueCards} unique · ${binder.totalCopies} copies" +
                        if (showPricing) " · ${binder.totalValue.asCurrency(currency)}" else "",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (binder.cards.isEmpty()) EmptyPane("This binder is empty", "Use Search to find a card, then add it to this binder.")
        else LazyColumn(
            Modifier.fillMaxSize().padding(top = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            items(binder.cards, key = { it.id }) { owned ->
                CatalogCardRow(owned.card) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("×${owned.quantity}", fontWeight = FontWeight.Bold)
                        IconButton(onClick = { onRemove(binder.id, owned.id) }) {
                            Icon(Icons.Default.Delete, "Remove ${owned.card.name}")
                        }
                    }
                }
            }
        }
    }
}
