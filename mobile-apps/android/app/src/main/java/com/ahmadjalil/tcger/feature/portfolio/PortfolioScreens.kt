package com.ahmadjalil.tcger.feature.portfolio

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.ahmadjalil.tcger.domain.Binder
import kotlinx.coroutines.launch

private enum class PriceSort(val title: String) { VALUE("Value"), PRICE("Price"), OWNED("Owned"), CHANGE("30d") }

@Composable
fun PricesScreen(
    repository: PortfolioRepository,
    binders: List<Binder>,
    showPricing: Boolean,
    displayCurrency: String,
    contentPadding: PaddingValues = PaddingValues(),
) {
    val scope = rememberCoroutineScope()
    var portfolio by remember { mutableStateOf<PricePortfolio?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var game by remember { mutableStateOf<String?>(null) }
    var sort by remember { mutableStateOf(PriceSort.VALUE) }

    fun refresh(force: Boolean) {
        scope.launch {
            loading = portfolio == null
            error = null
            runCatching { repository.prices(binders, force) }
                .onSuccess { portfolio = it }
                .onFailure { error = it.message ?: "Price request failed" }
            loading = false
        }
    }
    LaunchedEffect(repository, binders) { refresh(false) }

    if (!showPricing) {
        FeatureEmptyPane("Pricing is hidden", "Enable pricing in Settings to use the price tracker.", contentPadding)
        return
    }
    val games = portfolio?.cards?.map(TrackedCard::tcg)?.distinct()?.sorted().orEmpty()
    val cards = portfolio?.cards.orEmpty().filter { card ->
        (game == null || card.tcg == game) && (query.isBlank() || card.name.contains(query.trim(), true) || card.setName?.contains(query.trim(), true) == true)
    }.let { values ->
        when (sort) {
            PriceSort.VALUE -> values.sortedByDescending(TrackedCard::totalValue)
            PriceSort.PRICE -> values.sortedByDescending(TrackedCard::unitPrice)
            PriceSort.OWNED -> values.sortedByDescending(TrackedCard::quantity)
            PriceSort.CHANGE -> values.sortedByDescending { it.percentChange ?: Double.NEGATIVE_INFINITY }
        }
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = featurePadding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { FeatureHeader("Prices", "Stored prices work offline; refresh uses live server quotes") { refresh(true) } }
        portfolio?.let { result ->
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MetricCard("Portfolio", formatPortfolioMoney(result.totalValue, result.cards.firstOrNull()?.currency ?: displayCurrency), Modifier.weight(1f))
                    MetricCard("Tracked", result.cards.size.toString(), Modifier.weight(1f))
                    MetricCard("Copies", result.cards.sumOf(TrackedCard::quantity).toString(), Modifier.weight(1f))
                }
            }
            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(Modifier.fillMaxWidth()) {
                            Text("Cost-basis completeness", Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                            Text("${(result.costCoverage.fraction * 100).toInt()}%")
                        }
                        LinearProgressIndicator(
                            progress = { result.costCoverage.fraction.toFloat() },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Text(
                            "${result.costCoverage.costedCopies} of ${result.costCoverage.totalCopies} copies costed · " +
                                "${result.costCoverage.cardsMissingCosts} rows need costs",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            "${formatPortfolioMoney(result.costCoverage.untrackedMarketValue, displayCurrency)} value lacks cost basis",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
            result.warning?.let { item { WarningCard(it) } }
            result.refreshedAt?.let { item { Text("Market prices checked $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
        }
        item { OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), label = { Text("Search tracked cards") }, singleLine = true) }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    item { FilterChip(game == null, { game = null }, label = { Text("All games") }) }
                    items(games) { value -> FilterChip(game == value, { game = value }, label = { Text(value.replaceFirstChar(Char::uppercase)) }) }
                }
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(PriceSort.entries) { value -> FilterChip(sort == value, { sort = value }, label = { Text(value.title) }) }
                }
            }
        }
        if (loading) item { LoadingRow() }
        error?.let { item { WarningCard(it) } }
        if (!loading && portfolio?.cards?.isEmpty() == true) item { EmptyCard("No tracked cards", "Add priced cards to a binder to start tracking their value.") }
        if (!loading && cards.isEmpty() && portfolio?.cards?.isNotEmpty() == true) item { EmptyCard("No matching cards", "Try a different search or game filter.") }
        items(cards, key = TrackedCard::id) { card -> TrackedPriceCard(card, repository) }
    }
}

