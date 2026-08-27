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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.domain.Binder
import com.ahmadjalil.tcger.generated.ParityControlIDs
import com.ahmadjalil.tcger.generated.ParityFeatureIDs
import com.ahmadjalil.tcger.ui.AppUiState

@Composable
fun CollectionsScreen(
    state: AppUiState,
    contentPadding: PaddingValues,
    onCreate: (String) -> Unit,
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
        ScreenTitle("Binders", "Organize your physical collection") {
            FloatingActionButton(
                onClick = { creating = true },
                modifier = Modifier.testTag(ParityControlIDs.ACTION_COLLECTIONS_CREATE),
            ) { Icon(Icons.Default.Add, "New binder") }
        }
        if (state.isLoading) LoadingPane()
        else if (state.binders.isEmpty()) EmptyPane("No binders yet", "Tap + to create your first binder.")
        else LazyColumn(
            Modifier.fillMaxSize().padding(top = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            items(state.binders, key = { it.id }) { binder -> BinderRow(binder, onOpen, onDelete) }
        }
    }

    if (creating) NameDialog(
        title = "New binder",
        label = "Binder name",
        onDismiss = { creating = false },
        inputTestId = ParityControlIDs.INPUT_COLLECTIONS_NAME,
        confirmTestId = ParityControlIDs.ACTION_COLLECTIONS_CONFIRM_CREATE,
    ) {
        onCreate(it)
        creating = false
    }
}

@Composable
private fun BinderRow(binder: Binder, onOpen: (String) -> Unit, onDelete: (String) -> Unit) {
    Card(
        Modifier.fillMaxWidth().clickable { onOpen(binder.id) },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.Folder, null, tint = MaterialTheme.colorScheme.primary)
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                Text(binder.name, fontWeight = FontWeight.SemiBold)
                Text("${binder.uniqueCards} unique · ${binder.totalCopies} copies", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = { onDelete(binder.id) }) { Icon(Icons.Default.Delete, "Delete ${binder.name}") }
        }
    }
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
            ) { Text("Create") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
