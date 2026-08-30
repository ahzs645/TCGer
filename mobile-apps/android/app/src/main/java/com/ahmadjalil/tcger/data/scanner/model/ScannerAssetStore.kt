package com.ahmadjalil.tcger.data.scanner.model

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.Json

@Serializable
data class ScannerAssetManifestFile(
    val file: String,
    val bytes: Long,
    val sha256: String,
)

@Serializable
data class ScannerAssetManifest(
    val formatVersion: Int,
    val game: String,
    @Serializable(with = StringOrNumberSerializer::class)
    val version: String,
    val encoder: String,
    val modelName: String,
    val cardCount: Int,
    val printingCount: Int? = null,
    val metadataSchema: String? = null,
    val recognitionContract: String? = null,
    val dimension: Int,
    val downloadBytes: Long,
    val model: ScannerAssetManifestFile,
    val vectors: ScannerAssetManifestFile,
    val metadata: ScannerAssetManifestFile,
    val strongAcceptanceScore: Double,
    val ambiguityMargin: Double,
) {
    val displayedCardCount: Int get() = printingCount ?: cardCount
}

sealed interface ScannerAssetInstallStatus {
    data object NotInstalled : ScannerAssetInstallStatus
    data class Installing(val completedBytes: Long, val totalBytes: Long) : ScannerAssetInstallStatus {
        val progress: Float
            get() = if (totalBytes <= 0L) 0f else (completedBytes.toDouble() / totalBytes).toFloat().coerceIn(0f, 1f)
    }
    data class Installed(val manifest: ScannerAssetManifest) : ScannerAssetInstallStatus
    data class Failed(
        val message: String,
        val installedManifest: ScannerAssetManifest? = null,
    ) : ScannerAssetInstallStatus
}

data class InstalledScannerRuntime(
    val contract: ArcFaceRuntimeContract,
    val source: ScannerModelAssetSource,
)

internal fun interface ScannerAssetFetcher {
    suspend fun fetch(url: String, destination: File, progress: (Long) -> Unit)
}

/**
 * Installs complete, versioned scanner runtimes into app-private storage.
 * A version only becomes current after every byte, digest, index header, and
 * metadata row has been validated, so recognition never mixes releases.
 */
