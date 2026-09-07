package com.ahmadjalil.tcger.ui

import java.net.URI
import java.net.URLDecoder

data class AppLink(val route: String, val query: String? = null)

fun parseAppLink(raw: String): AppLink? = runCatching {
    val uri = URI(raw)
    if (uri.scheme !in setOf("tcger", "https")) return null
    if (uri.scheme == "https" && uri.host != "tcger.ahmadjalil.com") return null
    val segments = (if (uri.scheme == "tcger") listOfNotNull(uri.host) else emptyList()) + uri.path.orEmpty().split('/').filter { it.isNotBlank() }
    val query = uri.rawQuery?.split('&')?.firstOrNull { it.startsWith("q=") }?.removePrefix("q=")?.let { URLDecoder.decode(it, "UTF-8") }
    when (segments.firstOrNull()) {
        "scan", "scanner" -> AppLink("scanner")
        "search" -> AppLink("search", query)
        "binder", "binders", "collection", "collections" -> segments.getOrNull(1)?.takeIf { it.matches(Regex("[A-Za-z0-9_.:-]+")) }?.let { AppLink("binder/$it") } ?: AppLink("collections")
        "wishlist", "wishlists" -> segments.getOrNull(1)?.takeIf { it.matches(Regex("[A-Za-z0-9_.:-]+")) }?.let { AppLink("wishlist/$it") } ?: AppLink("wishlists")
        else -> null
    }
}.getOrNull()
