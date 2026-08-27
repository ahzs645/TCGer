package com.ahmadjalil.tcger.ui.packopening

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL

data class PackOpeningHostConfig(
    val remoteAssetBaseURL: String = "https://assets.tcger.ahmadjalil.com",
    val deterministic: Boolean = false,
    val debug: Boolean = false,
)

@Composable
internal fun PackOpeningWebHost(
    command: PackOpeningCommand?,
    reloadKey: Int,
    config: PackOpeningHostConfig,
    modifier: Modifier = Modifier,
    offlineDownloadManager: PackOfflineDownloadManager? = null,
    interactive: Boolean = true,
    onEvent: (PackOpeningBridgeEvent) -> Unit,
) {
    val latestOnEvent by rememberUpdatedState(onEvent)

    key(reloadKey) {
        AndroidView(
            modifier = modifier,
            factory = { context ->
                createPackOpeningWebView(context, config, offlineDownloadManager) { event ->
                    latestOnEvent(event)
                }
            },
            update = { webView ->
                webView.isEnabled = interactive
                command?.let(webView::send)
            },
            onRelease = PackOpeningAndroidWebView::release,
        )
    }
}

private class PackOpeningJavaScriptBridge(
    private val onPayload: (String) -> Unit,
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun postMessage(payload: String) {
        mainHandler.post { onPayload(payload) }
    }
}

private class PackOpeningAndroidWebView(context: Context) : WebView(context) {
    private var ready = false
    private var lastCommandID: Long? = null
    private var pendingCommand: PackOpeningCommand? = null

    fun markReady() {
        ready = true
        pendingCommand?.let {
            pendingCommand = null
            send(it)
        }
    }

    fun send(command: PackOpeningCommand) {
        if (lastCommandID == command.id) return
        if (!ready) {
            pendingCommand = command
            return
        }
        lastCommandID = command.id
        evaluateJavascript(
            "window.tcgerPack?.command(${command.encode()})",
            null,
        )
    }

    fun release() {
        stopLoading()
        loadUrl("about:blank")
        removeJavascriptInterface(BRIDGE_NAME)
        destroy()
    }
}

@SuppressLint("SetJavaScriptEnabled")
private fun createPackOpeningWebView(
    context: Context,
    config: PackOpeningHostConfig,
    offlineDownloadManager: PackOfflineDownloadManager?,
    onEvent: (PackOpeningBridgeEvent) -> Unit,
): PackOpeningAndroidWebView {
    lateinit var webView: PackOpeningAndroidWebView
    val bridge = PackOpeningJavaScriptBridge { payload ->
        val event = PackOpeningBridgeDecoder.decode(payload)
            ?: PackOpeningBridgeEvent.Error("The pack renderer returned an unreadable event.")
        if (event is PackOpeningBridgeEvent.Ready) webView.markReady()
        onEvent(event)
    }
    webView = PackOpeningAndroidWebView(context).apply {
        setBackgroundColor(Color.TRANSPARENT)
        isVerticalScrollBarEnabled = false
        isHorizontalScrollBarEnabled = false
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.mediaPlaybackRequiresUserGesture = false
        addJavascriptInterface(bridge, BRIDGE_NAME)
        webViewClient = PackOpeningWebViewClient(
            context = context,
            config = config,
            assetStore = offlineDownloadManager?.assetStore
                ?: PackAssetStore(java.io.File(context.filesDir, "pack-opening/assets")),
            onEvent = onEvent,
        )
    }

    val html = runCatching {
        context.assets.open("index.html").bufferedReader().use { it.readText() }
    }.getOrElse {
        onEvent(PackOpeningBridgeEvent.Error(
            "Pack opening assets are missing. Build the shared pack-core embed before launching Android.",
        ))
        return webView
    }
    val shimmedHTML = html.replace(
        "<script src=",
        "<script>${bridgeShim(config.deterministic)}</script><script src=",
    )
    val pageURL = "$LOCAL_ORIGIN/index.html${if (config.debug) "?debug=1" else ""}"
    webView.loadDataWithBaseURL(pageURL, shimmedHTML, "text/html", "utf-8", pageURL)
    return webView
}

private fun bridgeShim(deterministic: Boolean): String = buildString {
    append(
        """
        (function() {
          window.webkit = { messageHandlers: { packBridge: { postMessage: function(value) {
            window.$BRIDGE_NAME.postMessage(JSON.stringify(value));
          } } } };
        """.trimIndent(),
    )
    if (deterministic) {
        append(
            """
              var seed = 0x54434745;
              Math.random = function() {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                return seed / 4294967296;
              };
              try {
                Object.defineProperty(window.crypto, "randomUUID", {
                  value: function() { return "00000000-0000-4000-8000-000000000001"; }
                });
              } catch (_) {}
            """.trimIndent(),
        )
    }
    append("})();")
}

