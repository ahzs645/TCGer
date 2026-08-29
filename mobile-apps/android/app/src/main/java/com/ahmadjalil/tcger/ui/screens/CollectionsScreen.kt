package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.R
import com.ahmadjalil.tcger.domain.Binder
import com.ahmadjalil.tcger.domain.BinderInput
import com.ahmadjalil.tcger.domain.hasValidCoverUrl
import com.ahmadjalil.tcger.generated.ParityControlIDs
import com.ahmadjalil.tcger.generated.ParityFeatureIDs
import com.ahmadjalil.tcger.ui.AppUiState

internal val binderColors = listOf(
    "90CAF9", "42A5F5", "1976D2", "81C784", "66BB6A", "388E3C",
    "FFB74D", "FFA726", "FBC02D", "E57373", "F06292", "EC407A",
    "BA68C8", "9575CD", "7E57C2", "4DB6AC", "26A69A", "78909C",
)
internal val cardConditions = listOf("Mint", "Near Mint", "Excellent", "Good", "Light Played", "Played", "Poor")

@Composable
fun CollectionsScreen(
    state: AppUiState,
    contentPadding: PaddingValues,
    onCreate: (BinderInput) -> Unit,
    onDelete: (String) -> Unit,
    onOpen: (String) -> Unit,
) {
    var creating by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().testTag(ParityFeatureIDs.screen(ParityFeatureIDs.COLLECTIONS_BROWSE)).padding(
            start = 16.dp,
            end = 16.dp,
            top = contentPadding.calculateTopPadding() + 20.dp,
            bottom = contentPadding.calculateBottomPadding(),
        ),
    ) {
        ScreenTitle(stringResource(R.string.binders_title), stringResource(R.string.binders_subtitle)) {
            FloatingActionButton(
                onClick = { creating = true },
                modifier = Modifier.testTag(ParityControlIDs.ACTION_COLLECTIONS_CREATE),
            ) { Icon(Icons.Default.Add, stringResource(R.string.new_binder)) }
        }
        if (state.isLoading) LoadingPane()
        else if (state.binders.isEmpty()) EmptyPane(stringResource(R.string.no_binders), stringResource(R.string.no_binders_detail))
        else LazyColumn(
            Modifier.fillMaxSize().padding(top = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            items(state.binders, key = { it.id }) { binder -> BinderRow(binder, onOpen, onDelete) }
        }
    }

    if (creating) BinderEditorDialog(
        title = stringResource(R.string.new_binder),
        confirmLabel = stringResource(R.string.create),
        onDismiss = { creating = false },
        inputTestId = ParityControlIDs.INPUT_COLLECTIONS_NAME,
        confirmTestId = ParityControlIDs.ACTION_COLLECTIONS_CONFIRM_CREATE,
        onConfirm = {
            onCreate(it)
            creating = false
        },
    )
}

@Composable
private fun BinderRow(binder: Binder, onOpen: (String) -> Unit, onDelete: (String) -> Unit) {
    Card(
        Modifier.fillMaxWidth().clickable { onOpen(binder.id) },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(42.dp).clip(CircleShape).background(binder.colorHex.toComposeColor()),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Default.Folder, null, tint = Color.White) }
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                Text(binder.name, fontWeight = FontWeight.SemiBold)
                Text(
                    stringResource(R.string.binder_card_count, binder.uniqueCards, binder.totalCopies),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                binder.containerType?.takeIf(String::isNotBlank)?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            IconButton(onClick = { onDelete(binder.id) }) {
                Icon(Icons.Default.Delete, stringResource(R.string.delete_binder, binder.name))
            }
        }
    }
}

