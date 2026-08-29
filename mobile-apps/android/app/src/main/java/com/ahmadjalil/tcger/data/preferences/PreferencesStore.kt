package com.ahmadjalil.tcger.data.preferences

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.ahmadjalil.tcger.domain.AccentChoice
import com.ahmadjalil.tcger.domain.AppPreferences
import com.ahmadjalil.tcger.domain.BottomNavigationItem
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
        val userId = stringPreferencesKey("user_id")
        val theme = stringPreferencesKey("theme")
        val accent = stringPreferencesKey("accent")
        val currency = stringPreferencesKey("currency")
        val showPricing = booleanPreferencesKey("show_pricing")
        val showCardNumbers = booleanPreferencesKey("show_card_numbers")
        val biometricLockEnabled = booleanPreferencesKey("biometric_lock_enabled")
        val games = stringPreferencesKey("enabled_games")
        val defaultGame = stringPreferencesKey("default_game")
        val bottomNavigationOrder = stringPreferencesKey("bottom_navigation_order")
        val hiddenBottomNavigationItems = stringPreferencesKey("hidden_bottom_navigation_items")
    }

    val preferences: Flow<AppPreferences> = context.dataStore.data.map { values ->
        val enabledGames = values[Keys.games]?.split(',')?.filter(String::isNotBlank)?.toSet()
            ?: setOf("pokemon", "magic", "yugioh")
        AppPreferences(
            dataSourceMode = values[Keys.mode]?.let { runCatching { DataSourceMode.valueOf(it) }.getOrNull() }
                ?: DataSourceMode.ON_DEVICE,
            serverUrl = values[Keys.serverUrl].orEmpty(),
            authToken = values[Keys.token],
            username = values[Keys.username],
            userId = values[Keys.userId],
            themeMode = values[Keys.theme]?.let { runCatching { ThemeMode.valueOf(it) }.getOrNull() }
                ?: ThemeMode.SYSTEM,
            accent = values[Keys.accent]?.let { runCatching { AccentChoice.valueOf(it) }.getOrNull() }
                ?: AccentChoice.BLUE,
            currency = values[Keys.currency] ?: "USD",
            showPricing = values[Keys.showPricing] ?: true,
            showCardNumbers = values[Keys.showCardNumbers] ?: true,
            biometricLockEnabled = values[Keys.biometricLockEnabled] ?: false,
            enabledGames = enabledGames,
            defaultGame = values[Keys.defaultGame]?.takeIf(enabledGames::contains),
            bottomNavigationOrder = BottomNavigationItem.normalizedOrder(
                values[Keys.bottomNavigationOrder]?.split(',').orEmpty(),
            ),
            hiddenBottomNavigationItems = BottomNavigationItem.normalizedHidden(
                values[Keys.hiddenBottomNavigationItems]?.split(',').orEmpty(),
            ),
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
        it.remove(Keys.userId)
    }

    suspend fun saveSession(token: String, username: String, userId: String? = null) = context.dataStore.edit {
        it[Keys.token] = token
        it[Keys.username] = username
        if (userId.isNullOrBlank()) it.remove(Keys.userId) else it[Keys.userId] = userId
    }

    suspend fun signOut() = context.dataStore.edit {
        it.remove(Keys.token)
        it.remove(Keys.username)
        it.remove(Keys.userId)
    }

    suspend fun setTheme(theme: ThemeMode) = context.dataStore.edit { it[Keys.theme] = theme.name }
    suspend fun setAccent(accent: AccentChoice) = context.dataStore.edit { it[Keys.accent] = accent.name }
    suspend fun setCurrency(currency: String) = context.dataStore.edit { it[Keys.currency] = currency.uppercase() }
    suspend fun setShowPricing(show: Boolean) = context.dataStore.edit { it[Keys.showPricing] = show }
    suspend fun setShowCardNumbers(show: Boolean) = context.dataStore.edit { it[Keys.showCardNumbers] = show }
    suspend fun setBiometricLockEnabled(enabled: Boolean) = context.dataStore.edit {
        it[Keys.biometricLockEnabled] = enabled
    }
    suspend fun setDefaultGame(game: String?) = context.dataStore.edit { values ->
        if (game.isNullOrBlank()) values.remove(Keys.defaultGame) else values[Keys.defaultGame] = game
    }

    suspend fun setGameEnabled(game: String, enabled: Boolean) = context.dataStore.edit { values ->
        val games = values[Keys.games]?.split(',')?.filter(String::isNotBlank)?.toMutableSet()
            ?: mutableSetOf("pokemon", "magic", "yugioh")
        if (enabled) games += game else {
            games -= game
            if (values[Keys.defaultGame] == game) values.remove(Keys.defaultGame)
        }
        values[Keys.games] = games.sorted().joinToString(",")
    }

    suspend fun setBottomNavigationItemVisible(item: BottomNavigationItem, visible: Boolean) =
        context.dataStore.edit { values ->
            if (item.isPinned) return@edit
            val hidden = BottomNavigationItem.normalizedHidden(
                values[Keys.hiddenBottomNavigationItems]?.split(',').orEmpty(),
            ).toMutableSet()
            if (visible) hidden -= item else hidden += item
            values[Keys.hiddenBottomNavigationItems] = BottomNavigationItem.encodeHidden(hidden)
        }

    suspend fun setBottomNavigationOrder(order: List<BottomNavigationItem>) = context.dataStore.edit {
        it[Keys.bottomNavigationOrder] = BottomNavigationItem.encodeOrder(order)
    }

    suspend fun resetBottomNavigation() = context.dataStore.edit {
        it.remove(Keys.bottomNavigationOrder)
        it.remove(Keys.hiddenBottomNavigationItems)
    }
}

fun normalizeServerUrl(raw: String): String {
    val trimmed = raw.trim().trimEnd('/')
    if (trimmed.isEmpty()) return ""
    val withScheme = if ("://" in trimmed) trimmed else "https://$trimmed"
    return "$withScheme/"
}
