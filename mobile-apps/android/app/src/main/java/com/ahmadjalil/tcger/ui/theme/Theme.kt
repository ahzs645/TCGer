package com.ahmadjalil.tcger.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import com.ahmadjalil.tcger.domain.AccentChoice
import com.ahmadjalil.tcger.domain.ThemeMode

@Composable
fun TCGerTheme(themeMode: ThemeMode, accent: AccentChoice, content: @Composable () -> Unit) {
    val dark = when (themeMode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
    val context = LocalContext.current
    val seed = accent.color
    val colors = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && accent == AccentChoice.BLUE -> {
            if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        dark -> darkColorScheme(primary = seed, secondary = seed.copy(alpha = 0.78f))
        else -> lightColorScheme(primary = seed, secondary = seed.copy(alpha = 0.78f))
    }
    MaterialTheme(colorScheme = colors, content = content)
}

val AccentChoice.color: Color
    get() = when (this) {
        AccentChoice.BLUE -> Color(0xFF315DA8)
        AccentChoice.GREEN -> Color(0xFF247A55)
        AccentChoice.ORANGE -> Color(0xFFA65216)
        AccentChoice.PURPLE -> Color(0xFF7046A1)
        AccentChoice.RED -> Color(0xFFAA3C45)
        AccentChoice.TEAL -> Color(0xFF087D80)
    }
