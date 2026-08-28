package com.ahmadjalil.tcger.data.gamepackage

import android.content.Context
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import okhttp3.OkHttpClient
import okhttp3.Request

@Serializable data class GamePackageAsset(val url: String, val bytes: Long, val sha256: String, val mediaType: String? = null)
@Serializable data class GamePackageFilterOption(val value: JsonElement, val label: String)
@Serializable data class GamePackageFilter(
    val id: String,
    val label: String,
    val property: String,
    val help: String? = null,
    val type: String,
    val options: List<GamePackageFilterOption> = emptyList(),
    val min: Double? = null,
    val max: Double? = null,
    val step: Double? = null,
    val trueLabel: String? = null,
    val falseLabel: String? = null,
    val mode: String? = null,
    val maxLength: Int? = null,
)
@Serializable data class GamePackageGame(val id: String, val name: String, val shortName: String? = null, val description: String? = null, val homepage: String? = null, val accentColor: String? = null)
@Serializable data class GamePackagePublisher(val name: String, val homepage: String? = null)
@Serializable data class GamePackageCatalog(val schema: String, val asset: GamePackageAsset, val cardCount: Int, val setCount: Int? = null)
@Serializable data class GamePackageRuntimeAsset(val runtime: String, val manifest: GamePackageAsset)
@Serializable data class GamePackageScanner(val web: GamePackageRuntimeAsset? = null, val ios: GamePackageRuntimeAsset? = null, val android: GamePackageRuntimeAsset? = null)
@Serializable data class GamePackageOfflinePacks(val schema: String, val manifest: GamePackageAsset)
@Serializable data class GamePackageManifest(
    val schema: String,
    val packageVersion: String,
    val publishedAt: String,
    val game: GamePackageGame,
    val publisher: GamePackagePublisher,
    val catalog: GamePackageCatalog,
    val filters: List<GamePackageFilter> = emptyList(),
    val scanner: GamePackageScanner? = null,
    val offlinePacks: GamePackageOfflinePacks? = null,
)
@Serializable data class InstalledGamePackage(val id: String, val sourceUrl: String, val installedAt: String, val manifest: GamePackageManifest)
@Serializable data class CommunityCatalogCard(
    val id: String,
    val name: String,
    val setCode: String? = null,
    val collectorNumber: String? = null,
    val rarity: String? = null,
    val artist: String? = null,
    val type: String? = null,
    val category: String? = null,
    val releasedAt: String? = null,
    val imageUrl: String? = null,
    val imageUrlSmall: String? = null,
    val attributes: Map<String, JsonElement> = emptyMap(),
)
@Serializable private data class CommunityCatalog(val formatVersion: Int, val tcg: String, val cards: List<CommunityCatalogCard>)
data class GamePackageState(val installed: List<InstalledGamePackage> = emptyList(), val isInstalling: Boolean = false, val error: String? = null)

class GamePackageStore(context: Context) {
    private val root = File(context.filesDir, "game-packages")
    private val index = File(root, "installed.json")
    private val json = Json { ignoreUnknownKeys = true; prettyPrint = true }
    private val http = OkHttpClient.Builder().followRedirects(false).build()
    private val _state = MutableStateFlow(GamePackageState(installed = loadInstalled()))
    val state: StateFlow<GamePackageState> = _state.asStateFlow()

    suspend fun install(source: String) = withContext(Dispatchers.IO) {
        _state.value = _state.value.copy(isInstalling = true, error = null)
        runCatching {
            val sourceUri = secureUri(source)
            val manifestBytes = download(sourceUri, 1_048_576)
            val manifest = json.decodeFromString<GamePackageManifest>(manifestBytes.decodeToString())
            validate(manifest)
            val catalogUri = secureUri(sourceUri.resolve(manifest.catalog.asset.url).toString())
            val catalogBytes = download(catalogUri, manifest.catalog.asset.bytes)
            require(catalogBytes.size.toLong() == manifest.catalog.asset.bytes) { "Catalog byte count does not match" }
            val digest = MessageDigest.getInstance("SHA-256").digest(catalogBytes).joinToString("") { "%02x".format(it) }
            require(digest == manifest.catalog.asset.sha256.lowercase()) { "Catalog checksum does not match" }
            val catalog = json.decodeFromString<CommunityCatalog>(catalogBytes.decodeToString())
            require(catalog.formatVersion == 1 && catalog.tcg == manifest.game.id && catalog.cards.size == manifest.catalog.cardCount) { "Catalog identity or card count does not match" }
            require(catalog.cards.map { it.id }.distinct().size == catalog.cards.size) { "Catalog card ids must be unique" }
            val directory = File(root, manifest.game.id).apply { mkdirs() }
            File(directory, "manifest.json").writeBytes(manifestBytes)
            File(directory, "catalog.json").writeBytes(catalogBytes)
            val record = InstalledGamePackage(manifest.game.id, sourceUri.toString(), Instant.now().toString(), manifest)
            val installed = (_state.value.installed.filterNot { it.id == record.id } + record).sortedBy { it.manifest.game.name }
            persist(installed)
            _state.value = GamePackageState(installed)
        }.onFailure { error -> _state.value = _state.value.copy(isInstalling = false, error = error.message ?: "The game package could not be installed") }
    }

