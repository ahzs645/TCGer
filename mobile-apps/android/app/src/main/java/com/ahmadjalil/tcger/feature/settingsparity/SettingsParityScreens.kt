package com.ahmadjalil.tcger.feature.settingsparity

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.text.NumberFormat
import java.util.Currency
import kotlinx.coroutines.launch

@Composable
fun PricingSourceSettingsScreen(
    repository: PricingSourceRepository,
    preferenceStore: PricingSourcePreferenceStore,
    enabledGames: List<String>,
    contentPadding: PaddingValues = PaddingValues(),
) {
    val scope = rememberCoroutineScope()
    var catalog by remember { mutableStateOf<PriceSourcesResponse?>(null) }
    var selection by remember { mutableStateOf(preferenceStore.load()) }
    var loading by remember { mutableStateOf(true) }
    var testing by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    fun load() = scope.launch {
        loading = true; error = null
        runCatching { repository.availableSources() }.onSuccess { catalog = it }.onFailure { error = it.message }
        loading = false
    }
    LaunchedEffect(repository) { load() }
    val sources = catalog?.sources.orEmpty()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = settingsFeaturePadding(contentPadding), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { SettingsFeatureHeader("Pricing Source", "Choose a default and optional per-game providers", ::load) }
        if (loading) item { SettingsLoading() }
        error?.let { item { SettingsMessage(it, true) } }
        result?.let { item { SettingsMessage(it, false) } }
        if (!loading && sources.isEmpty()) item { SettingsMessage("No pricing sources are available.", true) }
        if (sources.isNotEmpty()) {
            item {
                SettingsSection("Active Source", "Existing saved card values are not rewritten automatically.") {
                    sources.forEach { source ->
                        SourceChoice(source, selected = selection.defaultSource == source.id) {
                            preferenceStore.setDefault(source.id); selection = preferenceStore.load(); result = null
                        }
                    }
                    Button(
                        enabled = !testing,
                        onClick = {
                            testing = true
                            scope.launch {
                                runCatching { repository.test(selection.defaultSource) }.onSuccess {
                                    result = if (it.ok) "Connection succeeded in ${it.latencyMs} ms." else it.error ?: "Connection failed."
                                }.onFailure { result = it.message }
                                testing = false
                            }
                        },
                    ) { if (testing) CircularProgressIndicator(Modifier.size(18.dp)) else Text("Test active source") }
                }
            }
            item {
                SettingsSection("Game Priorities", "A preferred source overrides the default for that game.") {
                    enabledGames.distinct().forEach { game ->
                        Text(game.replaceFirstChar(Char::uppercase), fontWeight = FontWeight.SemiBold)
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            item {
                                FilterChip(selection.gameOverrides[game.lowercase()] == null, {
                                    preferenceStore.setOverride(game, null); selection = preferenceStore.load()
                                }, label = { Text("Use default") })
                            }
                            items(sources.filter { it.games.isEmpty() || game in it.games }, key = { it.id }) { source ->
                                FilterChip(selection.gameOverrides[game.lowercase()] == source.id, {
                                    preferenceStore.setOverride(game, source.id); selection = preferenceStore.load()
                                }, label = { Text(source.label) })
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ServerAccessPolicyScreen(
    repository: ServerAccessPolicyRepository,
    contentPadding: PaddingValues = PaddingValues(),
) {
    val scope = rememberCoroutineScope()
    var policy by remember { mutableStateOf<ServerAccessPolicy?>(null) }
    var loading by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun load() = scope.launch {
        loading = true; error = null
        runCatching { repository.get() }.onSuccess { policy = it }.onFailure { error = it.message }
        loading = false
    }
    fun update(input: UpdateServerAccessPolicy) = scope.launch {
        saving = true; error = null
        runCatching { repository.update(input) }.onSuccess { policy = it }.onFailure { error = it.message }
        saving = false
    }
    LaunchedEffect(repository) { load() }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = settingsFeaturePadding(contentPadding), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { SettingsFeatureHeader("Server Access", "Admin controls for unauthenticated web access", ::load) }
        if (loading) item { SettingsLoading() }
        error?.let { item { SettingsMessage(it, true) } }
        policy?.let { current ->
            item {
                SettingsSection("Access Policy", "These settings affect every web and mobile client using this server.") {
                    PolicySwitch("Public Dashboard", "Allow dashboard access without signing in", current.publicDashboard, saving) { update(UpdateServerAccessPolicy(publicDashboard = it)) }
                    PolicySwitch("Public Collections", "Allow collection browsing without signing in", current.publicCollections, saving) { update(UpdateServerAccessPolicy(publicCollections = it)) }
                    PolicySwitch("Require Authentication", "Force sign-in before using all other app features", current.requireAuth, saving) { update(UpdateServerAccessPolicy(requireAuth = it)) }
                }
            }
            item { Text("${current.appName} · Last updated ${current.updatedAt.ifBlank { "unknown" }}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable
fun FinanceHistoryScreen(
    repository: FinanceRepository,
    enabledGames: List<String>,
    defaultCurrency: String,
    contentPadding: PaddingValues = PaddingValues(),
) {
    val scope = rememberCoroutineScope()
    var transactions by remember { mutableStateOf<List<FinanceTransaction>>(emptyList()) }
    var summary by remember { mutableStateOf<FinanceSummary?>(null) }
    var loading by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var filter by remember { mutableStateOf<TransactionType?>(null) }
    var adding by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<FinanceTransaction?>(null) }
    var deleting by remember { mutableStateOf<FinanceTransaction?>(null) }
    fun load() = scope.launch {
        loading = transactions.isEmpty(); error = null
        runCatching { repository.getTransactions() to repository.getSummary() }.onSuccess { (items, total) -> transactions = items; summary = total }.onFailure { error = it.message }
        loading = false
    }
    fun create(input: CreateFinanceTransaction) = scope.launch {
        saving = true; error = null
        runCatching { repository.create(input) }.onSuccess { adding = false; load() }.onFailure { error = it.message }
        saving = false
    }
    fun delete(transaction: FinanceTransaction) = scope.launch {
        saving = true
        runCatching { repository.delete(transaction.id) }.onSuccess { deleting = null; load() }.onFailure { error = it.message }
        saving = false
    }
    LaunchedEffect(repository) { load() }
    val filtered = transactions.filter { filter == null || it.type == filter }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = settingsFeaturePadding(contentPadding), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { SettingsFeatureHeader("Transactions", "Purchases, sales, trades, and realized returns", ::load) }
        item {
            Button(onClick = { adding = true }, Modifier.fillMaxWidth()) { Icon(Icons.Default.Add, null); Spacer(Modifier.size(6.dp)); Text("New transaction") }
        }
        summary?.let { value -> item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FinanceMetric("Spent", financeMoney(value.totalSpent, defaultCurrency), Modifier.weight(1f))
                FinanceMetric("Earned", financeMoney(value.totalEarned, defaultCurrency), Modifier.weight(1f))
                FinanceMetric("P/L", financeMoney(value.profitLoss, defaultCurrency), Modifier.weight(1f))
            }
        } }
        item { LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item { FilterChip(filter == null, { filter = null }, label = { Text("All") }) }
            items(TransactionType.entries) { value -> FilterChip(filter == value, { filter = value }, label = { Text(value.title + "s") }) }
        } }
        if (loading) item { SettingsLoading() }
        error?.let { item { SettingsMessage(it, true) } }
        if (!loading && filtered.isEmpty()) item { SettingsMessage("No transactions yet.", false) }
        items(filtered, key = FinanceTransaction::id) { transaction ->
            FinanceTransactionCard(transaction, onOpen = { selected = transaction }, onDelete = { deleting = transaction })
        }
    }
    if (adding) NewFinanceTransactionDialog(enabledGames, defaultCurrency, saving, { adding = false }, ::create)
    selected?.let { FinanceTransactionDetailDialog(it) { selected = null } }
    deleting?.let { transaction -> AlertDialog(
        onDismissRequest = { deleting = null }, title = { Text("Delete transaction?") }, text = { Text("This removes the ${transaction.type.title.lowercase()} record.") },
        confirmButton = { TextButton(enabled = !saving, onClick = { delete(transaction) }) { Text("Delete") } },
        dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
    ) }
}

@Composable private fun SourceChoice(source: PriceSourceOption, selected: Boolean, onSelect: () -> Unit) = Card(onClick = onSelect, modifier = Modifier.fillMaxWidth()) { Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.weight(1f)) { Text(source.label, fontWeight = FontWeight.SemiBold); Text(source.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    FilterChip(selected, onSelect, label = { Text(if (selected) "Selected" else "Use") })
} }

@Composable private fun PolicySwitch(title: String, subtitle: String, checked: Boolean, disabled: Boolean, change: (Boolean) -> Unit) = Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.Medium); Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    Switch(checked, change, enabled = !disabled)
}

@Composable private fun FinanceMetric(title: String, value: String, modifier: Modifier) = Card(modifier) { Column(Modifier.padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally) { Text(value, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis); Text(title, style = MaterialTheme.typography.labelSmall) } }

@Composable private fun FinanceTransactionCard(transaction: FinanceTransaction, onOpen: () -> Unit, onDelete: () -> Unit) = Card(onClick = onOpen, modifier = Modifier.fillMaxWidth()) { Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.weight(1f)) { Text(transaction.cardName ?: transaction.type.title, fontWeight = FontWeight.SemiBold); Text(listOfNotNull(transaction.type.title, transaction.tcg, transaction.platform).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant); Text(transaction.date.take(10), style = MaterialTheme.typography.labelSmall) }
    Column(horizontalAlignment = Alignment.End) { Text((if (transaction.type == TransactionType.PURCHASE) "−" else "+") + financeMoney(transaction.amount, transaction.currency), fontWeight = FontWeight.Bold); transaction.realizedProfit?.let { Text("${if (it >= 0) "+" else "−"}${financeMoney(kotlin.math.abs(it), transaction.currency)} realized", style = MaterialTheme.typography.labelSmall) } }
    IconButton(onDelete) { Icon(Icons.Default.Delete, "Delete transaction") }
} }

@Composable private fun NewFinanceTransactionDialog(games: List<String>, defaultCurrency: String, saving: Boolean, dismiss: () -> Unit, save: (CreateFinanceTransaction) -> Unit) {
    var type by remember { mutableStateOf(TransactionType.PURCHASE) }; var card by remember { mutableStateOf("") }; var game by remember { mutableStateOf("") }; var quantity by remember { mutableIntStateOf(1) }; var amount by remember { mutableStateOf("") }; var currency by remember { mutableStateOf(defaultCurrency) }; var platform by remember { mutableStateOf("") }; var cost by remember { mutableStateOf("") }; var fees by remember { mutableStateOf("") }; var shipping by remember { mutableStateOf("") }; var notes by remember { mutableStateOf("") }
    val input = CreateFinanceTransaction(type, card.ifBlank { null }, game.ifBlank { null }, quantity, amount.toDoubleOrNull() ?: 0.0, currency, platform.ifBlank { null }, cost.toDoubleOrNull(), fees.toDoubleOrNull(), shipping.toDoubleOrNull(), notes = notes.ifBlank { null })
    AlertDialog(onDismissRequest = dismiss, title = { Text("New transaction") }, text = { LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { items(TransactionType.entries) { value -> FilterChip(type == value, { type = value }, label = { Text(value.title) }) } } }
        item { OutlinedTextField(card, { card = it }, label = { Text("Card name (optional)") }, singleLine = true) }
        item { LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { item { FilterChip(game.isBlank(), { game = "" }, label = { Text("No game") }) }; items(games) { value -> FilterChip(game == value, { game = value }, label = { Text(value) }) } } }
        item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { OutlinedTextField(quantity.toString(), { quantity = it.toIntOrNull()?.coerceIn(1, 999) ?: 1 }, Modifier.weight(1f), label = { Text("Quantity") }, singleLine = true); OutlinedTextField(amount, { amount = it }, Modifier.weight(1f), label = { Text("Amount") }, singleLine = true); OutlinedTextField(currency, { currency = it.take(3).uppercase() }, Modifier.weight(1f), label = { Text("Currency") }, singleLine = true) } }
        item { OutlinedTextField(platform, { platform = it }, label = { Text("Platform (optional)") }, singleLine = true) }
        if (type == TransactionType.SALE) item { Column(verticalArrangement = Arrangement.spacedBy(6.dp)) { OutlinedTextField(cost, { cost = it }, label = { Text("Acquisition cost") }, singleLine = true); OutlinedTextField(fees, { fees = it }, label = { Text("Fees") }, singleLine = true); OutlinedTextField(shipping, { shipping = it }, label = { Text("Shipping") }, singleLine = true) } }
        item { OutlinedTextField(notes, { notes = it }, label = { Text("Notes") }, minLines = 2) }
    } }, confirmButton = { TextButton(enabled = input.isValid && !saving, onClick = { save(input) }) { Text("Save") } }, dismissButton = { TextButton(dismiss) { Text("Cancel") } })
}

