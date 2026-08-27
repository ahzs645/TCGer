package com.ahmadjalil.tcger.data.preferences

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.ahmadjalil.tcger.domain.AccentChoice
import com.ahmadjalil.tcger.domain.AppPreferences
import com.ahmadjalil.tcger.domain.DataSourceMode
import com.ahmadjalil.tcger.domain.ThemeMode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "tcger_preferences")

class PreferencesStore(private val context: Context) {
    private object Keys {
        val mode = stringPreferencesKey("data_source_mode")
        val serverUrl = stringPreferencesKey("server_url")
        val token = stringPreferencesKey("auth_token")
        val username = stringPreferencesKey("username")
        val theme = stringPreferencesKey("theme")
        val accent = stringPreferencesKey("accent")
        val currency = stringPreferencesKey("currency")
        val showPricing = booleanPreferencesKey("show_pricing")
        val games = stringPreferencesKey("enabled_games")
    }

    val preferences: Flow<AppPreferences> = context.dataStore.data.map { values ->
        AppPreferences(
            dataSourceMode = values[Keys.mode]?.let { runCatching { DataSourceMode.valueOf(it) }.getOrNull() }
                ?: DataSourceMode.ON_DEVICE,
            serverUrl = values[Keys.serverUrl].orEmpty(),
            authToken = values[Keys.token],
            username = values[Keys.username],
            themeMode = values[Keys.theme]?.let { runCatching { ThemeMode.valueOf(it) }.getOrNull() }
                ?: ThemeMode.SYSTEM,
            accent = values[Keys.accent]?.let { runCatching { AccentChoice.valueOf(it) }.getOrNull() }
                ?: AccentChoice.BLUE,
            currency = values[Keys.currency] ?: "USD",
            showPricing = values[Keys.showPricing] ?: true,
            enabledGames = values[Keys.games]?.split(',')?.filter(String::isNotBlank)?.toSet()
                ?: setOf("pokemon", "magic", "yugioh"),
        )
    }

    suspend fun current(): AppPreferences = preferences.first()

    suspend fun useOnDevice() = context.dataStore.edit {
        it[Keys.mode] = DataSourceMode.ON_DEVICE.name
    }

    suspend fun configureServer(url: String) = context.dataStore.edit {
        it[Keys.mode] = DataSourceMode.SERVER.name
        it[Keys.serverUrl] = normalizeServerUrl(url)
        it.remove(Keys.token)
        it.remove(Keys.username)
    }

    suspend fun saveSession(token: String, username: String) = context.dataStore.edit {
        it[Keys.token] = token
        it[Keys.username] = username
    }

    suspend fun signOut() = context.dataStore.edit {
        it.remove(Keys.token)
        it.remove(Keys.username)
    }

    suspend fun setTheme(theme: ThemeMode) = context.dataStore.edit { it[Keys.theme] = theme.name }
    suspend fun setAccent(accent: AccentChoice) = context.dataStore.edit { it[Keys.accent] = accent.name }
    suspend fun setCurrency(currency: String) = context.dataStore.edit { it[Keys.currency] = currency.uppercase() }
    suspend fun setShowPricing(show: Boolean) = context.dataStore.edit { it[Keys.showPricing] = show }

    suspend fun setGameEnabled(game: String, enabled: Boolean) = context.dataStore.edit { values ->
        val games = values[Keys.games]?.split(',')?.filter(String::isNotBlank)?.toMutableSet()
            ?: mutableSetOf("pokemon", "magic", "yugioh")
        if (enabled) games += game else games -= game
        values[Keys.games] = games.sorted().joinToString(",")
    }
}

fun normalizeServerUrl(raw: String): String {
    val trimmed = raw.trim().trimEnd('/')
    if (trimmed.isEmpty()) return ""
    val withScheme = if ("://" in trimmed) trimmed else "https://$trimmed"
    return "$withScheme/"
}
