package com.ahmadjalil.tcger.ui.packopening

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class PackOfflineDownloadRecord(
    val setID: String,
    val setName: String,
    val downloadedAtEpochMillis: Long,
    val cardCount: Int,
    val byteCount: Long,
    val removableURLs: List<String>,
)

sealed interface PackOfflineSetStatus {
    data object NotDownloaded : PackOfflineSetStatus
    data class Downloading(val progress: Float) : PackOfflineSetStatus
    data class Downloaded(val record: PackOfflineDownloadRecord) : PackOfflineSetStatus
    data class Failed(val message: String) : PackOfflineSetStatus
}

data class PackOfflineSetRequest(
    val setID: String,
    val setName: String,
    val packPoolID: String,
    val cardAssetURLs: List<String>,
)

data class PackOfflineStatusSnapshot(
    val setID: String,
    val status: PackOfflineSetStatus,
)

@Serializable
internal data class PackRemoteManifest(
    val mesh: String,
    val covers: Map<String, PackRemoteCover> = emptyMap(),
)

@Serializable
internal data class PackRemoteCover(
    val packPool: String? = null,
    val setCode: String? = null,
    val plain: String? = null,
    val decaled: String? = null,
)

internal fun PackOpeningPackSet.offlineRequest(pool: PackOpeningCardPool?): PackOfflineSetRequest {
    val option = options.firstOrNull()
    return PackOfflineSetRequest(
        setID = id,
        setName = label,
        packPoolID = option?.packPoolID ?: id,
        cardAssetURLs = pool?.cards.orEmpty().flatMap { listOf(it.imageUrl, it.imageUrlSmall) }
            .filter { it.startsWith("https://") }
            .distinct(),
    )
}

internal class PackAssetStore(private val directory: File) {
    init { directory.mkdirs() }

    fun read(url: String): ByteArray? = file(url).takeIf(File::isFile)?.readBytes()

    fun write(url: String, bytes: ByteArray) {
        directory.mkdirs()
        val destination = file(url)
        val temporary = File(directory, "${destination.name}.tmp-${Thread.currentThread().id}")
        temporary.outputStream().use { it.write(bytes) }
        if (!temporary.renameTo(destination)) {
            destination.outputStream().use { it.write(bytes) }
            temporary.delete()
        }
    }

    fun remove(url: String): Boolean = file(url).delete()
    fun cachedFile(url: String): File? = file(url).takeIf(File::isFile)
    private fun file(url: String) = File(directory, assetKey(url))
}

internal fun interface PackAssetFetcher {
    suspend fun fetch(url: String): ByteArray
}

/**
 * Explicit, durable pack-set downloads shared by the WebView and native result UI.
 * Wrapper artwork remains in R2; this stores only runtime cache bytes and records.
 */
