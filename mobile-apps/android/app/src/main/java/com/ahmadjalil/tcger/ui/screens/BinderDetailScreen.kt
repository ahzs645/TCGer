package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Link
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.domain.Binder
import com.ahmadjalil.tcger.domain.BinderInput
import com.ahmadjalil.tcger.domain.BinderShareLink
import com.ahmadjalil.tcger.R
import coil.compose.AsyncImage
import java.net.URI
import kotlinx.coroutines.launch

@Composable
fun BinderDetailScreen(
    binder: Binder?,
    contentPadding: PaddingValues,
    showPricing: Boolean,
    showCardNumbers: Boolean,
    currency: String,
    shareSiteUrl: String,
    onBack: () -> Unit,
    onRemove: (String, String) -> Unit,
    onUpdate: (String, BinderInput) -> Unit,
    onLoadShareLinks: suspend (String) -> List<BinderShareLink>,
    onCreateShareLink: suspend (String, String) -> BinderShareLink,
    onRevokeShareLink: suspend (String, String) -> Unit,
) {
    if (binder == null) {
        EmptyPane("Binder unavailable", "It may have been removed or is still loading.")
        return
    }
    var editing by remember(binder.id) { mutableStateOf(false) }
    var sharing by remember(binder.id) { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().padding(
            start = 16.dp,
            end = 16.dp,
            top = contentPadding.calculateTopPadding() + 12.dp,
            bottom = contentPadding.calculateBottomPadding(),
        ),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            binder.imageUrl?.takeIf(String::isNotBlank)?.let { coverUrl ->
                AsyncImage(
                    model = coverUrl,
                    contentDescription = "${binder.name} cover",
                    modifier = Modifier.size(48.dp).padding(end = 8.dp),
                )
            }
            Column(Modifier.weight(1f)) {
                Text(binder.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    "${binder.uniqueCards} unique · ${binder.totalCopies} copies" +
                        if (showPricing) " · ${binder.totalValue.asCurrency(currency)}" else "",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                binder.description?.takeIf(String::isNotBlank)?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                binder.defaultCondition?.takeIf(String::isNotBlank)?.let {
                    Text(
                        stringResource(R.string.default_condition_value, it),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                binder.containerType?.takeIf(String::isNotBlank)?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            IconButton(onClick = { editing = true }) {
                Icon(Icons.Default.Edit, stringResource(R.string.edit_binder))
            }
            IconButton(onClick = { sharing = true }) {
                Icon(Icons.Default.Link, "Manage share links")
            }
        }
        if (binder.cards.isEmpty()) EmptyPane("This binder is empty", "Use Search to find a card, then add it to this binder.")
        else LazyColumn(
            Modifier.fillMaxSize().padding(top = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            items(binder.cards, key = { it.id }) { owned ->
                CatalogCardRow(owned.card, showCardNumbers = showCardNumbers) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("×${owned.quantity}", fontWeight = FontWeight.Bold)
                        IconButton(onClick = { onRemove(binder.id, owned.id) }) {
                            Icon(Icons.Default.Delete, "Remove ${owned.card.name}")
                        }
                    }
                }
            }
        }
    }

    if (editing) BinderEditorDialog(
        title = stringResource(R.string.edit_binder),
        confirmLabel = stringResource(R.string.save),
        initial = binder,
        onDismiss = { editing = false },
        onConfirm = {
            onUpdate(binder.id, it)
            editing = false
        },
    )
    if (sharing) BinderShareLinksDialog(
        binder = binder,
        shareSiteUrl = shareSiteUrl,
        onDismiss = { sharing = false },
        onLoad = onLoadShareLinks,
        onCreate = onCreateShareLink,
        onRevoke = onRevokeShareLink,
    )
}

@Composable
private fun BinderShareLinksDialog(
    binder: Binder,
    shareSiteUrl: String,
    onDismiss: () -> Unit,
    onLoad: suspend (String) -> List<BinderShareLink>,
    onCreate: suspend (String, String) -> BinderShareLink,
    onRevoke: suspend (String, String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var links by remember(binder.id) { mutableStateOf<List<BinderShareLink>>(emptyList()) }
    var label by remember(binder.id) { mutableStateOf("") }
    var loading by remember(binder.id) { mutableStateOf(true) }
    var error by remember(binder.id) { mutableStateOf<String?>(null) }
    var pendingRevoke by remember(binder.id) { mutableStateOf<BinderShareLink?>(null) }

    LaunchedEffect(binder.id) {
        runCatching { onLoad(binder.id) }
            .onSuccess { links = it }
            .onFailure { error = it.message ?: "Could not load share links" }
        loading = false
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Share ${binder.name}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Create separate links and revoke each one independently.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(label, { label = it }, label = { Text("Link label") }, singleLine = true)
                Button(
                    onClick = {
                        scope.launch {
                            runCatching { onCreate(binder.id, label.trim()) }
                                .onSuccess { links = listOf(it) + links; label = "" }
                                .onFailure { error = it.message ?: "Could not create share link" }
                        }
                    },
                    enabled = label.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Create link") }
                if (loading) Text("Loading links…")
                links.forEach { link ->
                    val url = publicShareUrl(shareSiteUrl, link.token)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(link.label, fontWeight = FontWeight.SemiBold)
                            Text(url, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                        }
                        TextButton(onClick = { clipboard.setText(AnnotatedString(url)) }) { Text("Copy") }
                        TextButton(onClick = { pendingRevoke = link }) { Text("Revoke") }
                    }
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
    )

    pendingRevoke?.let { link ->
        AlertDialog(
            onDismissRequest = { pendingRevoke = null },
            title = { Text("Revoke ${link.label}?") },
            text = { Text("Anyone using this link will immediately lose access.") },
            confirmButton = {
                TextButton(onClick = {
                    pendingRevoke = null
                    scope.launch {
                        runCatching { onRevoke(binder.id, link.id) }
                            .onSuccess { links = links.filterNot { it.id == link.id } }
                            .onFailure { error = it.message ?: "Could not revoke share link" }
                    }
                }) { Text("Revoke") }
            },
            dismissButton = { TextButton(onClick = { pendingRevoke = null }) { Text("Cancel") } },
        )
    }
}

private fun publicShareUrl(serverUrl: String, token: String): String = runCatching {
    val source = URI(serverUrl.trim().trimEnd('/'))
    val sitePort = if (source.port == 3004) 3003 else source.port
    val basePath = source.path.orEmpty().trimEnd('/').removeSuffix("/api")
    URI(source.scheme, source.userInfo, source.host, sitePort, "$basePath/shared/$token", null, null).toString()
}.getOrElse { token }