@Composable private fun FinanceTransactionDetailDialog(transaction: FinanceTransaction, dismiss: () -> Unit) = AlertDialog(onDismissRequest = dismiss, title = { Text(transaction.cardName ?: transaction.type.title) }, text = { Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
    DetailLine("Type", transaction.type.title); DetailLine("Amount", financeMoney(transaction.amount, transaction.currency)); DetailLine("Quantity", transaction.quantity.toString()); transaction.platform?.let { DetailLine("Platform", it) }; DetailLine("Date", transaction.date); transaction.costBasis?.let { DetailLine("Acquisition cost", financeMoney(it, transaction.currency)) }; transaction.fees?.let { DetailLine("Fees", financeMoney(it, transaction.currency)) }; transaction.shippingCost?.let { DetailLine("Shipping", financeMoney(it, transaction.currency)) }; transaction.netProceeds?.let { DetailLine("Net proceeds", financeMoney(it, transaction.currency)) }; transaction.realizedProfit?.let { DetailLine("Realized profit", financeMoney(it, transaction.currency)) }; transaction.notes?.let { HorizontalDivider(); Text(it) }
} }, confirmButton = { TextButton(dismiss) { Text("Done") } })

@Composable private fun DetailLine(label: String, value: String) = Row(Modifier.fillMaxWidth()) { Text(label, Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant); Text(value) }
@Composable private fun SettingsFeatureHeader(title: String, subtitle: String, refresh: () -> Unit) = Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold); Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant) }; IconButton(refresh) { Icon(Icons.Default.Refresh, "Refresh $title") } }
@Composable private fun SettingsSection(title: String, footer: String, content: @Composable () -> Unit) = Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold); content(); Text(footer, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
@Composable private fun SettingsLoading() = Row(Modifier.fillMaxWidth().padding(24.dp), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator() }
@Composable private fun SettingsMessage(message: String, error: Boolean) = Card(Modifier.fillMaxWidth()) { Text(message, Modifier.padding(14.dp), color = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant) }
private fun settingsFeaturePadding(padding: PaddingValues) = PaddingValues(16.dp, padding.calculateTopPadding() + 18.dp, 16.dp, padding.calculateBottomPadding() + 28.dp)
private fun financeMoney(value: Double, currency: String) = runCatching { NumberFormat.getCurrencyInstance().apply { this.currency = Currency.getInstance(currency) }.format(value) }.getOrElse { "$currency ${"%.2f".format(value)}" }
