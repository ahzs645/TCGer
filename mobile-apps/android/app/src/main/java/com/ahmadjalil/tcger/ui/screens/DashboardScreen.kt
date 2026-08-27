package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Style
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.generated.ParityFeatureIDs
import com.ahmadjalil.tcger.generated.ParityControlIDs

@Composable
fun DashboardScreen(
    state: com.ahmadjalil.tcger.ui.AppUiState,
    contentPadding: PaddingValues,
    onRefresh: () -> Unit,
    onScan: () -> Unit,
    onOpenPacks: () -> Unit,
    onBinder: (String) -> Unit,
) {
    LazyColumn(
        Modifier.fillMaxSize().testTag(ParityFeatureIDs.screen(ParityFeatureIDs.HOME_DASHBOARD)),
        contentPadding = PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = contentPadding.calculateTopPadding() + 20.dp,
            bottom = contentPadding.calculateBottomPadding() + 24.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            ScreenTitle("TCGer", if (state.preferences.dataSourceMode.name == "ON_DEVICE") "On this device" else state.preferences.serverUrl) {
                TextButton(onClick = onRefresh) { Text("Refresh") }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                FilledTonalButton(
                    modifier = Modifier.weight(1f).testTag(ParityControlIDs.ACTION_SCANNER_OPEN),
                    onClick = onScan,
                ) {
                    Icon(Icons.Default.CameraAlt, contentDescription = null)
                    Spacer(Modifier.padding(horizontal = 4.dp))
                    Text("Scan")
                }
                FilledTonalButton(
                    modifier = Modifier.weight(1f).testTag(ParityControlIDs.ACTION_PACK_OPENING_OPEN),
                    onClick = onOpenPacks,
                ) {
                    Icon(Icons.Default.AutoAwesome, contentDescription = null)
                    Spacer(Modifier.padding(horizontal = 4.dp))
                    Text("Open packs")
                }
            }
        }
        if (state.isLoading) item { LoadingPane() }
        else if (state.binders.isEmpty()) item {
            EmptyPane("No binders yet", "Create your first binder from the Binders tab to start organizing your cards.")
        } else {
            item {
                Text("Overview", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatCard("Binders", state.stats.binderCount.toString(), Icons.Default.Folder, Modifier.weight(1f))
                    StatCard("Unique cards", state.stats.uniqueCards.toString(), Icons.Default.Style, Modifier.weight(1f))
                }
                Spacer(Modifier.height(10.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatCard("Total copies", state.stats.totalCopies.toString(), Icons.Default.Layers, Modifier.weight(1f))
                    if (state.preferences.showPricing) {
                        StatCard("Est. value", state.stats.totalValue.asCurrency(state.preferences.currency), Icons.Default.Payments, Modifier.weight(1f))
                    }
                }
            }
            item { Text("Recent binders", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
            items(state.binders.take(4), key = { it.id }) { binder ->
                Card(
                    Modifier.fillMaxWidth().clickable { onBinder(binder.id) },
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                ) {
                    Column(Modifier.padding(16.dp)) {
                        Text(binder.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(
                            "${binder.uniqueCards} unique · ${binder.totalCopies} copies" +
                                if (state.preferences.showPricing) " · ${binder.totalValue.asCurrency(state.preferences.currency)}" else "",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StatCard(label: String, value: String, icon: ImageVector, modifier: Modifier = Modifier) {
    Card(modifier, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
        Column(Modifier.padding(14.dp)) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
            Spacer(Modifier.height(12.dp))
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.labelMedium)
        }
    }
}