private class PackOpeningWebViewClient(
    context: Context,
    private val config: PackOpeningHostConfig,
    private val assetStore: PackAssetStore,
    private val onEvent: (PackOpeningBridgeEvent) -> Unit,
) : WebViewClient() {
    private val assets = context.assets

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val uri = request.url
        assetStore.read(uri.toString())?.let { bytes ->
            return webResponse(mimeType(uri.path.orEmpty()), bytes, immutableHeaders)
        }
        if (uri.scheme != "https" || uri.host != LOCAL_HOST) return null
        return responseFor(uri.path.orEmpty())
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        // Keep the JavaScript interface confined to the app-owned document.
        // External odds links are deliberately opened by the native UI.
        return request.isForMainFrame && request.url.host != LOCAL_HOST
    }

    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: android.webkit.WebResourceError,
    ) {
        if (request.isForMainFrame) {
            onEvent(PackOpeningBridgeEvent.Error(error.description?.toString() ?: "Pack opening failed to load."))
        }
    }

    private fun responseFor(rawPath: String): WebResourceResponse? {
        val path = Uri.decode(rawPath).trimStart('/')
        if (path.isBlank() || path.split('/').any { it == ".." }) return null

        // Scripts, styles, the mesh, and the generic card back always come from
        // the shared embedded runtime. The remote manifest and content-addressed
        // wrapper objects use the same R2 proxy/fallback policy as iOS.
        val isManifest = path == "pack/manifest.json"
        val isRemoteObject = path.startsWith("pack/objects/")
        if ((isManifest || isRemoteObject) && !config.deterministic) {
            remoteResponse(path, refresh = isManifest)?.let { return it }
        }
        bundledResponse(path)?.let { return it }
        if (isManifest || isRemoteObject) return remoteResponse(path, refresh = isManifest)
        return null
    }

    private fun bundledResponse(path: String): WebResourceResponse? = runCatching {
        val bytes = assets.open(path).use { it.readBytes() }
        webResponse(mimeType(path), bytes)
    }.getOrNull()

    private fun remoteResponse(path: String, refresh: Boolean): WebResourceResponse? {
        val remoteURL = "${config.remoteAssetBaseURL.trimEnd('/')}/$path"
        val cachedBytes = assetStore.read(remoteURL)
        if (!refresh && cachedBytes != null) {
            return webResponse(mimeType(path), cachedBytes, immutableHeaders)
        }

        val fetched = runCatching {
            val connection = (URL(remoteURL).openConnection() as HttpURLConnection).apply {
                connectTimeout = 8_000
                readTimeout = 12_000
                instanceFollowRedirects = true
                requestMethod = "GET"
                setRequestProperty("Accept", if (path.endsWith(".json")) "application/json" else "image/*,*/*;q=0.8")
            }
            connection.useConnection { responseCode, bytes, contentType ->
                if (responseCode !in 200..299) error("$remoteURL returned $responseCode")
                assetStore.write(remoteURL, bytes)
                webResponse(
                    contentType?.substringBefore(';') ?: mimeType(path),
                    bytes,
                    if (refresh) manifestHeaders else immutableHeaders,
                )
            }
        }.getOrNull()
        if (fetched != null) return fetched
        if (cachedBytes != null) {
            return webResponse(mimeType(path), cachedBytes, if (refresh) manifestHeaders else immutableHeaders)
        }
        return null
    }
}

private inline fun <T> HttpURLConnection.useConnection(
    block: (responseCode: Int, bytes: ByteArray, contentType: String?) -> T,
): T = try {
    val code = responseCode
    val stream = if (code in 200..299) inputStream else errorStream
    block(code, stream?.use { it.readBytes() } ?: byteArrayOf(), contentType)
} finally {
    disconnect()
}

private fun webResponse(
    mimeType: String,
    bytes: ByteArray,
    headers: Map<String, String> = localHeaders,
): WebResourceResponse = WebResourceResponse(
    mimeType,
    if (mimeType.startsWith("text/") || mimeType.contains("json") || mimeType.contains("javascript")) "utf-8" else null,
    200,
    "OK",
    headers,
    ByteArrayInputStream(bytes),
)

private fun mimeType(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
    "html" -> "text/html"
    "js", "mjs" -> "text/javascript"
    "css" -> "text/css"
    "json" -> "application/json"
    "png" -> "image/png"
    "jpg", "jpeg" -> "image/jpeg"
    "webp" -> "image/webp"
    "svg" -> "image/svg+xml"
    "obj" -> "text/plain"
    "wasm" -> "application/wasm"
    else -> "application/octet-stream"
}

private const val LOCAL_HOST = "appassets.androidplatform.net"
private const val LOCAL_ORIGIN = "https://$LOCAL_HOST"
private const val BRIDGE_NAME = "AndroidPackBridge"
private val localHeaders = mapOf("Access-Control-Allow-Origin" to LOCAL_ORIGIN)
private val manifestHeaders = localHeaders + mapOf("Cache-Control" to "no-cache")
private val immutableHeaders = localHeaders + mapOf("Cache-Control" to "public, max-age=31536000, immutable")