    suspend fun cards(gameId: String): List<CommunityCatalogCard> = withContext(Dispatchers.IO) {
        json.decodeFromString<CommunityCatalog>(File(File(root, gameId), "catalog.json").readText()).cards
    }

    fun remove(gameId: String) {
        File(root, gameId).deleteRecursively()
        val installed = _state.value.installed.filterNot { it.id == gameId }
        persist(installed)
        _state.value = GamePackageState(installed)
    }

    private fun validate(manifest: GamePackageManifest) {
        require(manifest.schema == "https://tcger.app/schemas/game-package-manifest/v1") { "Unsupported game package schema" }
        require(manifest.catalog.schema == "tcger-catalog-v1") { "Unsupported catalog schema" }
        require(manifest.game.id.matches(Regex("^[a-z0-9][a-z0-9-]{0,63}$"))) { "Invalid game id" }
        require(manifest.catalog.cardCount >= 0 && manifest.catalog.asset.bytes in 1L..536_870_912L && manifest.catalog.asset.sha256.matches(Regex("^[A-Fa-f0-9]{64}$"))) { "Invalid catalog asset" }
        require(manifest.offlinePacks == null || manifest.offlinePacks.schema == "tcger-pack-library-v1") { "Unsupported pack schema" }
        require(listOfNotNull(manifest.scanner?.web, manifest.scanner?.ios, manifest.scanner?.android).all { it.runtime == "tcger-arcface-v1" }) { "Unsupported scanner runtime" }
        require(manifest.filters.size <= 24) { "Too many filters" }
        require(manifest.filters.map { it.id }.distinct().size == manifest.filters.size) { "Filter ids must be unique" }
        val property = Regex("^(id|name|setCode|collectorNumber|rarity|artist|type|category|releasedAt|attributes\\.[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*)$")
        manifest.filters.forEach {
            require(it.id.matches(Regex("^[a-z0-9][a-z0-9-]{0,63}$")) && it.property.matches(property) && it.type in setOf("select", "multiSelect", "numberRange", "boolean", "text") && it.options.size <= 200) { "Unsupported package filter" }
            if (it.type in setOf("select", "multiSelect")) require(it.options.isNotEmpty()) { "Filter options are required" }
            if (it.type == "numberRange") require(it.min != null && it.max != null && it.min <= it.max) { "Invalid number range" }
            if (it.type == "text") require((it.maxLength ?: 80) in 1..200) { "Invalid text filter" }
        }
    }

    private fun secureUri(value: String): URI {
        val uri = URI(value.trim())
        val local = uri.host in setOf("localhost", "127.0.0.1")
        require((uri.scheme == "https" || (uri.scheme == "http" && local)) && uri.userInfo == null && uri.fragment == null) { "Game package links must use HTTPS" }
        return uri
    }

    private fun download(uri: URI, maximumBytes: Long): ByteArray {
        val response = http.newCall(Request.Builder().url(uri.toString()).get().build()).execute()
        response.use {
            require(it.isSuccessful) { "Download failed (${it.code})" }
            require((it.body?.contentLength() ?: -1) <= maximumBytes) { "Download is larger than allowed" }
            val bytes = requireNotNull(it.body).bytes()
            require(bytes.size.toLong() <= maximumBytes) { "Download is larger than allowed" }
            return bytes
        }
    }

    private fun loadInstalled(): List<InstalledGamePackage> = runCatching { json.decodeFromString<List<InstalledGamePackage>>(index.readText()) }.getOrDefault(emptyList())
    private fun persist(installed: List<InstalledGamePackage>) { root.mkdirs(); index.writeText(json.encodeToString(installed)) }
}
