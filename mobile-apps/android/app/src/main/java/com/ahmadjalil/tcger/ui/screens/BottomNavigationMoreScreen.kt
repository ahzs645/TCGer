package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.R
import com.ahmadjalil.tcger.domain.BottomNavigationItem
import com.ahmadjalil.tcger.ui.descriptionRes
import com.ahmadjalil.tcger.ui.icon
import com.ahmadjalil.tcger.ui.labelRes

@Composable
fun BottomNavigationMoreScreen(
    destinations: List<BottomNavigationItem>,
    contentPadding: PaddingValues,
    onDestination: (BottomNavigationItem) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp,
            top = contentPadding.calculateTopPadding() + 20.dp,
            end = 16.dp,
            bottom = contentPadding.calculateBottomPadding() + 24.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Text(
                stringResource(R.string.navigation_overflow_title),
                style = MaterialTheme.typography.headlineMedium,
            )
        }
        items(destinations, key = BottomNavigationItem::name) { destination ->
            Card(
                Modifier.fillMaxWidth().clickable { onDestination(destination) },
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        destination.icon,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    Column(Modifier.padding(start = 14.dp)) {
                        Text(
                            stringResource(destination.labelRes),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            stringResource(destination.descriptionRes),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}
