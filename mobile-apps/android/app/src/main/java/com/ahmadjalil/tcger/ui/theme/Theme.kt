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
import androidx.compose.ui.graphics.lerp
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
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && accent == AccentChoice.SYSTEM -> {
            if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        dark -> darkColorScheme(primary = lerp(seed, Color.White, 0.60f), onPrimary = Color(0xFF151515),
            primaryContainer = lerp(seed, Color.Black, 0.55f), onPrimaryContainer = Color.White,
            secondary = lerp(seed, Color.White, 0.65f), onSecondary = Color(0xFF151515),
            secondaryContainer = lerp(seed, Color.Black, 0.65f), onSecondaryContainer = Color.White,
            tertiary = lerp(seed, Color.White, 0.7f), onTertiary = Color(0xFF151515))
        else -> lightColorScheme(primary = seed, onPrimary = Color.White,
            primaryContainer = lerp(seed, Color.White, 0.88f), onPrimaryContainer = Color(0xFF151515),
            secondary = seed, onSecondary = Color.White,
            secondaryContainer = lerp(seed, Color.White, 0.92f), onSecondaryContainer = Color(0xFF151515),
            tertiary = seed, onTertiary = Color.White)
    }
    MaterialTheme(colorScheme = colors, content = content)
}

val AccentChoice.color: Color
    get() = when (this) {
        AccentChoice.SYSTEM, AccentChoice.BLUE -> Color(0xFF315DA8)
        AccentChoice.GREEN -> Color(0xFF247A55)
        AccentChoice.ORANGE -> Color(0xFFA65216)
        AccentChoice.PURPLE -> Color(0xFF7046A1)
        AccentChoice.RED -> Color(0xFFAA3C45)
        AccentChoice.TEAL -> Color(0xFF087D80)
    }
