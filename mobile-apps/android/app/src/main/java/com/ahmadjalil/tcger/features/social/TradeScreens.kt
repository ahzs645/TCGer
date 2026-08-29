package com.ahmadjalil.tcger.features.social

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.text.NumberFormat

private val tradeFilters = listOf("all", "pending", "accepted", "declined", "cancelled")

@Composable
fun TradesScreen(
    controller: SocialFeatureController,
    contentPadding: PaddingValues,
    onOpenTrade: (String) -> Unit,
) {
    val state by controller.state.collectAsStateWithLifecycle()
    var filter by remember { mutableStateOf("all") }
    var showingMatches by remember { mutableStateOf(false) }
    var proposing by remember { mutableStateOf<TradeMatch?>(null) }
    var deleting by remember { mutableStateOf<Trade?>(null) }
    LaunchedEffect(controller) { if (state.connected) controller.loadTrades() }

    if (!state.connected) {
        SocialUnavailable(
            "Connect a Server for Trades",
            "Collector-to-collector trades require user accounts on a TCGer server.",
            contentPadding,
        )
        return
    }
    val filtered = if (filter == "all") state.trades else state.trades.filter { it.status == filter }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = contentPadding.calculateTopPadding() + 18.dp,
            bottom = contentPadding.calculateBottomPadding() + 28.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            SocialTitle("Trades", "Propose and review collector trades") {
                IconButton(onClick = { controller.loadTrades() }) { Icon(Icons.Default.Refresh, "Refresh trades") }
                IconButton(onClick = { controller.loadTradeMatches(); showingMatches = true }) {
                    Icon(Icons.Default.People, "Suggested matches")
                }
            }
        }
        item { TradeSummaryCard(state.trades, state.currentUserId) }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                tradeFilters.forEach { item ->
                    FilterChip(filter == item, { filter = item }, { Text(item.gameLabel()) }, modifier = Modifier.weight(1f))
                }
            }
        }
        if (state.loadingMatches) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        state.error?.let { item { SocialError(it) { controller.loadTrades() } } }
        if (state.loadingTrades && state.trades.isEmpty()) item { SocialLoading("Loading trades…") }
        else if (filtered.isEmpty()) item {
            SocialEmpty(
                if (filter == "all") "No trades yet" else "No ${filter.gameLabel()} trades",
                "Open suggested matches to propose a card-for-card trade.",
            )
        }
        items(filtered, key = { it.id }) { trade ->
            Card(Modifier.fillMaxWidth().clickable { onOpenTrade(trade.id) }) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(trade.status.gameLabel(), fontWeight = FontWeight.Bold, color = tradeStatusColor(trade.status))
                        Spacer(Modifier.weight(1f))
                        if (trade.canDelete(state.currentUserId)) {
                            IconButton(onClick = { deleting = trade }) { Icon(Icons.Default.Delete, "Delete trade") }
                        }
                    }
                    Text("Give ${trade.giving(state.currentUserId).sumOf(TradeCard::quantity)} → Receive ${trade.receiving(state.currentUserId).sumOf(TradeCard::quantity)}")
                    trade.message?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    if (trade.canAccept(state.currentUserId)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { controller.updateTradeStatus(trade.id, "accept") }) { Text("Accept") }
                            OutlinedButton(onClick = { controller.updateTradeStatus(trade.id, "decline") }) { Text("Decline") }
                        }
                    } else if (trade.canCancel(state.currentUserId)) {
                        OutlinedButton(onClick = { controller.updateTradeStatus(trade.id, "cancel") }) { Text("Cancel proposal") }
                    }
                }
            }
        }
    }

    if (showingMatches && !state.loadingMatches) {
        TradeMatchesDialog(state.tradeMatches, { showingMatches = false }) { match ->
            showingMatches = false
            proposing = match
        }
    }
    proposing?.let { match -> ProposeTradeDialog(match, { proposing = null }) { message ->
        controller.proposeTrade(match, message) { if (it) proposing = null }
    } }
    deleting?.let { trade ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete trade?") },
            text = { Text("The trade proposal will be permanently removed.") },
            confirmButton = { TextButton(onClick = { controller.deleteTrade(trade.id); deleting = null }) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
        )
    }
}

