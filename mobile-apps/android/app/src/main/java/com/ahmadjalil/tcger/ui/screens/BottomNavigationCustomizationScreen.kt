package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.R
import com.ahmadjalil.tcger.domain.BottomNavigationItem
import com.ahmadjalil.tcger.ui.AppUiState
import com.ahmadjalil.tcger.ui.AppViewModel
import com.ahmadjalil.tcger.ui.descriptionRes
import com.ahmadjalil.tcger.ui.icon
import com.ahmadjalil.tcger.ui.labelRes

@Composable
fun BottomNavigationCustomizationScreen(
    state: AppUiState,
    contentPadding: PaddingValues,
    viewModel: AppViewModel,
    onBack: () -> Unit,
) {
    var showingResetConfirmation by remember { mutableStateOf(false) }
    val preferences = state.preferences
    val order = preferences.bottomNavigationOrder

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp,
            top = contentPadding.calculateTopPadding() + 12.dp,
            end = 16.dp,
            bottom = contentPadding.calculateBottomPadding() + 24.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.navigation_back))
                }
                Column(Modifier.padding(start = 4.dp)) {
                    Text(
                        stringResource(R.string.navigation_customize_title),
                        style = MaterialTheme.typography.headlineSmall,
                    )
                    Text(
                        stringResource(
                            R.string.navigation_customize_summary,
                            preferences.visibleBottomNavigationItems.size,
                            order.size,
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        item {
            Text(
                stringResource(R.string.navigation_customize_intro),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        itemsIndexed(order, key = { _, item -> item.name }) { index, item ->
            NavigationPreferenceRow(
                item = item,
                visible = item !in preferences.hiddenBottomNavigationItems,
                canMoveUp = index > 0,
                canMoveDown = index < order.lastIndex,
                onVisibleChange = { viewModel.setBottomNavigationItemVisible(item, it) },
                onMoveUp = { viewModel.moveBottomNavigationItem(item, -1) },
                onMoveDown = { viewModel.moveBottomNavigationItem(item, 1) },
            )
        }
        item {
            TextButton(
                onClick = { showingResetConfirmation = true },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.navigation_reset))
            }
        }
    }

    if (showingResetConfirmation) {
        AlertDialog(
            onDismissRequest = { showingResetConfirmation = false },
            title = { Text(stringResource(R.string.navigation_reset_title)) },
            text = { Text(stringResource(R.string.navigation_reset_message)) },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.resetBottomNavigation()
                    showingResetConfirmation = false
                }) { Text(stringResource(R.string.action_reset)) }
            },
            dismissButton = {
                TextButton(onClick = { showingResetConfirmation = false }) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }
}

@Composable
private fun NavigationPreferenceRow(
    item: BottomNavigationItem,
    visible: Boolean,
    canMoveUp: Boolean,
    canMoveDown: Boolean,
    onVisibleChange: (Boolean) -> Unit,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
) {
    val label = stringResource(item.labelRes)
    val showDescription = stringResource(R.string.navigation_show_item, label)
    val moveUpDescription = stringResource(R.string.navigation_move_up, label)
    val moveDownDescription = stringResource(R.string.navigation_move_down, label)
    Card {
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(item.icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(label, style = MaterialTheme.typography.titleSmall)
                    Text(
                        stringResource(item.descriptionRes),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (item.isPinned) {
                    Text(
                        stringResource(R.string.navigation_always_on),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Switch(
                        checked = visible,
                        onCheckedChange = onVisibleChange,
                        modifier = Modifier.semantics {
                            contentDescription = showDescription
                        },
                    )
                }
            }
            Row(Modifier.align(Alignment.End)) {
                IconButton(
                    onClick = onMoveUp,
                    enabled = canMoveUp,
                    modifier = Modifier.semantics { contentDescription = moveUpDescription },
                ) { Icon(Icons.Default.ArrowUpward, contentDescription = null) }
                IconButton(
                    onClick = onMoveDown,
                    enabled = canMoveDown,
                    modifier = Modifier.semantics { contentDescription = moveDownDescription },
                ) { Icon(Icons.Default.ArrowDownward, contentDescription = null) }
            }
        }
    }
}
