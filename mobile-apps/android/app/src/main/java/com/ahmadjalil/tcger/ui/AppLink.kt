// @tcger-feature {"id":"navigation.appLinks","platform":"android","status":"partial","limitation":"Custom and HTTPS routes share tested destinations and reject untrusted inputs; configured hosted associations and signed-device cold starts remain unverified."}
package com.ahmadjalil.tcger.ui

import java.net.URI
import java.net.URLDecoder

data class AppLink(val route: String, val query: String? = null)

fun parseAppLink(raw: String): AppLink? = runCatching {
    val uri = URI(raw)
    if (uri.scheme !in setOf("tcger", "https") || uri.userInfo != null || uri.port !in setOf(-1, 443)) return null
    if (uri.scheme == "https" && uri.host != "tcger.ahmadjalil.com") return null
    val segments = (if (uri.scheme == "tcger") listOfNotNull(uri.host) else emptyList()) + uri.rawPath.orEmpty().split('/').filter { it.isNotBlank() }.map { URLDecoder.decode(it.replace("+", "%2B"), "UTF-8") }
    if (segments.size > 2) return null
    val query = uri.rawQuery?.split('&')?.firstOrNull { it.startsWith("q=") }?.removePrefix("q=")?.let { URLDecoder.decode(it, "UTF-8").trim().takeIf { value -> value.isNotEmpty() } }
    if (segments.getOrNull(1)?.matches(Regex("[A-Za-z0-9_.:-]+")) == false) return null
    when (segments.firstOrNull()) {
        "scan", "scanner" -> if (segments.size == 1) AppLink("scanner") else null
        "packs" -> if (segments.size == 1) AppLink("pack-opening") else null
        "search" -> if (segments.size == 1) AppLink("search", query) else null
        "binder", "binders", "collection", "collections" -> segments.getOrNull(1)?.takeIf { it.matches(Regex("[A-Za-z0-9_.:-]+")) }?.let { AppLink("binder/$it") } ?: AppLink("collections")
        "wishlist", "wishlists" -> segments.getOrNull(1)?.takeIf { it.matches(Regex("[A-Za-z0-9_.:-]+")) }?.let { AppLink("wishlist/$it") } ?: AppLink("wishlists")
        else -> null
    }
}.getOrNull()

/** Child routes inherit their server capability rather than bypassing navigation gates. */
fun requiredServerDestination(route: String?): com.ahmadjalil.tcger.domain.BottomNavigationItem? = when (route?.substringBefore('/')) {
    "decks", "deck" -> com.ahmadjalil.tcger.domain.BottomNavigationItem.DECKS
    "trades", "trade" -> com.ahmadjalil.tcger.domain.BottomNavigationItem.TRADES
    "activity" -> com.ahmadjalil.tcger.domain.BottomNavigationItem.ACTIVITY
    "sealed" -> com.ahmadjalil.tcger.domain.BottomNavigationItem.SEALED
    "online-codes", "codes" -> com.ahmadjalil.tcger.domain.BottomNavigationItem.CODES
    "prices" -> com.ahmadjalil.tcger.domain.BottomNavigationItem.PRICES
    "analytics" -> com.ahmadjalil.tcger.domain.BottomNavigationItem.ANALYTICS
    else -> null
}

fun requiredServerCapability(route: String?): String? = when (route?.substringBefore('/')) {
    "deck", "decks" -> "decks"
    "trade", "trades" -> "trades"
    "activity" -> "notifications"
    "sealed" -> "sealed"
    "codes", "online-codes" -> "onlineCodes"
    "prices", "settings-pricing-sources" -> "prices"
    "analytics" -> "analytics"
    "settings-finance-history" -> "finance"
    else -> null
}