@Composable
fun TradeDetailScreen(
    controller: SocialFeatureController,
    tradeId: String,
    contentPadding: PaddingValues,
    onBack: () -> Unit,
) {
    val state by controller.state.collectAsStateWithLifecycle()
    val trade = state.trades.firstOrNull { it.id == tradeId }
    LaunchedEffect(controller) { if (state.trades.isEmpty()) controller.loadTrades() }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = contentPadding.calculateTopPadding() + 12.dp,
            bottom = contentPadding.calculateBottomPadding() + 28.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back") }
                Text("Trade", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            }
        }
        if (state.loadingTrades && trade == null) item { SocialLoading("Loading trade…") }
        state.error?.let { item { SocialError(it) { controller.loadTrades() } } }
        if (!state.loadingTrades && trade == null) item { SocialEmpty("Trade unavailable", "It may have been deleted or is no longer accessible.") }
        trade?.let { value ->
            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row { Text("Status", Modifier.weight(1f)); Text(value.status.gameLabel(), fontWeight = FontWeight.Bold, color = tradeStatusColor(value.status)) }
                        value.message?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        Text("Updated ${value.updatedAt}", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            item { Text("Sender gives", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
            items(value.cards.filter { it.side == "sender" }, key = { it.id }) { TradeCardRow(it) }
            item { Text("Receiver gives", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
            items(value.cards.filter { it.side == "receiver" }, key = { it.id }) { TradeCardRow(it) }
            if (value.canAccept(state.currentUserId)) item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { controller.updateTradeStatus(value.id, "accept") }, modifier = Modifier.weight(1f)) { Text("Accept trade") }
                    OutlinedButton(onClick = { controller.updateTradeStatus(value.id, "decline") }, modifier = Modifier.weight(1f)) { Text("Decline") }
                }
            }
            if (value.canCancel(state.currentUserId)) item {
                OutlinedButton(onClick = { controller.updateTradeStatus(value.id, "cancel") }, modifier = Modifier.fillMaxWidth()) { Text("Cancel proposal") }
            }
        }
    }
}

@Composable
private fun TradeCardRow(card: TradeCard) {
    Card(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(card.name, fontWeight = FontWeight.SemiBold)
                AssistChip(onClick = {}, label = { Text(card.tcg.gameLabel()) })
            }
            Text("×${card.quantity}", fontWeight = FontWeight.Bold)
            card.estimatedValue?.let { Text(NumberFormat.getCurrencyInstance().format(it * card.quantity), Modifier.padding(start = 10.dp)) }
        }
    }
}

@Composable
private fun TradeSummaryCard(trades: List<Trade>, currentUserId: String?) {
    val accepted = trades.filter { it.status == "accepted" }
    fun value(trade: Trade, side: String) = trade.cards.filter { it.side == side }.sumOf { (it.estimatedValue ?: 0.0) * it.quantity }
    val given = accepted.sumOf { value(it, if (it.senderId == currentUserId) "sender" else "receiver") }
    val received = accepted.sumOf { value(it, if (it.senderId == currentUserId) "receiver" else "sender") }
    Card(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(14.dp)) {
            TradeMetric("Total", trades.size.toString(), Modifier.weight(1f))
            TradeMetric("Given", NumberFormat.getCurrencyInstance().format(given), Modifier.weight(1f))
            TradeMetric("Received", NumberFormat.getCurrencyInstance().format(received), Modifier.weight(1f))
        }
    }
}

@Composable private fun TradeMetric(title: String, value: String, modifier: Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontWeight = FontWeight.Bold)
        Text(title, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun TradeMatchesDialog(matches: List<TradeMatch>, onDismiss: () -> Unit, onSelect: (TradeMatch) -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Suggested matches") },
        text = {
            if (matches.isEmpty()) SocialEmpty("No matches yet", "Add cards to wishlists and binders to improve matching.")
            else Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                matches.forEach { match ->
                    Card(Modifier.fillMaxWidth().clickable { onSelect(match) }) {
                        Column(Modifier.padding(14.dp)) {
                            Row { Text(match.username ?: "Collector", Modifier.weight(1f), fontWeight = FontWeight.Bold); Text("${match.matchScore.toInt()}% match") }
                            Text("You offer ${match.youHave.size} · They offer ${match.theyHave.size}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
    )
}

@Composable
private fun ProposeTradeDialog(match: TradeMatch, onDismiss: () -> Unit, onPropose: (String?) -> Unit) {
    var message by remember(match.userId) { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Propose trade") },
        text = {
            Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("You give", fontWeight = FontWeight.Bold)
                match.youHave.forEach { Text(it.name) }
                Text("You receive", fontWeight = FontWeight.Bold)
                match.theyHave.forEach { Text(it.name) }
                OutlinedTextField(message, { message = it }, Modifier.fillMaxWidth(), label = { Text("Optional note") }, minLines = 2)
            }
        },
        confirmButton = { TextButton(onClick = { onPropose(message.clean()) }, enabled = match.youHave.isNotEmpty()) { Text("Send") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun tradeStatusColor(status: String) = when (status) {
    "accepted" -> MaterialTheme.colorScheme.primary
    "declined", "cancelled" -> MaterialTheme.colorScheme.error
    else -> MaterialTheme.colorScheme.tertiary
}
