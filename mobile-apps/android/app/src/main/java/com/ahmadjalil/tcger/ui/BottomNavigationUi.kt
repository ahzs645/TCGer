package com.ahmadjalil.tcger.ui

import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CollectionsBookmark
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Analytics
import androidx.compose.material.icons.filled.AutoStories
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Paid
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Style
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.ui.graphics.vector.ImageVector
import com.ahmadjalil.tcger.R
import com.ahmadjalil.tcger.domain.BottomNavigationItem
import com.ahmadjalil.tcger.generated.ParityControlIDs

internal val BottomNavigationItem.route: String
    get() = when (this) {
        BottomNavigationItem.HOME -> "home"
        BottomNavigationItem.COLLECTIONS -> "collections"
        BottomNavigationItem.SETS -> "sets"
        BottomNavigationItem.POKEDEX -> "pokedex"
        BottomNavigationItem.DECKS -> "decks"
        BottomNavigationItem.SEARCH -> "search"
        BottomNavigationItem.WISHLISTS -> "wishlists"
        BottomNavigationItem.GUIDES -> "guides"
        BottomNavigationItem.SCAN -> "scanner"
        BottomNavigationItem.SEALED -> "sealed"
        BottomNavigationItem.CODES -> "codes"
        BottomNavigationItem.PRICES -> "prices"
        BottomNavigationItem.ANALYTICS -> "analytics"
        BottomNavigationItem.TRADES -> "trades"
        BottomNavigationItem.ACTIVITY -> "activity"
        BottomNavigationItem.PACK_OPENING -> "pack-opening"
        BottomNavigationItem.SETTINGS -> "settings"
    }

internal val BottomNavigationItem.icon: ImageVector
    get() = when (this) {
        BottomNavigationItem.HOME -> Icons.Default.Home
        BottomNavigationItem.COLLECTIONS -> Icons.Default.CollectionsBookmark
        BottomNavigationItem.SETS -> Icons.Default.Layers
        BottomNavigationItem.POKEDEX -> Icons.Default.GridOn
        BottomNavigationItem.DECKS -> Icons.Default.Style
        BottomNavigationItem.SEARCH -> Icons.Default.Search
        BottomNavigationItem.WISHLISTS -> Icons.Default.Favorite
        BottomNavigationItem.GUIDES -> Icons.Default.AutoStories
        BottomNavigationItem.SCAN -> Icons.Default.PhotoCamera
        BottomNavigationItem.SEALED -> Icons.Default.Inventory2
        BottomNavigationItem.CODES -> Icons.Default.QrCodeScanner
        BottomNavigationItem.PRICES -> Icons.Default.Paid
        BottomNavigationItem.ANALYTICS -> Icons.Default.Analytics
        BottomNavigationItem.TRADES -> Icons.Default.SwapHoriz
        BottomNavigationItem.ACTIVITY -> Icons.Default.Notifications
        BottomNavigationItem.PACK_OPENING -> Icons.Default.AutoAwesome
        BottomNavigationItem.SETTINGS -> Icons.Default.Settings
    }

@get:StringRes
internal val BottomNavigationItem.labelRes: Int
    get() = when (this) {
        BottomNavigationItem.HOME -> R.string.nav_home
        BottomNavigationItem.COLLECTIONS -> R.string.nav_collections
        BottomNavigationItem.SETS -> R.string.nav_sets
        BottomNavigationItem.POKEDEX -> R.string.nav_pokedex
        BottomNavigationItem.DECKS -> R.string.nav_decks
        BottomNavigationItem.SEARCH -> R.string.nav_search
        BottomNavigationItem.WISHLISTS -> R.string.nav_wishlists
        BottomNavigationItem.GUIDES -> R.string.nav_guides
        BottomNavigationItem.SCAN -> R.string.nav_scan
        BottomNavigationItem.SEALED -> R.string.nav_sealed
        BottomNavigationItem.CODES -> R.string.nav_codes
        BottomNavigationItem.PRICES -> R.string.nav_prices
        BottomNavigationItem.ANALYTICS -> R.string.nav_analytics
        BottomNavigationItem.TRADES -> R.string.nav_trades
        BottomNavigationItem.ACTIVITY -> R.string.nav_activity
        BottomNavigationItem.PACK_OPENING -> R.string.nav_pack_opening
        BottomNavigationItem.SETTINGS -> R.string.nav_settings
    }

@get:StringRes
internal val BottomNavigationItem.descriptionRes: Int
    get() = when (this) {
        BottomNavigationItem.HOME -> R.string.nav_home_description
        BottomNavigationItem.COLLECTIONS -> R.string.nav_collections_description
        BottomNavigationItem.SETS -> R.string.nav_sets_description
        BottomNavigationItem.POKEDEX -> R.string.nav_pokedex_description
        BottomNavigationItem.DECKS -> R.string.nav_decks_description
        BottomNavigationItem.SEARCH -> R.string.nav_search_description
        BottomNavigationItem.WISHLISTS -> R.string.nav_wishlists_description
        BottomNavigationItem.GUIDES -> R.string.nav_guides_description
        BottomNavigationItem.SCAN -> R.string.nav_scan_description
        BottomNavigationItem.SEALED -> R.string.nav_sealed_description
        BottomNavigationItem.CODES -> R.string.nav_codes_description
        BottomNavigationItem.PRICES -> R.string.nav_prices_description
        BottomNavigationItem.ANALYTICS -> R.string.nav_analytics_description
        BottomNavigationItem.TRADES -> R.string.nav_trades_description
        BottomNavigationItem.ACTIVITY -> R.string.nav_activity_description
        BottomNavigationItem.PACK_OPENING -> R.string.nav_pack_opening_description
        BottomNavigationItem.SETTINGS -> R.string.nav_settings_description
    }

internal val BottomNavigationItem.controlId: String
    get() = when (this) {
        BottomNavigationItem.HOME -> ParityControlIDs.NAV_HOME
        BottomNavigationItem.COLLECTIONS -> ParityControlIDs.NAV_COLLECTIONS
        BottomNavigationItem.SEARCH -> ParityControlIDs.NAV_SEARCH
        BottomNavigationItem.WISHLISTS -> ParityControlIDs.NAV_WISHLISTS
        BottomNavigationItem.SETTINGS -> ParityControlIDs.NAV_SETTINGS
        BottomNavigationItem.SCAN -> ParityControlIDs.NAV_SCAN
        BottomNavigationItem.SETS -> "nav.sets"
        BottomNavigationItem.POKEDEX -> "nav.pokedex"
        BottomNavigationItem.DECKS -> "nav.decks"
        BottomNavigationItem.GUIDES -> "nav.guides"
        BottomNavigationItem.CODES -> "nav.codes"
        BottomNavigationItem.PRICES -> "nav.prices"
        BottomNavigationItem.ANALYTICS -> "nav.analytics"
        BottomNavigationItem.TRADES -> "nav.trades"
        BottomNavigationItem.ACTIVITY -> "nav.activity"
        // These destinations predate dedicated parity navigation control IDs.
        BottomNavigationItem.SEALED -> "nav.sealed"
        BottomNavigationItem.PACK_OPENING -> "nav.pack-opening"
    }
