package com.ahmadjalil.tcger

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.ahmadjalil.tcger.ui.TCGerApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ParityTestMode.isEnabled = intent.getStringExtra("tcgerParityTest") == "true"
        enableEdgeToEdge()
        val container = (application as TCGerApplication).container
        setContent { TCGerApp(container) }
    }
}