@Composable
@OptIn(ExperimentalComposeUiApi::class)
fun BinderEditorDialog(
    title: String,
    confirmLabel: String,
    onDismiss: () -> Unit,
    onConfirm: (BinderInput) -> Unit,
    initial: Binder? = null,
    inputTestId: String? = null,
    confirmTestId: String? = null,
) {
    var name by remember(initial?.id) { mutableStateOf(initial?.name.orEmpty()) }
    var description by remember(initial?.id) { mutableStateOf(initial?.description.orEmpty()) }
    var colorHex by remember(initial?.id) { mutableStateOf(initial?.colorHex ?: binderColors.first()) }
    var defaultCondition by remember(initial?.id) { mutableStateOf(initial?.defaultCondition.orEmpty()) }
    var containerType by remember(initial?.id) { mutableStateOf(initial?.containerType.orEmpty()) }
    var imageUrl by remember(initial?.id) { mutableStateOf(initial?.imageUrl.orEmpty()) }
    var conditionMenuOpen by remember { mutableStateOf(false) }
    val input = BinderInput(
        name = name,
        description = description,
        colorHex = colorHex,
        defaultCondition = defaultCondition,
        containerType = containerType,
        imageUrl = imageUrl,
        associatedTcg = initial?.associatedTcg,
        associatedSetCode = initial?.associatedSetCode,
        associatedSetName = initial?.associatedSetName,
    )

    AlertDialog(
        modifier = Modifier.semantics { testTagsAsResourceId = true },
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    modifier = (if (inputTestId == null) Modifier else Modifier.testTag(inputTestId)).fillMaxWidth(),
                    label = { Text(stringResource(R.string.binder_name)) },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.description_optional)) },
                    minLines = 2,
                    maxLines = 4,
                )
                Text(stringResource(R.string.color), style = MaterialTheme.typography.labelLarge)
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    binderColors.forEach { option ->
                        val selected = colorHex.equals(option, ignoreCase = true)
                        Box(
                            Modifier.size(38.dp).clip(CircleShape).background(option.toComposeColor()).then(
                                if (selected) Modifier.border(3.dp, MaterialTheme.colorScheme.onSurface, CircleShape) else Modifier,
                            ).clickable { colorHex = option },
                        )
                    }
                }
                Box(Modifier.fillMaxWidth()) {
                    OutlinedButton(onClick = { conditionMenuOpen = true }, modifier = Modifier.fillMaxWidth()) {
                        val condition = defaultCondition.ifBlank { stringResource(R.string.unspecified) }
                        Text(stringResource(R.string.default_condition_value, condition))
                    }
                    DropdownMenu(expanded = conditionMenuOpen, onDismissRequest = { conditionMenuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.unspecified)) },
                            onClick = { defaultCondition = ""; conditionMenuOpen = false },
                        )
                        cardConditions.forEach { condition ->
                            DropdownMenuItem(
                                text = { Text(condition) },
                                onClick = { defaultCondition = condition; conditionMenuOpen = false },
                            )
                        }
                    }
                }
                Text(
                    stringResource(R.string.default_condition_help),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = containerType,
                    onValueChange = { containerType = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.container_type_optional)) },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = imageUrl,
                    onValueChange = { imageUrl = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.cover_url_optional)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    singleLine = true,
                    isError = !input.hasValidCoverUrl,
                    supportingText = if (!input.hasValidCoverUrl) {
                        { Text(stringResource(R.string.cover_url_error)) }
                    } else null,
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(input.normalized()) },
                modifier = if (confirmTestId == null) Modifier else Modifier.testTag(confirmTestId),
                enabled = name.isNotBlank() && input.hasValidCoverUrl,
            ) { Text(confirmLabel) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
@OptIn(ExperimentalComposeUiApi::class)
fun NameDialog(
    title: String,
    label: String,
    onDismiss: () -> Unit,
    inputTestId: String? = null,
    confirmTestId: String? = null,
    onConfirm: (String) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    AlertDialog(
        modifier = Modifier.semantics { testTagsAsResourceId = true },
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                name,
                { name = it },
                modifier = if (inputTestId == null) Modifier else Modifier.testTag(inputTestId),
                label = { Text(label) },
                singleLine = true,
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(name) },
                modifier = if (confirmTestId == null) Modifier else Modifier.testTag(confirmTestId),
                enabled = name.isNotBlank(),
            ) { Text(stringResource(R.string.create)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

internal fun String.toComposeColor(): Color = runCatching {
    Color(android.graphics.Color.parseColor("#${trim().removePrefix("#")}"))
}.getOrDefault(Color(0xFF315DA8))