@Composable
fun AnalyticsScreen(
    repository: PortfolioRepository,
    binders: List<Binder>,
    showPricing: Boolean,
    displayCurrency: String,
    contentPadding: PaddingValues = PaddingValues(),
) {
    val scope = rememberCoroutineScope()
    var period by remember { mutableStateOf(AnalyticsPeriod.THIRTY_DAYS) }
    var snapshot by remember { mutableStateOf<AnalyticsSnapshot?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    fun refresh() {
        scope.launch {
            loading = snapshot == null
            error = null
            runCatching { repository.analytics(binders, period) }
                .onSuccess { snapshot = it }
                .onFailure { error = it.message ?: "Analytics request failed" }
            loading = false
        }
    }
    LaunchedEffect(repository, binders, period) { refresh() }

    if (!showPricing) {
        FeatureEmptyPane("Analytics are hidden", "Enable pricing in Settings to view collection analytics.", contentPadding)
        return
    }
    LazyColumn(
        Modifier.fillMaxSize(), contentPadding = featurePadding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { FeatureHeader("Analytics", "Value, allocation, rarity, and market movement", ::refresh) }
        item {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(AnalyticsPeriod.entries) { value -> FilterChip(period == value, { period = value }, label = { Text(value.title) }) }
            }
        }
        if (loading) item { LoadingRow() }
        error?.let { item { WarningCard(it) } }
        snapshot?.let { data ->
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MetricCard("Value", formatPortfolioMoney(data.history.currentValue, displayCurrency), Modifier.weight(1f))
                    MetricCard(period.title, signedPercent(data.history.changePercent), Modifier.weight(1f))
                    MetricCard("Cards", data.breakdown.byGame.sumOf(GameValue::cardCount).toString(), Modifier.weight(1f))
                }
            }
            data.warning?.let { item { WarningCard(it) } }
            if (data.offline) item { Text("On-device mode shows current totals. Historical change and movers require server price snapshots.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            item { AnalyticsGroup("Collection Value", "Market value over ${period.title}") {
                if (data.history.history.size < 2) Text("More history is needed. Value history appears after server price snapshots.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                else data.history.history.takeLast(8).forEach { point -> AnalyticsBar(point.date.take(10), point.value, data.history.history.maxOf { it.value }, displayCurrency) }
            } }
            item { AnalyticsGroup("Value by Game", "Portfolio allocation") {
                if (data.breakdown.byGame.isEmpty()) Text("No priced cards yet.")
                data.breakdown.byGame.forEach { value -> AnalyticsBar(value.tcg.replaceFirstChar(Char::uppercase), value.value, data.breakdown.byGame.maxOfOrNull(GameValue::value) ?: 1.0, displayCurrency) }
            } }
            item { AnalyticsGroup("Rarity Distribution", "${data.rarity.total} unique entries") {
                if (data.rarity.entries.isEmpty()) Text("No rarity information yet.")
                data.rarity.entries.take(8).forEach { entry -> CountBar(entry.label, entry.count, data.rarity.entries.maxOfOrNull(DistributionEntry::count) ?: 1) }
            } }
            if (data.movers.gainers.isNotEmpty() || data.movers.losers.isNotEmpty()) {
                item { AnalyticsGroup("Market Movers", period.title) {
                    (data.movers.gainers.take(3) + data.movers.losers.take(3)).forEach { MoverRow(it, displayCurrency) }
                } }
            }
            item { AnalyticsGroup("Top Cards", "Highest collection value") {
                if (data.breakdown.topCards.isEmpty()) Text("No priced cards yet.")
                data.breakdown.topCards.take(8).forEach { TopCardRow(it, displayCurrency) }
            } }
        }
    }
}

@Composable private fun FeatureHeader(title: String, subtitle: String, refresh: () -> Unit) = Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.weight(1f)) { Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold); Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    IconButton(refresh) { Icon(Icons.Default.Refresh, "Refresh $title") }
}

@Composable private fun MetricCard(title: String, value: String, modifier: Modifier) = Card(modifier) { Column(Modifier.padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
    Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis); Text(title, style = MaterialTheme.typography.labelSmall)
} }

