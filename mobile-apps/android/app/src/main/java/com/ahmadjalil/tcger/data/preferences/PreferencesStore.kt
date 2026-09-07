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
import kotlinx.serialization.json.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart

private val Context.dataStore by preferencesDataStore(name = "tcger_preferences")

class PreferencesStore(private val context: Context) {
    private val cipher = SecretCipher()
    private object Keys {
        val setupComplete = booleanPreferencesKey("setup_complete")
        val sealedProducts = booleanPreferencesKey("sealed_products")
        val mode = stringPreferencesKey("data_source_mode")
        val serverUrl = stringPreferencesKey("server_url")
        val token = stringPreferencesKey("auth_token") // Legacy; removed after encrypted migration.
        val encryptedToken = stringPreferencesKey("encrypted_auth_token")
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

    val preferences: Flow<AppPreferences> = context.dataStore.data.onStart {
        context.dataStore.edit { values ->
            values[Keys.token]?.let { legacy ->
                if (values[Keys.encryptedToken] == null) values[Keys.encryptedToken] = cipher.encrypt(legacy)
                values.remove(Keys.token)
            }
        }
    }.map { values ->
        val enabledGames = values[Keys.games]?.split(',')?.filter(String::isNotBlank)?.toSet()
            ?: setOf("pokemon", "magic", "yugioh")
        AppPreferences(
            setupComplete = values[Keys.setupComplete] ?: values.asMap().isNotEmpty(),
            sealedProductsEnabled = values[Keys.sealedProducts] ?: true,
            dataSourceMode = values[Keys.mode]?.let { runCatching { DataSourceMode.valueOf(it) }.getOrNull() }
                ?: DataSourceMode.ON_DEVICE,
            serverUrl = values[Keys.serverUrl].orEmpty(),
            authToken = values[Keys.encryptedToken]?.let { runCatching { cipher.decrypt(it) }.getOrNull() },
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

    suspend fun portablePreferences(): JsonObject {
        val settings = current()
        return buildJsonObject {
            put("theme", settings.themeMode.name); put("accent", settings.accent.name); put("currency", settings.currency)
            put("showPricing", settings.showPricing); put("showCardNumbers", settings.showCardNumbers)
            settings.defaultGame?.let { put("defaultGame", it) }
            put("enabledGames", JsonArray(settings.enabledGames.sorted().map(::JsonPrimitive)))
            put("bottomNavigationOrder", JsonArray(settings.bottomNavigationOrder.map { JsonPrimitive(it.name) }))
            put("hiddenBottomNavigationItems", JsonArray(settings.hiddenBottomNavigationItems.map { JsonPrimitive(it.name) }))
        }
    }
    suspend fun restorePortablePreferences(value: JsonObject) = context.dataStore.edit { target ->
        value["theme"]?.jsonPrimitive?.content?.let { ThemeMode.valueOf(it); target[Keys.theme] = it }
        value["accent"]?.jsonPrimitive?.content?.let { AccentChoice.valueOf(it); target[Keys.accent] = it }
        value["currency"]?.jsonPrimitive?.content?.let { java.util.Currency.getInstance(it); target[Keys.currency] = it }
        value["enabledGames"]?.jsonArray?.let { target[Keys.games] = it.joinToString(",") { item -> item.jsonPrimitive.content } }
        value["showPricing"]?.jsonPrimitive?.booleanOrNull?.let { target[Keys.showPricing] = it }
        value["showCardNumbers"]?.jsonPrimitive?.booleanOrNull?.let { target[Keys.showCardNumbers] = it }
        target.remove(Keys.defaultGame)
        value["defaultGame"]?.jsonPrimitive?.contentOrNull?.let { target[Keys.defaultGame] = it }
        value["bottomNavigationOrder"]?.jsonArray?.let { target[Keys.bottomNavigationOrder] = it.joinToString(",") { item -> item.jsonPrimitive.content } }
        value["hiddenBottomNavigationItems"]?.jsonArray?.let { target[Keys.hiddenBottomNavigationItems] = it.joinToString(",") { item -> item.jsonPrimitive.content } }
    }

    suspend fun current(): AppPreferences = preferences.first()

    suspend fun finishSetup(games: Set<String>? = null) = context.dataStore.edit {
        it[Keys.setupComplete] = true
        games?.let { games -> it[Keys.games] = games.sorted().joinToString(",") }
    }
    suspend fun setSealedProductsEnabled(enabled: Boolean) = context.dataStore.edit { it[Keys.sealedProducts] = enabled }
    suspend fun resetDisplayPreferences() = context.dataStore.edit { values ->
        listOf(Keys.theme, Keys.accent, Keys.currency, Keys.defaultGame, Keys.bottomNavigationOrder, Keys.hiddenBottomNavigationItems).forEach(values::remove)
        values.remove(Keys.showPricing); values.remove(Keys.showCardNumbers)
    }

    suspend fun useOnDevice() = context.dataStore.edit {
        it[Keys.mode] = DataSourceMode.ON_DEVICE.name
    }

    suspend fun configureServer(url: String) = context.dataStore.edit {
        it[Keys.mode] = DataSourceMode.SERVER.name
        it[Keys.serverUrl] = normalizeServerUrl(url)
        it.remove(Keys.token)
        it.remove(Keys.encryptedToken)
        it.remove(Keys.username)
        it.remove(Keys.userId)
    }

    suspend fun saveSession(token: String, username: String, userId: String? = null) = context.dataStore.edit {
        it[Keys.encryptedToken] = cipher.encrypt(token)
        it.remove(Keys.token)
        it[Keys.username] = username
        if (userId.isNullOrBlank()) it.remove(Keys.userId) else it[Keys.userId] = userId
    }

    suspend fun signOut() = context.dataStore.edit {
        it.remove(Keys.token)
        it.remove(Keys.encryptedToken)
        it.remove(Keys.username)
        it.remove(Keys.userId)
    }

    suspend fun applyServerPreferences(preferences: JsonObject) = context.dataStore.edit { values ->
        preferences["showPricing"]?.jsonPrimitive?.booleanOrNull?.let { values[Keys.showPricing] = it }
        preferences["showCardNumbers"]?.jsonPrimitive?.booleanOrNull?.let { values[Keys.showCardNumbers] = it }
        val games = values[Keys.games]?.split(',')?.filter(String::isNotBlank)?.toMutableSet() ?: mutableSetOf("pokemon", "magic", "yugioh")
        mapOf("pokemon" to "enabledPokemon", "magic" to "enabledMagic", "yugioh" to "enabledYugioh", "onepiece" to "enabledOnepiece", "lorcana" to "enabledLorcana", "dragonball" to "enabledDragonball").forEach { (game, field) ->
            preferences[field]?.jsonPrimitive?.booleanOrNull?.let { if (it) games += game else games -= game }
        }
        values[Keys.games] = games.sorted().joinToString(",")
        if (preferences.containsKey("defaultGame")) {
            val game = preferences["defaultGame"]?.jsonPrimitive?.contentOrNull
            if (game == null) values.remove(Keys.defaultGame) else values[Keys.defaultGame] = game
        }
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
