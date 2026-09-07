package com.ahmadjalil.tcger

import android.os.Bundle
import android.content.Intent
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.background
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import com.ahmadjalil.tcger.ui.TCGerApp
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collectLatest

class MainActivity : FragmentActivity() {
    private val pendingLink = mutableStateOf<String?>(null)
    private val unlocked = mutableStateOf(false)
    private var biometricEnabled = false
    private var preferencesLoaded = false
    private var promptActive = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ParityTestMode.isEnabled = intent.getStringExtra("tcgerParityTest") == "true"
        pendingLink.value = if (savedInstanceState == null) intent.dataString else savedInstanceState.getString("pending-app-link")
        enableEdgeToEdge()
        val container = (application as TCGerApplication).container
        setContent {
            Box {
                Box(Modifier.alpha(if (unlocked.value) 1f else 0f)) {
                    AppLockLifecycle(unlocked.value) { TCGerApp(container, pendingLink.value) { pendingLink.value = null } }
                }
                if (!unlocked.value) Dialog(
                    onDismissRequest = {},
                    properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false, usePlatformDefaultWidth = false, securePolicy = androidx.compose.ui.window.SecureFlagPolicy.SecureOn),
                ) { LockedAppScreen(onUnlock = ::authenticate) }
            }
        }
        lifecycleScope.launch {
            container.preferences.preferences.collectLatest { preferences ->
                val firstValue = !preferencesLoaded
                biometricEnabled = preferences.biometricLockEnabled
                preferencesLoaded = true
                when {
                    !biometricEnabled || ParityTestMode.isEnabled -> unlocked.value = true
                    firstValue -> authenticate()
                }
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("pending-app-link", pendingLink.value)
        super.onSaveInstanceState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingLink.value = intent.dataString
    }

    override fun onStart() {
        super.onStart()
        if (preferencesLoaded && biometricEnabled && !unlocked.value && !promptActive && !ParityTestMode.isEnabled) {
            authenticate()
        }
    }

    override fun onStop() {
        super.onStop()
        if (biometricEnabled && !promptActive && !isChangingConfigurations) unlocked.value = false
    }

    private fun authenticate() {
        if (promptActive) return
        val authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL
        if (BiometricManager.from(this).canAuthenticate(authenticators) != BiometricManager.BIOMETRIC_SUCCESS) {
            unlocked.value = true
            return
        }
        promptActive = true
        val prompt = BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    promptActive = false
                    unlocked.value = true
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    promptActive = false
                }
            },
        )
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock TCGer")
                .setSubtitle("Use biometrics or your device screen lock")
                .setAllowedAuthenticators(authenticators)
                .build(),
        )
    }
}

@Composable
private fun LockedAppScreen(onUnlock: () -> Unit) {
    MaterialTheme {
        Column(
            Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("TCGer is locked", style = MaterialTheme.typography.headlineSmall)
            Button(onClick = onUnlock) { Text("Unlock") }
        }
    }
}

private class LockLifecycleOwner : LifecycleOwner {
    val registry = LifecycleRegistry(this)
    override val lifecycle: Lifecycle get() = registry
}

/** Preserve navigation/drafts while suspending lifecycle-bound camera and UI work behind the lock. */
@Composable
private fun AppLockLifecycle(unlocked: Boolean, content: @Composable () -> Unit) {
    val parent = LocalLifecycleOwner.current
    val owner = remember(parent) { LockLifecycleOwner() }
    DisposableEffect(parent, unlocked) {
        fun update() {
            val state = parent.lifecycle.currentState
            owner.registry.currentState = if (unlocked || state < Lifecycle.State.CREATED) state else Lifecycle.State.CREATED
        }
        val observer = LifecycleEventObserver { _, _ -> update() }
        parent.lifecycle.addObserver(observer); update()
        onDispose { parent.lifecycle.removeObserver(observer) }
    }
    CompositionLocalProvider(LocalLifecycleOwner provides owner, content = content)
}