class ScannerAssetStore internal constructor(
    private val root: File,
    private val remoteBaseURL: String,
    private val fetcher: ScannerAssetFetcher,
) {
    constructor(
        context: Context,
        remoteBaseURL: String = DEFAULT_SCANNER_ASSET_BASE_URL,
    ) : this(
        root = File(context.applicationContext.filesDir, "scanner-models"),
        remoteBaseURL = remoteBaseURL,
        fetcher = ScannerAssetFetcher(::fetchScannerAsset),
    )

    private val json = Json { ignoreUnknownKeys = true; prettyPrint = true }
    private val mutableStatuses = MutableStateFlow<Map<String, ScannerAssetInstallStatus>>(emptyMap())
    val statuses: StateFlow<Map<String, ScannerAssetInstallStatus>> = mutableStatuses.asStateFlow()
    private val mutableRemoteManifests = MutableStateFlow<Map<String, ScannerAssetManifest>>(emptyMap())
    val remoteManifests: StateFlow<Map<String, ScannerAssetManifest>> = mutableRemoteManifests.asStateFlow()

    init {
        require(remoteBaseURL.startsWith("https://")) { "Scanner asset base URL must use HTTPS" }
        root.mkdirs()
        val installed = supportedDownloadGames.mapNotNull { game ->
            readInstalledManifest(game)?.let { game to ScannerAssetInstallStatus.Installed(it) }
        }.toMap()
        mutableStatuses.value = installed
    }

    fun status(game: String): ScannerAssetInstallStatus =
        mutableStatuses.value[normalizeScannerGame(game)] ?: ScannerAssetInstallStatus.NotInstalled

    fun installedRuntime(game: String): InstalledScannerRuntime? {
        val normalized = normalizeScannerGame(game)
        val manifest = readInstalledManifest(normalized) ?: return null
        val versionDirectory = versionDirectory(normalized, manifest.version)
        if (!hasExpectedFileSizes(versionDirectory, manifest)) return null
        return InstalledScannerRuntime(
            contract = manifest.runtimeContract(),
            source = FileScannerModelAssetSource(versionDirectory),
        )
    }

    suspend fun refreshManifest(game: String): ScannerAssetManifest {
        val normalized = normalizeScannerGame(game)
        require(normalized in supportedDownloadGames) { "No downloadable Android scanner is published for $game" }
        val manifestURL = "${remoteBaseURL.trimEnd('/')}/$normalized/manifest.json"
        val temporary = File(root, ".manifest-${normalized}-${UUID.randomUUID()}.json")
        return try {
            fetcher.fetch(manifestURL, temporary) { }
            val manifest = json.decodeFromString<ScannerAssetManifest>(temporary.readText())
            validateManifest(manifest, normalized)
            updateRemoteManifest(normalized, manifest)
            manifest
        } finally {
            temporary.delete()
        }
    }

    fun isUpdateAvailable(game: String): Boolean {
        val normalized = normalizeScannerGame(game)
        val installed = readInstalledManifest(normalized) ?: return false
        return mutableRemoteManifests.value[normalized]?.version?.let { it != installed.version } == true
    }

    suspend fun install(game: String) {
        val normalized = normalizeScannerGame(game)
        require(normalized in supportedDownloadGames) { "No downloadable Android scanner is published for $game" }
        updateStatus(normalized, ScannerAssetInstallStatus.Installing(0L, 0L))
        runCatching { installValidated(normalized) }
            .onSuccess { updateStatus(normalized, ScannerAssetInstallStatus.Installed(it)) }
            .onFailure { error ->
                updateStatus(
                    normalized,
                    ScannerAssetInstallStatus.Failed(
                        error.message ?: "Scanner model installation failed",
                        readInstalledManifest(normalized),
                    ),
                )
            }
    }

    fun remove(game: String) {
        val normalized = normalizeScannerGame(game)
        require(normalized in supportedDownloadGames) { "No downloadable Android scanner exists for $game" }
        gameDirectory(normalized).deleteRecursively()
        updateStatus(normalized, ScannerAssetInstallStatus.NotInstalled)
    }

    private suspend fun installValidated(game: String): ScannerAssetManifest = withContext(Dispatchers.IO) {
        val manifestURL = "${remoteBaseURL.trimEnd('/')}/$game/manifest.json"
        val staging = File(gameDirectory(game), ".staging-${UUID.randomUUID()}")
        staging.mkdirs()
        try {
            val manifestFile = File(staging, "remote-manifest.json")
            fetcher.fetch(manifestURL, manifestFile) { }
            val manifest = json.decodeFromString<ScannerAssetManifest>(manifestFile.readText())
            validateManifest(manifest, game)
            updateRemoteManifest(game, manifest)

            var completed = 0L
            updateStatus(game, ScannerAssetInstallStatus.Installing(completed, manifest.downloadBytes))
            val files = listOf(
                Triple(manifest.model, LOCAL_MODEL_FILE, "model"),
                Triple(manifest.vectors, LOCAL_VECTORS_FILE, "vectors"),
                Triple(manifest.metadata, LOCAL_METADATA_FILE, "metadata"),
            )
            files.forEach { (descriptor, localName, label) ->
                val destination = File(staging, localName)
                var assetProgress = 0L
                fetcher.fetch(resolveManifestAssetURL(manifestURL, descriptor.file), destination) { downloaded ->
                    assetProgress = downloaded
                    updateStatus(
                        game,
                        ScannerAssetInstallStatus.Installing(completed + assetProgress, manifest.downloadBytes),
                    )
                }
                verifyFile(destination, descriptor, label)
                completed += descriptor.bytes
            }

            val index = PackedCardEmbeddingIndex.decode(
                File(staging, LOCAL_VECTORS_FILE).readBytes(),
                File(staging, LOCAL_METADATA_FILE).readBytes(),
            )
            require(index.count == manifest.cardCount) {
                "${manifest.game} index has ${index.count} cards; manifest declares ${manifest.cardCount}"
            }
            require(index.dimension == manifest.dimension) {
                "${manifest.game} index dimension is ${index.dimension}; manifest declares ${manifest.dimension}"
            }
            require(index.cardCountForGame(game) == manifest.cardCount) {
                "${manifest.game} metadata contains rows assigned to another game"
            }

            File(staging, LOCAL_MANIFEST_FILE).writeText(json.encodeToString(manifest))
            manifestFile.delete()
            val destination = versionDirectory(game, manifest.version)
            destination.parentFile?.mkdirs()
            if (destination.exists()) {
                require(readManifest(File(destination, LOCAL_MANIFEST_FILE)) == manifest && hasExpectedFileSizes(destination, manifest)) {
                    "Scanner version ${manifest.version} already exists with different contents"
                }
                staging.deleteRecursively()
            } else {
                atomicMove(staging, destination)
            }
            writeCurrentManifest(game, manifest)
            removeInactiveVersions(game, keeping = manifest.version)
            manifest
        } catch (error: Throwable) {
            staging.deleteRecursively()
            throw error
        }
    }

    private fun validateManifest(manifest: ScannerAssetManifest, requestedGame: String) {
        require(manifest.formatVersion in 1..SUPPORTED_FORMAT_VERSION) {
            "Unsupported scanner manifest format ${manifest.formatVersion}"
        }
        require(normalizeScannerGame(manifest.game) == requestedGame) { "Scanner manifest is for ${manifest.game}, not $requestedGame" }
        require(manifest.encoder.equals("arcface", ignoreCase = true)) { "Only ArcFace scanner packs are supported" }
        require(manifest.version.matches(Regex("[A-Za-z0-9._-]{1,120}"))) { "Scanner manifest version is unsafe" }
        require(manifest.modelName.isNotBlank()) { "Scanner manifest model name is missing" }
        require(manifest.cardCount > 0 && manifest.dimension > 0) { "Scanner manifest index shape is invalid" }
        if (manifest.formatVersion == 2) {
            require(manifest.metadataSchema == "tcger-cards-index-metadata-v3") { "Unsupported scanner metadata schema" }
            require(manifest.recognitionContract == "tcger-two-stage-recognition-v2") { "Unsupported recognition contract" }
            require((manifest.printingCount ?: 0) >= manifest.cardCount) { "Scanner printing count is invalid" }
        }
        require(manifest.strongAcceptanceScore in -1.0..1.0) { "Scanner acceptance score is invalid" }
        require(manifest.ambiguityMargin in 0.0..2.0) { "Scanner ambiguity margin is invalid" }
        val descriptors = listOf(manifest.model, manifest.vectors, manifest.metadata)
        descriptors.forEach { descriptor ->
            require(descriptor.file.isNotBlank()) { "Scanner asset path is missing" }
            require(descriptor.bytes in 1..MAX_ASSET_BYTES) { "${descriptor.file} has an invalid byte count" }
            require(descriptor.sha256.matches(Regex("[a-fA-F0-9]{64}"))) { "${descriptor.file} has an invalid SHA-256" }
        }
        require(manifest.downloadBytes == descriptors.sumOf(ScannerAssetManifestFile::bytes)) {
            "Scanner manifest download size does not match its assets"
        }
        require(manifest.downloadBytes <= MAX_PACK_BYTES) { "Scanner pack is too large for an on-device install" }
    }

    private fun verifyFile(file: File, descriptor: ScannerAssetManifestFile, label: String) {
        require(file.length() == descriptor.bytes) {
            "$label downloaded ${file.length()} bytes; expected ${descriptor.bytes}"
        }
        require(file.sha256().equals(descriptor.sha256, ignoreCase = true)) {
            "$label SHA-256 mismatch; refusing to activate scanner pack"
        }
    }

    private fun readInstalledManifest(game: String): ScannerAssetManifest? {
        val manifest = readManifest(File(gameDirectory(game), CURRENT_MANIFEST_FILE)) ?: return null
        return manifest.takeIf {
            runCatching {
                validateManifest(it, game)
                hasExpectedFileSizes(versionDirectory(game, it.version), it)
            }.getOrDefault(false)
        }
    }

    private fun readManifest(file: File): ScannerAssetManifest? = file.takeIf(File::isFile)?.let {
        runCatching { json.decodeFromString<ScannerAssetManifest>(it.readText()) }.getOrNull()
    }

    private fun hasExpectedFileSizes(directory: File, manifest: ScannerAssetManifest): Boolean =
        File(directory, LOCAL_MODEL_FILE).length() == manifest.model.bytes &&
            File(directory, LOCAL_VECTORS_FILE).length() == manifest.vectors.bytes &&
            File(directory, LOCAL_METADATA_FILE).length() == manifest.metadata.bytes

    private fun writeCurrentManifest(game: String, manifest: ScannerAssetManifest) {
        val directory = gameDirectory(game).apply { mkdirs() }
        val temporary = File(directory, "$CURRENT_MANIFEST_FILE.tmp")
        temporary.writeText(json.encodeToString(manifest))
        atomicMove(temporary, File(directory, CURRENT_MANIFEST_FILE))
    }

    private fun removeInactiveVersions(game: String, keeping: String) {
        File(gameDirectory(game), "versions").listFiles()
            ?.filter { it.name != keeping }
            ?.forEach { it.deleteRecursively() }
    }

    private fun gameDirectory(game: String) = File(root, game)
    private fun versionDirectory(game: String, version: String) = File(gameDirectory(game), "versions/$version")

    private fun updateStatus(game: String, status: ScannerAssetInstallStatus) {
        mutableStatuses.value = mutableStatuses.value.toMutableMap().apply { put(game, status) }
    }

    private fun updateRemoteManifest(game: String, manifest: ScannerAssetManifest) {
        mutableRemoteManifests.value = mutableRemoteManifests.value.toMutableMap().apply {
            put(game, manifest)
        }
    }

    private fun ScannerAssetManifest.runtimeContract() = ArcFaceRuntimeContract(
        game = normalizeScannerGame(game),
        version = version,
        model = ScannerModelAsset(LOCAL_MODEL_FILE, model.bytes, model.sha256.lowercase()),
        vectors = ScannerModelAsset(LOCAL_VECTORS_FILE, vectors.bytes, vectors.sha256.lowercase()),
        metadata = ScannerModelAsset(LOCAL_METADATA_FILE, metadata.bytes, metadata.sha256.lowercase()),
        expectedCardCount = cardCount,
        embeddingDimension = dimension,
        strongAcceptanceScore = strongAcceptanceScore,
        ambiguityMargin = ambiguityMargin,
    )

    companion object {
        const val DEFAULT_SCANNER_ASSET_BASE_URL = "https://assets.tcger.ahmadjalil.com/android/scan-assets"
        private const val SUPPORTED_FORMAT_VERSION = 2
        private const val CURRENT_MANIFEST_FILE = "current.json"
        private const val LOCAL_MANIFEST_FILE = "manifest.json"
        private const val LOCAL_MODEL_FILE = "model.onnx"
        private const val LOCAL_VECTORS_FILE = "vectors.bin"
        private const val LOCAL_METADATA_FILE = "metadata.json"
        private const val MAX_ASSET_BYTES = 512_000_000L
        private const val MAX_PACK_BYTES = 1_000_000_000L
        /** Ordered registry of scanner adapters this app build can safely execute. */
        val supportedDownloadGames = listOf("pokemon", "magic", "yugioh")
    }
}

