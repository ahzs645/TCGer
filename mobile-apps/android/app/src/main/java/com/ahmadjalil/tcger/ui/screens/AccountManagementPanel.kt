package com.ahmadjalil.tcger.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.ui.AppUiState
import com.ahmadjalil.tcger.ui.AppViewModel
import com.ahmadjalil.tcger.domain.DataSourceMode
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable
fun AccountManagementPanel(state: AppUiState, viewModel: AppViewModel) {
    if (state.preferences.dataSourceMode != DataSourceMode.SERVER || state.preferences.serverUrl.isBlank()) return
    var open by remember { mutableStateOf(false) }
    var username by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var currentPassword by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var confirmDeletion by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    fun run(message: String, action: suspend () -> Unit) { scope.launch {
        busy = true
        runCatching { action() }.onSuccess { notice = message; currentPassword = ""; password = ""; confirmPassword = "" }.onFailure { notice = it.message }
        busy = false
    } }
    OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) { Text(if (state.preferences.isSignedIn) "Manage account" else if (state.serverSetupRequired) "Create first administrator" else "Create server account") }
    LaunchedEffect(open, state.preferences.authToken) {
        if (open && state.preferences.isSignedIn) runCatching { viewModel.loadProfile() }.onSuccess {
            username = it["username"]?.jsonPrimitive?.contentOrNull.orEmpty()
            email = it["email"]?.jsonPrimitive?.contentOrNull.orEmpty()
        }.onFailure { notice = it.message }
    }
    if (open) AlertDialog(onDismissRequest = { if (!busy) { open = false; currentPassword = ""; password = ""; confirmPassword = "" } }, title = { Text("Server account") },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            notice?.let { Text(it) }
            OutlinedTextField(username, { username = it }, label = { Text("Username") })
            OutlinedTextField(email, { email = it }, label = { Text("Email") })
            if (state.preferences.isSignedIn) {
                Button(enabled = !busy, onClick = { run("Profile saved") { viewModel.updateProfile(username, email) } }) { Text("Save profile") }
                TextButton(enabled = !busy, onClick = { run("Preferences refreshed") { viewModel.syncAccountPreferences() } }) { Text("Sync account preferences") }
                OutlinedTextField(currentPassword, { currentPassword = it }, label = { Text("Current password") }, visualTransformation = PasswordVisualTransformation())
            }
            OutlinedTextField(password, { password = it }, label = { Text(if (state.preferences.isSignedIn) "New password" else "Password") }, visualTransformation = PasswordVisualTransformation())
            OutlinedTextField(confirmPassword, { confirmPassword = it }, label = { Text("Confirm password") }, visualTransformation = PasswordVisualTransformation())
            Button(enabled = !busy && password.length >= 8 && password == confirmPassword, onClick = {
                if (state.preferences.isSignedIn) run("Password changed") { viewModel.changePassword(currentPassword, password) }
                else run("Account created") { viewModel.signUp(username, email, password); if (state.serverSetupRequired) viewModel.finishAdminSetup() }
            }) { Text(if (state.preferences.isSignedIn) "Change password" else "Create account") }
            if (state.preferences.isSignedIn) TextButton(enabled = !busy && currentPassword.isNotBlank(), onClick = { confirmDeletion = true }) { Text("Delete server account", color = MaterialTheme.colorScheme.error) }
        } }, confirmButton = { TextButton(enabled = !busy, onClick = { open = false; currentPassword = ""; password = ""; confirmPassword = "" }) { Text("Done") } })
    if (confirmDeletion) AlertDialog(onDismissRequest = { confirmDeletion = false }, title = { Text("Permanently delete your account?") },
        text = { Text("Your server collection, wishlists, finance history, and account will be removed. Local device data is kept.") },
        confirmButton = { TextButton(enabled = !busy, onClick = { confirmDeletion = false; run("Account deleted") { viewModel.deleteAccount(currentPassword); open = false } }) { Text("Delete permanently") } },
        dismissButton = { TextButton(onClick = { confirmDeletion = false }) { Text("Cancel") } })
}
