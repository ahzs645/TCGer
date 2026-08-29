package com.ahmadjalil.tcger.features.social

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ImportExport
import androidx.compose.material.icons.filled.Newspaper
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PriceChange
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun ActivityScreen(
    controller: SocialFeatureController,
    contentPadding: PaddingValues,
) {
    val state by controller.state.collectAsStateWithLifecycle()
    LaunchedEffect(controller) { if (state.connected) controller.loadActivity() }

    if (!state.connected) {
        SocialUnavailable(
            "Connect a Server for Activity",
            "Trade requests, price alerts, import status and server updates appear here.",
            contentPadding,
        )
        return
    }

    val unread = state.notifications.filterNot(AppNotification::read)
    val earlier = state.notifications.filter(AppNotification::read)
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = contentPadding.calculateTopPadding() + 18.dp,
            bottom = contentPadding.calculateBottomPadding() + 28.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        item {
            SocialTitle("Activity", "Notifications from your TCGer server") {
                IconButton(onClick = { controller.loadActivity() }) { Icon(Icons.Default.Refresh, "Refresh activity") }
            }
        }
        if (unread.isNotEmpty()) item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("${unread.size} unread", Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                TextButton(onClick = { controller.markAllNotificationsRead() }, enabled = !state.busy) {
                    Icon(Icons.Default.CheckCircle, null)
                    Text("Mark all read", Modifier.padding(start = 6.dp))
                }
            }
        }
        state.error?.let { item { SocialError(it) { controller.loadActivity() } } }
        if (state.loadingActivity && state.notifications.isEmpty()) item { SocialLoading("Loading activity…") }
        else if (state.notifications.isEmpty()) item {
            SocialEmpty("No activity yet", "New trade requests, price alerts, and account updates will appear here.")
        }
        if (unread.isNotEmpty()) {
            item { ActivitySectionLabel("New") }
            items(unread, key = { it.id }) { notification ->
                NotificationRow(notification) { controller.markNotificationRead(notification.id) }
            }
        }
        if (earlier.isNotEmpty()) {
            item { ActivitySectionLabel("Earlier") }
            items(earlier, key = { it.id }) { notification -> NotificationRow(notification, null) }
        }
    }
}

@Composable
private fun ActivitySectionLabel(label: String) {
    Text(label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 6.dp))
}

@Composable
private fun NotificationRow(notification: AppNotification, markRead: (() -> Unit)?) {
    Card(
        Modifier.fillMaxWidth().then(if (markRead == null) Modifier else Modifier.clickable(onClick = markRead)),
    ) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.Top) {
            Box(
                Modifier.size(40.dp).clip(CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(notification.category.icon(), null, tint = if (notification.read) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary)
            }
            Column(Modifier.weight(1f).padding(horizontal = 10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(notification.title, fontWeight = if (notification.read) FontWeight.Medium else FontWeight.Bold)
                Text(notification.body, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(notification.createdAt, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            }
            if (!notification.read) {
                Box(Modifier.padding(top = 5.dp).size(9.dp).clip(CircleShape)) {
                    Icon(Icons.Default.Notifications, "Unread", tint = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}

private fun NotificationCategory.icon(): ImageVector = when (this) {
    NotificationCategory.TRADE -> Icons.Default.SwapHoriz
    NotificationCategory.PRICE -> Icons.Default.PriceChange
    NotificationCategory.IMPORT -> Icons.Default.ImportExport
    NotificationCategory.NEWS -> Icons.Default.Newspaper
    NotificationCategory.GENERAL -> Icons.Default.Notifications
}