@Composable private fun TrackedPriceCard(card: TrackedCard, repository: PortfolioRepository) = Card(Modifier.fillMaxWidth()) {
    val scope = rememberCoroutineScope()
    var quotes by remember(card.tcg, card.externalId) { mutableStateOf<List<MarketPriceQuote>?>(null) }
    var comparing by remember(card.tcg, card.externalId) { mutableStateOf(false) }
    var comparisonError by remember(card.tcg, card.externalId) { mutableStateOf<String?>(null) }
    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            AsyncImage(card.imageUrl, null, Modifier.size(54.dp))
            Column(Modifier.weight(1f)) { Text(card.name, fontWeight = FontWeight.SemiBold, maxLines = 1); Text(listOfNotNull(card.setName, card.rarity).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant); Text("${card.quantity} owned${card.source?.let { " · $it" }.orEmpty()}", style = MaterialTheme.typography.labelSmall) }
            Column(horizontalAlignment = Alignment.End) { Text(formatPortfolioMoney(card.unitPrice, card.currency), fontWeight = FontWeight.SemiBold); Text(formatPortfolioMoney(card.totalValue, card.currency), style = MaterialTheme.typography.bodySmall); card.percentChange?.let { Text(signedPercent(it), color = if (it >= 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error) } }
        }
        TextButton(
            onClick = {
                if (quotes != null) {
                    quotes = null
                } else {
                    scope.launch {
                        comparing = true
                        comparisonError = null
                        runCatching { repository.comparePrices(card) }
                            .onSuccess {
                                quotes = it
                                if (it.isEmpty()) comparisonError = "No comparison quotes are available. Connect to a signed-in server to compare markets."
                            }
                            .onFailure { comparisonError = it.message ?: "Price comparison failed" }
                        comparing = false
                    }
                }
            },
            enabled = !comparing,
        ) { Text(if (comparing) "Comparing…" else if (quotes == null) "Compare markets" else "Hide comparison") }
        comparisonError?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        quotes?.forEach { quote ->
            Row(Modifier.fillMaxWidth()) {
                Text(quote.source.replace('-', ' ').replaceFirstChar(Char::uppercase), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                Text(formatPortfolioMoney(quote.price, quote.currency), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable private fun AnalyticsGroup(title: String, subtitle: String, content: @Composable () -> Unit) = Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold); Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant); content()
} }

@Composable private fun AnalyticsBar(label: String, value: Double, max: Double, currency: String) = Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
    Row(Modifier.fillMaxWidth()) { Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall); Text(formatPortfolioMoney(value, currency), style = MaterialTheme.typography.bodySmall) }
    LinearProgressIndicator(progress = { if (max <= 0) 0f else (value / max).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
}

@Composable private fun CountBar(label: String, value: Int, max: Int) = Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
    Row(Modifier.fillMaxWidth()) { Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall); Text(value.toString(), style = MaterialTheme.typography.bodySmall) }
    LinearProgressIndicator(progress = { if (max <= 0) 0f else value.toFloat() / max }, modifier = Modifier.fillMaxWidth())
}

@Composable private fun MoverRow(mover: PriceMover, currency: String) { Row(Modifier.fillMaxWidth()) { Column(Modifier.weight(1f)) { Text(mover.name, fontWeight = FontWeight.Medium); Text(mover.tcg, style = MaterialTheme.typography.bodySmall) }; Column(horizontalAlignment = Alignment.End) { Text(formatPortfolioMoney(mover.currentPrice, currency)); Text(signedPercent(mover.percentChange), color = if (mover.percentChange >= 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error) } }; HorizontalDivider() }

@Composable private fun TopCardRow(card: TopCard, currency: String) { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { AsyncImage(card.imageUrl, null, Modifier.size(40.dp)); Spacer(Modifier.size(10.dp)); Column(Modifier.weight(1f)) { Text(card.name, fontWeight = FontWeight.Medium); Text(card.tcg, style = MaterialTheme.typography.bodySmall) }; Text(formatPortfolioMoney(card.value, currency)) }; HorizontalDivider() }

@Composable private fun WarningCard(message: String) = Card(Modifier.fillMaxWidth()) { Text(message, Modifier.padding(14.dp), color = MaterialTheme.colorScheme.error) }
@Composable private fun EmptyCard(title: String, message: String) = Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(20.dp)) { Text(title, fontWeight = FontWeight.Bold); Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
@Composable private fun LoadingRow() = Row(Modifier.fillMaxWidth().padding(28.dp), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator() }
@Composable private fun FeatureEmptyPane(title: String, message: String, padding: PaddingValues) = Column(Modifier.fillMaxSize().padding(featurePadding(padding)), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) { Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold); Spacer(Modifier.height(8.dp)); Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant) }

private fun featurePadding(padding: PaddingValues) = PaddingValues(start = 16.dp, end = 16.dp, top = padding.calculateTopPadding() + 18.dp, bottom = padding.calculateBottomPadding() + 28.dp)
private fun signedPercent(value: Double) = "${if (value >= 0) "+" else ""}${"%.1f".format(value)}%"