internal fun normalizeScannerGame(game: String): String = when (game.trim().lowercase()) {
    "yu-gi-oh", "yu-gi-oh!" -> "yugioh"
    "mtg", "magic-the-gathering" -> "magic"
    else -> game.trim().lowercase()
}

internal fun resolveManifestAssetURL(manifestURL: String, path: String): String {
    require(!path.startsWith("http://")) { "Scanner assets must use HTTPS" }
    require(path.split('/').none { it == ".." }) { "Scanner asset path is unsafe" }
    // Manifests live at <base>/<game>/manifest.json while content-addressed
    // objects are shared at <base>/objects. Relative `file` values are rooted
    // at the Android scanner asset base, not at the per-game pointer.
    val assetBase = URL(URL(manifestURL), "../")
    val resolved = URL(assetBase, path).toString()
    require(resolved.startsWith("https://")) { "Scanner assets must use HTTPS" }
    return resolved
}

internal object StringOrNumberSerializer : KSerializer<String> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("StringOrNumber", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): String {
        val jsonDecoder = decoder as? JsonDecoder ?: return decoder.decodeString()
        return jsonDecoder.decodeJsonElement().let { element ->
            require(element is JsonPrimitive && (element.isString || element.content.toLongOrNull() != null)) {
                "Scanner version must be a string or number"
            }
            element.content
        }
    }

    override fun serialize(encoder: Encoder, value: String) {
        val jsonEncoder = encoder as? JsonEncoder
        if (jsonEncoder == null) encoder.encodeString(value)
        else jsonEncoder.encodeJsonElement(JsonPrimitive(value))
    }
}

private fun atomicMove(source: File, destination: File) {
    destination.parentFile?.mkdirs()
    runCatching {
        Files.move(
            source.toPath(),
            destination.toPath(),
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING,
        )
    }.getOrElse {
        Files.move(source.toPath(), destination.toPath(), StandardCopyOption.REPLACE_EXISTING)
    }
}

private fun File.sha256(): String {
    val digest = MessageDigest.getInstance("SHA-256")
    inputStream().buffered().use { input ->
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            digest.update(buffer, 0, count)
        }
    }
    return digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
}

internal suspend fun fetchScannerAsset(url: String, destination: File, progress: (Long) -> Unit) =
    withContext(Dispatchers.IO) {
        destination.parentFile?.mkdirs()
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 60_000
            instanceFollowRedirects = true
            requestMethod = "GET"
        }
        try {
            val responseCode = connection.responseCode
            require(responseCode in 200..299) { "${URL(url).path.substringAfterLast('/')} returned $responseCode" }
            connection.inputStream.buffered().use { input ->
                destination.outputStream().buffered().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var completed = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                        completed += count
                        progress(completed)
                    }
                }
            }
        } finally {
            connection.disconnect()
        }
    }
