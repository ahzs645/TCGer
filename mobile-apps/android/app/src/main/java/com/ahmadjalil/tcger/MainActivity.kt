// @tcger-feature {"id":"security.biometricLock","platform":"android","status":"partial","requires":["device-authentication"],"limitation":"Biometric or device-credential lock exists; unavailable authenticators remain locked with device-security setup access; physical-device enrollment, lockout and release lifecycle verification remain outstanding."}
// @tcger-feature {"id":"widgets.sessionPrivacy","platform":"android","status":"not_applicable","limitation":"No home screen widget extension is shipped on this surface."}
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
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
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
    private val appLock = com.ahmadjalil.tcger.ui.DeviceAppLockState()
    private val unlocked get() = appLock.unlocked
    private val unlockError get() = appLock.error
    private var preferencesLoaded = false

    private val legacyCredential = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()) { result ->
        appLock.complete(result.resultCode == RESULT_OK, lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED), "Device authentication was cancelled.")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ParityTestMode.isEnabled = BuildConfig.DEBUG && intent.getStringExtra("tcgerParityTest") == "true"
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
                ) { LockedAppScreen(error = unlockError.value, onUnlock = ::authenticate, onSecuritySettings = { startActivity(Intent(android.provider.Settings.ACTION_SECURITY_SETTINGS)) }) }
            }
        }
        lifecycleScope.launch {
            container.preferences.preferences.collectLatest { preferences ->
                preferencesLoaded = true
                if (preferences.biometricLockEnabled) window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
                else window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
                if (appLock.configure(preferences.biometricLockEnabled, ParityTestMode.isEnabled)) authenticate()
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
        if (preferencesLoaded && appLock.enabled && !unlocked.value && !appLock.promptActive && !ParityTestMode.isEnabled) {
            authenticate()
        }
    }

    override fun onStop() {
        super.onStop()
        appLock.background()
    }

    private fun authenticate() {
        if (!appLock.begin()) return
        if (android.os.Build.VERSION.SDK_INT < 30) {
            val keyguard = getSystemService(android.app.KeyguardManager::class.java)
            val intent = keyguard.createConfirmDeviceCredentialIntent("Unlock TCGer", "Use your device screen lock")
            if (intent == null) {
                appLock.unavailable("Set up a device screen lock to unlock TCGer.")
            } else {
                legacyCredential.launch(intent)
            }
            return
        }
        val authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL
        if (BiometricManager.from(this).canAuthenticate(authenticators) != BiometricManager.BIOMETRIC_SUCCESS) {
            appLock.unavailable("Device authentication is unavailable. Set up your screen lock or try again when it becomes available.")
            return
        }
        val prompt = BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    appLock.complete(true, lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    appLock.complete(false, lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED), errString.toString())
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
private fun LockedAppScreen(error: String?, onUnlock: () -> Unit, onSecuritySettings: () -> Unit) {
    MaterialTheme {
        Column(
            Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("TCGer is locked", style = MaterialTheme.typography.headlineSmall)
            error?.let { Text(it, Modifier.padding(24.dp)) }
            Button(onClick = onUnlock) { Text("Unlock") }
            if (error != null) Button(onClick = onSecuritySettings) { Text("Device security settings") }
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
