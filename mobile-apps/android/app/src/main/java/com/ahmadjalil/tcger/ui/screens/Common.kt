package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BrokenImage
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.ahmadjalil.tcger.domain.CatalogCard
import java.text.NumberFormat
import java.util.Currency

@Composable
fun ScreenTitle(title: String, subtitle: String? = null, trailing: @Composable (() -> Unit)? = null) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            subtitle?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        trailing?.invoke()
    }
}

@Composable
fun LoadingPane() {
    Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
fun EmptyPane(title: String, body: String) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 48.dp, horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        Text(body, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun CardArtwork(card: CatalogCard, modifier: Modifier = Modifier) {
    if (card.imageUrl != null) {
        AsyncImage(
            model = card.imageUrl,
            contentDescription = card.name,
            modifier = modifier.clip(RoundedCornerShape(8.dp)),
            contentScale = ContentScale.Crop,
        )
    } else {
        Box(
            modifier.clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center,
        ) {
            androidx.compose.material3.Icon(Icons.Default.BrokenImage, contentDescription = null)
        }
    }
}

@Composable
fun CatalogCardRow(
    card: CatalogCard,
    showCardNumbers: Boolean = true,
    trailing: @Composable (() -> Unit)? = null,
) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            CardArtwork(card, Modifier.size(width = 52.dp, height = 72.dp))
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(card.name, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(card.setName, card.collectorNumber.takeIf { showCardNumbers })
                        .joinToString(" · ").ifBlank { card.tcg.displayGame() },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                card.rarity?.let { Text(it, style = MaterialTheme.typography.labelSmall) }
            }
            trailing?.invoke()
        }
    }
}

fun String.displayGame(): String = when (this) {
    "pokemon" -> "Pokémon"
    "magic" -> "Magic"
    "yugioh" -> "Yu-Gi-Oh!"
    "onepiece" -> "One Piece"
    "lorcana" -> "Lorcana"
    "dragonball" -> "Dragon Ball"
    else -> replaceFirstChar { it.uppercase() }
}

fun Double.asCurrency(code: String): String = runCatching {
    NumberFormat.getCurrencyInstance().apply { currency = Currency.getInstance(code) }.format(this)
}.getOrElse { "%.2f %s".format(this, code) }
