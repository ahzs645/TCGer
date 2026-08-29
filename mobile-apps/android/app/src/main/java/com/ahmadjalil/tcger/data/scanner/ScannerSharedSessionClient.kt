package com.ahmadjalil.tcger.data.scanner

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

@Serializable
data class SharedScannerItemRequest(
    val code: String,
    val clientEventId: String,
    val tcg: String,
    val externalId: String,
    val name: String,
    val setCode: String? = null,
    val setName: String? = null,
    val rarity: String? = null,
    val imageUrl: String? = null,
    val price: Double? = null,
    val confidence: Double? = null,
    val language: String,
)

object SharedScannerSessionJson {
    private val codec = Json { encodeDefaults = false; explicitNulls = false; ignoreUnknownKeys = true }

    fun normalizedCode(raw: String): String = raw.trim().uppercase()

    fun request(code: String, entry: ScannerSessionEntry, language: String) = SharedScannerItemRequest(
        code = normalizedCode(code),
        clientEventId = entry.id,
        tcg = entry.game,
        externalId = entry.cardId,
        name = entry.name,
        setCode = entry.setCode,
        setName = entry.setName,
        rarity = entry.rarity,
        imageUrl = entry.imageUrl,
        price = entry.price,
        confidence = entry.confidence,
        language = language,
    )

    fun encode(request: SharedScannerItemRequest): String = codec.encodeToString(request)
}

class ScannerSharedSessionClient(private val client: OkHttpClient = OkHttpClient()) {
    suspend fun send(
        serverUrl: String,
        authToken: String,
        code: String,
        entry: ScannerSessionEntry,
        language: String,
    ) = withContext(Dispatchers.IO) {
        require(serverUrl.isNotBlank() && authToken.isNotBlank()) { "A signed-in server is required" }
        val normalizedCode = SharedScannerSessionJson.normalizedCode(code)
        require(normalizedCode.isNotBlank()) { "Enter a shared session code" }
        val url = serverUrl.trim().trimEnd('/').toHttpUrl().newBuilder()
            .addPathSegment("scan-sessions")
            .addPathSegment("items")
            .build()
        val payload = SharedScannerSessionJson.request(normalizedCode, entry, language)
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $authToken")
            .post(SharedScannerSessionJson.encode(payload).toRequestBody(JSON_MEDIA_TYPE))
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Shared session sync failed with HTTP ${response.code}")
        }
    }

    companion object {
        private val JSON_MEDIA_TYPE = "application/json".toMediaType()
    }
}
