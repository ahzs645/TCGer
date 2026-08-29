package com.ahmadjalil.tcger

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
    private val unlocked = mutableStateOf(false)
    private var biometricEnabled = false
    private var preferencesLoaded = false
    private var promptActive = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ParityTestMode.isEnabled = intent.getStringExtra("tcgerParityTest") == "true"
        enableEdgeToEdge()
        val container = (application as TCGerApplication).container
        setContent {
            if (unlocked.value) TCGerApp(container)
            else LockedAppScreen(onUnlock = ::authenticate)
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
            Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("TCGer is locked", style = MaterialTheme.typography.headlineSmall)
            Button(onClick = onUnlock) { Text("Unlock") }
        }
    }
}
