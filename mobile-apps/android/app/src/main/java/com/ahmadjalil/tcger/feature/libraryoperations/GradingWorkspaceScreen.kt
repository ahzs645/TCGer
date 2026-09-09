package com.ahmadjalil.tcger.feature.libraryoperations

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.text.NumberFormat
import java.util.Currency

@Serializable private data class GradingDraft(val name: String, val grader: String, val currency: String, val scenario: GradingScenario, val serviceTier: String = "", val snapshot: GradingSnapshot? = null)

@Composable
fun GradingWorkspaceScreen(repository: LibraryOperationsRepository?, padding: PaddingValues = PaddingValues()) {
    val context = LocalContext.current
    val preferences = remember { context.getSharedPreferences("tcger.grading-workspace.v1", 0) }
    val json = remember { Json { ignoreUnknownKeys = true } }
    val draft = remember { runCatching { json.decodeFromString<GradingDraft>(preferences.getString("draft", "")!!) }.getOrNull()?.takeIf { it.scenario.calculate() != null } }
    var matches by remember { mutableStateOf<List<GradingSearchResult.Card>>(emptyList()) }
    var expenses by remember { mutableStateOf(runCatching { json.decodeFromString<List<GradingExpense>>(preferences.getString("expenses", "[]")!!) }.getOrDefault(emptyList())) }
    var serviceTier by remember { mutableStateOf(draft?.serviceTier ?: "") }
    var byGrader by remember { mutableStateOf<Map<String, List<GradingOutcome>>>(emptyMap()) }
    var name by remember { mutableStateOf(draft?.name ?: "") }
    var productId by remember { mutableStateOf("") }
    var language by remember { mutableStateOf("english") }
    var grader by remember { mutableStateOf(draft?.grader ?: "PSA") }
    var currency by remember { mutableStateOf(draft?.currency ?: "USD") }
    var raw by remember { mutableStateOf(draft?.scenario?.rawValue?.toString() ?: "") }
    var costs by remember { mutableStateOf(draft?.scenario?.costs ?: emptyMap()) }
    var outcomes by remember { mutableStateOf(draft?.scenario?.outcomes ?: GradingOutcome.blank("PSA")) }
    var interpolate by remember { mutableStateOf(draft?.scenario?.interpolate ?: false) }
    var snapshot by remember { mutableStateOf(draft?.snapshot) }
    var section by remember { mutableStateOf("Decision") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current
    val scenario = raw.toDoubleOrNull()?.let { GradingScenario(it, costs, outcomes, interpolate) }
    val result = scenario?.calculate()
    val money: (Double?) -> String = { value -> value?.let { NumberFormat.getCurrencyInstance().apply { this.currency = Currency.getInstance(currency) }.format(it) } ?: "Unavailable" }
    val graders = (listOf("PSA", "BGS", "CGC", "SGC", "ACE", "TAG", "HGA", "ARS") + snapshot?.graders.orEmpty().map { it.grader }).distinct()
    Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp).testTag("feature.pricing.gradingWorkspace"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Grading planner", style = MaterialTheme.typography.headlineSmall)
        Text("Manual estimates work for any game. Live lookup covers Pokémon.")
        OutlinedTextField(name, { name = it }, label = { Text("Card / scenario") }, modifier = Modifier.fillMaxWidth())
        Button(onClick = {
            if (repository == null) message = "Connect and sign in to search market data. Manual calculations work offline."
            else scope.launch {
                busy = true; matches = emptyList(); message = null
                try {
                    matches = repository.searchGradingCards(GradingSearchRequest(name, language)).cards
                    if (matches.isEmpty()) message = "No matching cards. Try a different name or enter manual estimates."
                } catch (e: kotlinx.coroutines.CancellationException) { throw e }
                catch (e: Exception) { message = e.message ?: "Card search failed" }
                finally { busy = false }
            }
        }, enabled = !busy && name.trim().length >= 3) { Text("Find Pokémon card by name") }
        matches.forEach { match ->
            OutlinedButton(onClick = {
                productId = match.tcgPlayerId; name = "${match.name} · ${match.setName} · ${match.collectorNumber}"
                matches = emptyList(); snapshot = null; byGrader = emptyMap(); outcomes = GradingOutcome.blank(grader); raw = ""
                message = "Card selected. Load market data to see its grade prices."
            }) { Text("${match.name} · ${match.setName} · ${match.collectorNumber}") }
        }
        OutlinedTextField(productId, { productId = it }, label = { Text("Pokémon TCGplayer product ID") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
        GradingChoice("Card language", language, listOf("english", "japanese")) { language = it }
        Button(onClick = {
            if (repository == null) { message = "Connect and sign in to load market data. Manual calculations work offline." }
            else scope.launch {
                busy = true; message = null
                try {
                    val loaded = repository.getGradingSnapshot(GradingSnapshotRequest(productId, language))
                    snapshot = loaded; name = "${loaded.name} · ${loaded.setName} · ${loaded.collectorNumber}"
                    if (currency != "USD") costs = emptyMap()
                    currency = "USD"; raw = ""; byGrader = emptyMap()
                    outcomes = loaded.graders.find { it.grader == grader }?.outcomes ?: GradingOutcome.blank(grader)
                    message = "Loaded in USD. Select your raw printing and condition, and review your USD costs."
                } catch (e: kotlinx.coroutines.CancellationException) { throw e }
                catch (e: Exception) { message = e.message ?: "Could not load market data" }
                finally { busy = false }
            }
        }, enabled = !busy && productId.matches(Regex("\\d+"))) { Text(if (busy) "Loading…" else "Load market data") }
        message?.let { Text(it) }
        snapshot?.let { loaded ->
            Text("${loaded.name} · ${loaded.setName} · ${loaded.collectorNumber}")
            TextButton(onClick = { uriHandler.openUri(loaded.sourceUrl) }) { Text(loaded.source) }
            Text("Retrieved ${loaded.retrievedAt} · Source updated ${loaded.priceAsOf ?: "date unavailable"}", style = MaterialTheme.typography.bodySmall)
            Text("Check the matched card and printing. Sale counts are lifetime counts, not recent volume.", style = MaterialTheme.typography.bodySmall)
            loaded.warnings.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
        GradingChoice("Grader", grader, graders) { byGrader = byGrader + (grader to outcomes); grader = it; outcomes = byGrader[it] ?: snapshot?.graders?.find { g -> g.grader == it }?.outcomes ?: GradingOutcome.blank(it) }
        GradingChoice("Currency", currency, listOf("USD", "CAD", "EUR", "GBP"), snapshot == null) { currency = it }
        OutlinedTextField(raw, { raw = it }, label = { Text("Raw value ($currency)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth().testTag("grading.raw"))
        snapshot?.takeIf { it.rawQuotes.isNotEmpty() }?.let { loaded ->
            GradingChoice("Use raw printing / condition", "Select exact printing and condition", loaded.rawQuotes.map { "${it.printing} · ${it.condition} · ${money(it.price)}" }) { selected ->
                loaded.rawQuotes.firstOrNull { "${it.printing} · ${it.condition} · ${money(it.price)}" == selected }?.let { raw = it.price.toString() }
            }
        }
        GradingChoice("View", section, listOf("Decision", "Costs", "Population", "History", "Receipts")) { section = it }
        when (section) {
            "Costs" -> {
                OutlinedTextField(serviceTier, { serviceTier = it }, label = { Text("Service tier / quote reference") }, modifier = Modifier.fillMaxWidth())
                Text("Enter your service quote; no current fee is assumed. All costs are per card in $currency. Changing currency does not convert amounts.")
                GradingScenario.costFields.forEach { (key, label) -> GradingNumberField(label, costs[key] ?: 0.0) { costs = costs + (key to (it ?: 0.0)) } }
                Text("Compare service tiers by changing the quote. Use a unique card/copy label above. Record paid submission costs below to keep a separate receipt.")
                Button(onClick = {
                    val receipt = GradingExpense(java.util.UUID.randomUUID().toString(), name, grader, serviceTier, currency, java.time.Instant.now().toString(), costs["grading"] ?: 0.0, costs["shipping"] ?: 0.0, costs["insurance"] ?: 0.0, costs["upcharge"] ?: 0.0)
                    val records = listOf(receipt) + expenses
                    if (preferences.edit().putString("expenses", json.encodeToString(records)).commit()) { expenses = records; message = "Expense records saved on this device." }
                    else message = "Could not save expense records."
                }, enabled = name.isNotBlank() && (result?.totalCost ?: 0.0) > 0) { Text("Record these submission costs as paid") }
                Text("Receipts are local records; they do not automatically change collection acquisition cost or sale cost basis.")
            }
            "Population" -> {
                Text("Weighted outcomes: ${result?.population ?: 0}")
                if ((result?.population ?: 0) < 50) Text("Low data: fewer than 50 weighted outcomes.")
                val gem = snapshot?.graders?.find { it.grader == grader }?.gemRate
                Text("Provider gem rate: ${gem?.let { "%.1f%%".format(it * 100) } ?: "Unavailable"}")
                result?.rows?.forEach { row ->
                    Text("${row.outcome.label}: ${row.outcome.population ?: "unknown"} · ${row.probability?.let { "%.1f%%".format(it * 100) } ?: "unknown"}")
                    LinearProgressIndicator(progress = { (row.probability ?: 0.0).toFloat() }, modifier = Modifier.fillMaxWidth())
                }
                Text("Edited weights are your scenario, not the provider’s population. All weighted outcomes need prices for an expected-value verdict.")
            }
            "Receipts" -> {
                Text("Actual submission expenses by card/copy. Local receipts are separate from collection cost basis.")
                if (expenses.isEmpty()) Text("No recorded grading expenses.")
                expenses.forEach { expense ->
                    Text("${expense.cardName} · ${expense.grader}", style = MaterialTheme.typography.titleMedium)
                    Text("${expense.serviceTier} · ${expense.paidAt.take(10)}")
                    Text("${expense.total} ${expense.currency} total")
                    Text("Grading ${expense.grading} · Shipping ${expense.shipping} · Insurance ${expense.insurance} · Upcharge ${expense.upcharge}")
                    OutlinedButton(onClick = {
                        val records = expenses.filter { it.id != expense.id }
                        if (preferences.edit().putString("expenses", json.encodeToString(records)).commit()) expenses = records
                        else message = "Could not save expense records."
                    }) { Text("Delete receipt") }
                }
            }
            "History" -> {
                Text("Dated eBay graded sales averages (USD). Editing a current estimate does not alter history.")
                if (outcomes.none { it.history.isNotEmpty() }) Text("No graded history available. Load market data to check coverage.")
                outcomes.filter { it.history.isNotEmpty() }.forEach { row ->
                    var expanded by remember(row.key) { mutableStateOf(false) }
                    TextButton(onClick = { expanded = !expanded }) { Text("${row.label} · ${row.history.size} observations") }
                    if (expanded) row.history.forEach { Text("${it.date} · USD ${it.price}") }
                }
            }
            else -> {
                Text(when (result?.verdict) { "grade" -> "Worth grading under these assumptions"; "keep" -> "Keep it raw under these assumptions"; "borderline" -> "Borderline — close to break-even"; "insufficient" -> "More data needed for an expected-value verdict"; else -> "Enter a raw value and valid nonnegative amounts" }, style = MaterialTheme.typography.titleMedium, modifier = Modifier.testTag("grading.verdict"))
                result?.let {
                    Text("Expected gain over raw: ${money(it.expectedGain)}")
                    Text("Expected graded value: ${money(it.expectedValue)} · Submission cost: ${money(it.totalCost)}")
                    Text("Lowest priced grade beating raw: ${it.breakEven ?: "None"}")
                    Text("Priced population: ${it.pricedPopulation} / ${it.population}")
                }
                Text("These are scenarios, not a prediction of your copy’s grade. Submitted-card populations are selective. Inspect centering, corners, edges, and surfaces.")
                Row { Checkbox(interpolate, { interpolate = it }); Text("Estimate between known numeric grades") }
                Text("Prices and scenario weights. Leave unknown values blank; weight zero excludes an outcome.")
                outcomes.forEach { row -> key(row.key) {
                    HorizontalDivider()
                    Text(row.label, style = MaterialTheme.typography.titleSmall)
                    GradingNumberField("${row.label} value", row.price, "grading.${row.key}.price") { value -> outcomes = outcomes.map { if (it.key == row.key) it.copy(price = value, source = "manual", confidence = null) else it } }
                    GradingNumberField("${row.label} weight / population", row.population?.toDouble(), "grading.${row.key}.weight") { value -> outcomes = outcomes.map { if (it.key == row.key) it.copy(population = value?.let { n -> if (n.isFinite() && n >= 0 && n % 1.0 == 0.0) n.toLong() else -1L }) else it } }
                    val computed = result?.rows?.find { it.outcome.key == row.key }
                    if (computed?.estimated == true) Text("Estimated ${money(computed.price)}")
                    Text("Gain vs raw: ${money(computed?.gain)}")
                    Text(if (row.source == "manual") "Manual estimate" else "${row.salesCount ?: "Unknown"} sales · ${row.confidence ?: "confidence unavailable"}", style = MaterialTheme.typography.bodySmall)
                } }
            }
        }
        Button(onClick = {
            if (scenario != null && result != null) {
                val encoded = json.encodeToString(GradingDraft(name, grader, currency, scenario, serviceTier, snapshot))
                val saved = preferences.edit().putString("draft", encoded).commit()
                message = if (saved) "Scenario saved on this device. It does not change collection cost basis." else "Could not save this scenario."
            }
        }, enabled = result != null) { Text("Save scenario on this device") }
        OutlinedButton(onClick = { snapshot = null; byGrader = emptyMap(); outcomes = GradingOutcome.blank(grader); raw = ""; message = "Manual mode. Enter prices in your selected currency." }) { Text("Clear market data") }
    }
}

@Composable private fun GradingChoice(label: String, value: String, options: List<String>, enabled: Boolean = true, onChange: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { expanded = true }, enabled = enabled) { Text("$label: $value") }
        DropdownMenu(expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option -> DropdownMenuItem(text = { Text(option) }, onClick = { onChange(option); expanded = false }) }
        }
    }
}
@Composable private fun GradingNumberField(label: String, value: Double?, tag: String = label, onChange: (Double?) -> Unit) {
    var text by remember { mutableStateOf(value?.toString() ?: "") }
    LaunchedEffect(value) { if (text.toDoubleOrNull() != value && !(value?.isNaN() == true)) text = value?.toString() ?: "" }
    OutlinedTextField(text, { text = it; onChange(if (it.isBlank()) null else it.toDoubleOrNull() ?: Double.NaN) }, label = { Text(label) }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth().testTag(tag))
}