class PackOfflineDownloadManager internal constructor(
    private val recordsDirectory: File,
    internal val assetStore: PackAssetStore,
    private val remoteAssetBaseURL: String,
    private val fetcher: PackAssetFetcher,
    private val scope: CoroutineScope,
) {
    constructor(
        context: Context,
        remoteAssetBaseURL: String = DEFAULT_PACK_ASSET_BASE_URL,
    ) : this(
        recordsDirectory = File(context.filesDir, "pack-opening/offline-sets"),
        assetStore = PackAssetStore(File(context.filesDir, "pack-opening/assets")),
        remoteAssetBaseURL = remoteAssetBaseURL,
        fetcher = PackAssetFetcher(::fetchRemoteAsset),
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
    )

    private val json = Json { ignoreUnknownKeys = true; prettyPrint = true }
    private val jobs = ConcurrentHashMap<String, Job>()
    private val listeners = ConcurrentHashMap<Int, (PackOfflineStatusSnapshot) -> Unit>()
    private var listenerID = 0
    private val records = ConcurrentHashMap<String, PackOfflineDownloadRecord>()
    private val statuses = ConcurrentHashMap<String, PackOfflineSetStatus>()

    init {
        require(remoteAssetBaseURL.startsWith("https://")) { "Pack asset base URL must use HTTPS" }
        recordsDirectory.mkdirs()
        loadRecords().forEach { record ->
            records[record.setID] = record
            statuses[record.setID] = PackOfflineSetStatus.Downloaded(record)
        }
    }

    fun status(setID: String): PackOfflineSetStatus = statuses[setID] ?: PackOfflineSetStatus.NotDownloaded
    fun isDownloaded(setID: String): Boolean = status(setID) is PackOfflineSetStatus.Downloaded

    /** Returns a durable local file for native image loading when one exists. */
    fun cachedAssetFile(url: String): File? = assetStore.cachedFile(url)

    /** Subscribes to status changes. The returned function removes the observer. */
    fun observe(listener: (PackOfflineStatusSnapshot) -> Unit): () -> Unit {
        val id = synchronized(this) { ++listenerID }
        listeners[id] = listener
        return { listeners.remove(id) }
    }

    fun download(request: PackOfflineSetRequest) {
        if (jobs[request.setID]?.isActive == true) return
        setStatus(request.setID, PackOfflineSetStatus.Downloading(0f))
        jobs[request.setID] = scope.launch {
            try {
                performDownload(request)
            } catch (_: CancellationException) {
                setStatus(request.setID, records[request.setID]?.let(PackOfflineSetStatus::Downloaded)
                    ?: PackOfflineSetStatus.NotDownloaded)
            } catch (error: Throwable) {
                setStatus(request.setID, PackOfflineSetStatus.Failed(
                    error.message ?: "The offline pack download failed.",
                ))
            } finally {
                jobs.remove(request.setID)
            }
        }
    }

    fun retry(request: PackOfflineSetRequest) = download(request)

    fun remove(setID: String) {
        jobs.remove(setID)?.cancel()
        val record = records.remove(setID)
        if (record != null) {
            val retainedURLs = records.values.flatMap(PackOfflineDownloadRecord::removableURLs).toSet()
            record.removableURLs.filterNot(retainedURLs::contains).forEach(assetStore::remove)
            recordFile(setID).delete()
        }
        setStatus(setID, PackOfflineSetStatus.NotDownloaded)
    }

    fun refresh() {
        records.clear()
        statuses.clear()
        loadRecords().forEach { record ->
            records[record.setID] = record
            statuses[record.setID] = PackOfflineSetStatus.Downloaded(record)
            notify(record.setID, statuses.getValue(record.setID))
        }
    }

    fun close() {
        jobs.values.forEach(Job::cancel)
        jobs.clear()
        listeners.clear()
        scope.cancel()
    }

    private suspend fun performDownload(request: PackOfflineSetRequest) {
        val manifestURL = resolveAssetURL("/pack/manifest.json", remoteAssetBaseURL)
        val manifestBytes = fetchWithRetry(manifestURL)
        val manifest = runCatching { json.decodeFromString(PackRemoteManifest.serializer(), manifestBytes.decodeToString()) }
            .getOrElse { throw IllegalStateException("The remote pack manifest could not be read.") }
        assetStore.write(manifestURL, manifestBytes)

        val sharedURLs = listOf(manifestURL, resolveAssetURL(manifest.mesh, remoteAssetBaseURL))
        val wrapperURLs = manifest.covers.values
            .filter { cover ->
                cover.packPool.equals(request.packPoolID, ignoreCase = true) ||
                    cover.setCode.equals(request.setID, ignoreCase = true)
            }
            .flatMap { listOfNotNull(it.plain, it.decaled) }
            .map { resolveAssetURL(it, remoteAssetBaseURL) }
        val setSpecificURLs = (wrapperURLs + request.cardAssetURLs).distinct()
        if (setSpecificURLs.isEmpty()) {
            throw IllegalStateException("No downloadable artwork was found for ${request.setName}.")
        }
        val allURLs = (sharedURLs + setSpecificURLs).distinct()
        var storedBytes = 0L

        var completed = 0
        allURLs.chunked(6).forEach { batch ->
            val assets = coroutineScope {
                batch.map { url ->
                    async {
                        val bytes = assetStore.read(url) ?: fetchWithRetry(url).also { assetStore.write(url, it) }
                        url to bytes
                    }
                }.awaitAll()
            }
            assets.forEach { (url, bytes) ->
                if (url in setSpecificURLs) storedBytes += bytes.size
                completed++
                setStatus(
                    request.setID,
                    PackOfflineSetStatus.Downloading(completed.toFloat() / allURLs.size.toFloat()),
                )
            }
        }

        val record = PackOfflineDownloadRecord(
            setID = request.setID,
            setName = request.setName,
            downloadedAtEpochMillis = System.currentTimeMillis(),
            cardCount = request.cardAssetURLs.size / 2,
            byteCount = storedBytes,
            removableURLs = setSpecificURLs,
        )
        saveRecord(record)
        records[request.setID] = record
        setStatus(request.setID, PackOfflineSetStatus.Downloaded(record))
    }

    private suspend fun fetchWithRetry(url: String): ByteArray {
        var lastError: Throwable? = null
        repeat(2) {
            try {
                return fetcher.fetch(url)
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                lastError = error
            }
        }
        throw lastError ?: IllegalStateException("$url could not be downloaded.")
    }

    private fun setStatus(setID: String, status: PackOfflineSetStatus) {
        statuses[setID] = status
        notify(setID, status)
    }

    private fun notify(setID: String, status: PackOfflineSetStatus) {
        val snapshot = PackOfflineStatusSnapshot(setID, status)
        listeners.values.forEach { it(snapshot) }
    }

    private fun saveRecord(record: PackOfflineDownloadRecord) {
        recordsDirectory.mkdirs()
        val destination = recordFile(record.setID)
        val temporary = File(recordsDirectory, "${destination.name}.tmp")
        temporary.writeText(json.encodeToString(record))
        if (!temporary.renameTo(destination)) {
            destination.writeText(temporary.readText())
            temporary.delete()
        }
    }

    private fun loadRecords(): List<PackOfflineDownloadRecord> = recordsDirectory.listFiles()
        .orEmpty()
        .filter { it.isFile && it.extension == "json" }
        .mapNotNull { file -> runCatching { json.decodeFromString(PackOfflineDownloadRecord.serializer(), file.readText()) }.getOrNull() }

    private fun recordFile(setID: String) = File(recordsDirectory, "${assetKey(setID)}.json")
}

internal fun resolveAssetURL(path: String, remoteBaseURL: String): String {
    if (path.startsWith("https://")) return path
    require(!path.startsWith("http://")) { "Pack assets must use HTTPS" }
    val clean = path.trimStart('/')
    require(clean.isNotBlank() && clean.split('/').none { it == ".." }) { "Invalid pack asset path" }
    return "${remoteBaseURL.trimEnd('/')}/$clean"
}

private suspend fun fetchRemoteAsset(url: String): ByteArray = withContext(Dispatchers.IO) {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 8_000
        readTimeout = 15_000
        instanceFollowRedirects = true
        requestMethod = "GET"
    }
    try {
        val responseCode = connection.responseCode
        if (responseCode !in 200..299) throw IllegalStateException("${URL(url).path.substringAfterLast('/')} returned $responseCode")
        connection.inputStream.use { it.readBytes() }
    } finally {
        connection.disconnect()
    }
}

internal fun assetKey(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray())
    .joinToString("") { "%02x".format(it) }

const val DEFAULT_PACK_ASSET_BASE_URL = "https://assets.tcger.ahmadjalil.com"
