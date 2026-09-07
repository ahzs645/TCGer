package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.ui.AppViewModel
import java.util.Currency

@Composable
fun CurrencySettingsPanel(currency: String, viewModel: AppViewModel) {
    var open by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    val rate by viewModel.currencyRateStatus.collectAsState()
    val currencies = remember { Currency.getAvailableCurrencies().filter { it.defaultFractionDigits >= 0 }.sortedBy { it.displayName } }
    OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) { Text("Display currency · $currency") }
    if (currency == "USD") Text("Saved market values are in USD; no conversion is needed.", style = MaterialTheme.typography.bodySmall)
    else {
        rate.rate?.let { Text("1 USD = $it ${rate.currency}", style = MaterialTheme.typography.bodyMedium) }
        rate.date?.let { Text("Rate date: $it · ${rate.source.orEmpty()}", style = MaterialTheme.typography.bodySmall) }
        rate.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        TextButton(enabled = !rate.refreshing, onClick = viewModel::refreshCurrencyRate) { Text(if (rate.refreshing) "Refreshing…" else "Refresh exchange rate") }
    }
    if (open) AlertDialog(onDismissRequest = { open = false }, title = { Text("Display currency") }, text = {
        Column {
            OutlinedTextField(query, { query = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Currency name or code") }, singleLine = true)
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                items(currencies.filter { it.currencyCode.contains(query, true) || it.displayName.contains(query, true) }, key = { it.currencyCode }) { item ->
                    TextButton(onClick = { viewModel.setCurrency(item.currencyCode); open = false; query = "" }, modifier = Modifier.fillMaxWidth()) {
                        Text("${if (currency == item.currencyCode) "✓ " else ""}${item.displayName} · ${item.currencyCode}", modifier = Modifier.fillMaxWidth())
                    }
                }
            }
            Text("Conversion depends on an available exchange rate. Saved prices keep their original currency.", style = MaterialTheme.typography.bodySmall)
        }
    }, confirmButton = { TextButton(onClick = { open = false }) { Text("Done") } })
}
