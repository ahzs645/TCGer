package com.ahmadjalil.tcger.feature.onlinecodes

import android.content.Context
import com.ahmadjalil.tcger.data.preferences.normalizeServerUrl
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.Transient
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

@Serializable
enum class OnlineCodeStatus(val apiValue: String, val title: String) {
    @SerialName("unused") UNUSED("unused", "Unused"),
    @SerialName("redeemed") REDEEMED("redeemed", "Used"),
    @SerialName("invalid") INVALID("invalid", "Invalid"),
    @SerialName("traded") TRADED("traded", "Shared"),
}

@Serializable
enum class OnlineCodeSource(val apiValue: String) {
    @SerialName("camera") CAMERA("camera"),
    @SerialName("manual") MANUAL("manual"),
    @SerialName("import") IMPORT("import"),
}

@Serializable
data class OnlineCode(
    val id: String,
    val tcg: String,
    val code: String,
    val status: OnlineCodeStatus,
    val source: OnlineCodeSource,
    val productName: String? = null,
    val notes: String? = null,
    val capturedAt: String,
    val redeemedAt: String? = null,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class OnlineCodeInput(val code: String, val capturedAt: String? = null)

@Serializable
data class CreateOnlineCodeBatch(
    val tcg: String,
    val codes: List<OnlineCodeInput>,
    val source: OnlineCodeSource,
    val productName: String? = null,
    val notes: String? = null,
)

@Serializable
data class OnlineCodeBatchResult(val created: Int, val duplicates: Int, val items: List<OnlineCode>)

@Serializable
data class UpdateOnlineCodeInput(
    val status: OnlineCodeStatus? = null,
    val productName: String? = null,
    val notes: String? = null,
    @Transient val productNameSpecified: Boolean = false,
    @Transient val notesSpecified: Boolean = false,
)

fun parseOnlineCodes(raw: String): List<String> = raw
    .split(Regex("[\\n,;]+"))
    .map(String::trim)
    .filter(String::isNotBlank)
    .distinctBy(String::uppercase)

fun maskedOnlineCode(code: String): String {
    if (code.length <= 4) return "••••"
    return "•".repeat((code.length - 4).coerceAtMost(12)) + code.takeLast(4)
}

interface OnlineCodeRepository {
    suspend fun get(tcg: String? = null): List<OnlineCode>
    suspend fun create(input: CreateOnlineCodeBatch): OnlineCodeBatchResult
    suspend fun update(id: String, input: UpdateOnlineCodeInput): OnlineCode
    suspend fun delete(id: String)

    companion object {
        fun create(context: Context, connection: OnlineCodeConnection): OnlineCodeRepository =
            if (connection.serverUrl.isNotBlank()) {
                RemoteOnlineCodeRepository(connection)
            } else {
                LocalOnlineCodeRepository(context.applicationContext)
            }
    }
}

data class OnlineCodeConnection(val serverUrl: String = "", val authToken: String? = null)

class LocalOnlineCodeRepository(context: Context) : OnlineCodeRepository {
    private val preferences = context.getSharedPreferences("online_code_vault", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val mutex = Mutex()

    override suspend fun get(tcg: String?): List<OnlineCode> = mutex.withLock {
        read().filter { tcg == null || it.tcg.equals(tcg, ignoreCase = true) }
            .sortedByDescending(OnlineCode::createdAt)
    }

    override suspend fun create(input: CreateOnlineCodeBatch): OnlineCodeBatchResult = mutex.withLock {
        val existing = read().toMutableList()
        val keys = existing.mapTo(mutableSetOf()) { "${it.tcg.lowercase()}:${it.code.uppercase()}" }
        val now = Instant.now().toString()
        var duplicates = 0
        val created = input.codes.mapNotNull { candidate ->
            val normalized = candidate.code.trim()
            val key = "${input.tcg.lowercase()}:${normalized.uppercase()}"
            if (normalized.isBlank() || !keys.add(key)) {
                duplicates++
                null
            } else {
                OnlineCode(
                    id = UUID.randomUUID().toString(), tcg = input.tcg, code = normalized,
                    status = OnlineCodeStatus.UNUSED, source = input.source,
                    productName = input.productName?.trim()?.ifBlank { null },
                    notes = input.notes?.trim()?.ifBlank { null },
                    capturedAt = candidate.capturedAt ?: now, createdAt = now, updatedAt = now,
                )
            }
        }
        write(existing + created)
        OnlineCodeBatchResult(created.size, duplicates, created)
    }

    override suspend fun update(id: String, input: UpdateOnlineCodeInput): OnlineCode = mutex.withLock {
        val items = read().toMutableList()
        val index = items.indexOfFirst { it.id == id }
        require(index >= 0) { "Code not found" }
        val old = items[index]
        val status = input.status ?: old.status
        val now = Instant.now().toString()
        val updated = old.copy(
            status = status,
            productName = if (input.productNameSpecified) input.productName?.trim()?.ifBlank { null } else old.productName,
            notes = if (input.notesSpecified) input.notes?.trim()?.ifBlank { null } else old.notes,
            redeemedAt = if (status == OnlineCodeStatus.REDEEMED) old.redeemedAt ?: now else null,
            updatedAt = now,
        )
        items[index] = updated
        write(items)
        updated
    }

    override suspend fun delete(id: String) = mutex.withLock { write(read().filterNot { it.id == id }) }

    private fun read(): List<OnlineCode> = preferences.getString("codes", null)?.let {
        runCatching { json.decodeFromString(ListSerializer(OnlineCode.serializer()), it) }.getOrDefault(emptyList())
    }.orEmpty()

    private fun write(items: List<OnlineCode>) {
        preferences.edit().putString("codes", json.encodeToString(ListSerializer(OnlineCode.serializer()), items)).apply()
    }
}

class RemoteOnlineCodeRepository(
    private val connection: OnlineCodeConnection,
    private val client: OkHttpClient = OkHttpClient(),
) : OnlineCodeRepository {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }
    private val mediaType = "application/json".toMediaType()

    override suspend fun get(tcg: String?): List<OnlineCode> = request(
        path = "online-codes" + (tcg?.let { "?tcg=${java.net.URLEncoder.encode(it, Charsets.UTF_8.name())}" } ?: ""),
        serializer = ListSerializer(OnlineCode.serializer()),
    )

    override suspend fun create(input: CreateOnlineCodeBatch): OnlineCodeBatchResult = request(
        path = "online-codes/bulk", method = "POST", body = json.encodeToString(input),
        serializer = OnlineCodeBatchResult.serializer(),
    )

    override suspend fun update(id: String, input: UpdateOnlineCodeInput): OnlineCode = request(
        path = "online-codes/${encodePath(id)}", method = "PATCH", body = kotlinx.serialization.json.buildJsonObject {
            input.status?.let { put("status", kotlinx.serialization.json.JsonPrimitive(it.apiValue)) }
            if (input.productNameSpecified) put("productName", input.productName?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
            if (input.notesSpecified) put("notes", input.notes?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
        }.toString(),
        serializer = OnlineCode.serializer(),
    )

    override suspend fun delete(id: String) {
        requestUnit("online-codes/${encodePath(id)}", "DELETE")
    }

    private suspend fun <T> request(
        path: String,
        method: String = "GET",
        body: String? = null,
        serializer: kotlinx.serialization.KSerializer<T>,
    ): T = withContext(Dispatchers.IO) {
        val response = client.newCall(buildRequest(path, method, body)).execute()
        response.use {
            val payload = it.body?.string().orEmpty()
            if (!it.isSuccessful) error(serverError(it.code, payload))
            json.decodeFromString(serializer, payload)
        }
    }

    private suspend fun requestUnit(path: String, method: String) = withContext(Dispatchers.IO) {
        client.newCall(buildRequest(path, method, null)).execute().use {
            if (!it.isSuccessful) error(serverError(it.code, it.body?.string().orEmpty()))
        }
    }

    private fun buildRequest(path: String, method: String, body: String?): Request {
        val token = connection.authToken?.takeIf(String::isNotBlank)
            ?: error("Sign in is required to use the server code vault")
        return Request.Builder()
            .url(normalizeServerUrl(connection.serverUrl) + path)
            .header("Authorization", "Bearer $token")
            .header("Content-Type", "application/json")
            .method(method, if (method == "GET" || method == "DELETE") null else body.orEmpty().toRequestBody(mediaType))
            .build()
    }

    private fun serverError(status: Int, payload: String) =
        "Code vault request failed ($status)${payload.takeIf(String::isNotBlank)?.let { ": ${it.take(180)}" }.orEmpty()}"

    private fun encodePath(value: String) = java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
}

data class OnlineCodeUiState(
    val codes: List<OnlineCode> = emptyList(),
    val loading: Boolean = false,
    val saving: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)

class OnlineCodeStateHolder(
    private val repository: OnlineCodeRepository,
    private val scope: CoroutineScope,
) {
    private val mutableState = MutableStateFlow(OnlineCodeUiState())
    val state: StateFlow<OnlineCodeUiState> = mutableState.asStateFlow()

    fun load() = scope.launch {
        runOperation(loading = true) { repository.get() }?.let { codes ->
            mutableState.value = mutableState.value.copy(codes = codes)
        }
    }

    fun create(input: CreateOnlineCodeBatch, complete: (() -> Unit)? = null) = scope.launch {
        runOperation(saving = true) {
            val result = repository.create(input)
            mutableState.value = mutableState.value.copy(
                codes = repository.get(),
                message = "${result.created} saved" + if (result.duplicates > 0) " · ${result.duplicates} duplicate skipped" else "",
            )
            complete?.invoke()
        }
    }

    fun update(id: String, input: UpdateOnlineCodeInput) = scope.launch {
        runOperation(saving = true) {
            val updated = repository.update(id, input)
            mutableState.value = mutableState.value.copy(codes = mutableState.value.codes.map { if (it.id == id) updated else it })
        }
    }

    fun delete(id: String) = scope.launch {
        runOperation(saving = true) {
            repository.delete(id)
            mutableState.value = mutableState.value.copy(codes = mutableState.value.codes.filterNot { it.id == id })
        }
    }

    private suspend fun <T> runOperation(loading: Boolean = false, saving: Boolean = false, block: suspend () -> T): T? {
        mutableState.value = mutableState.value.copy(loading = loading, saving = saving, error = null, message = null)
        return runCatching { block() }.fold(
            onSuccess = { mutableState.value = mutableState.value.copy(loading = false, saving = false); it },
            onFailure = { mutableState.value = mutableState.value.copy(loading = false, saving = false, error = it.message ?: "Request failed"); null },
        )
    }
}
