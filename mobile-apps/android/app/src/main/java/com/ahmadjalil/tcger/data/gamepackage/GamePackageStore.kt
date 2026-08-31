package com.ahmadjalil.tcger.data.gamepackage

import android.content.Context
import com.ahmadjalil.tcger.BuildConfig
import java.io.File
import java.net.URI
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.time.Instant
import java.util.Base64
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer

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
@Serializable data class GamePackageSigningKey(val id: String, val algorithm: String, val publicKey: String)
@Serializable data class GamePackagePublisher(val id: String? = null, val name: String, val homepage: String? = null, val signingKey: GamePackageSigningKey? = null)
@Serializable data class GamePackageSignature(val algorithm: String, val keyId: String, val url: String)
@Serializable data class GamePackageUpdate(val sequence: Long, val manifestUrl: String? = null, val releaseNotes: String? = null)
@Serializable data class GamePackageCatalog(val schema: String, val asset: GamePackageAsset, val cardCount: Int, val setCount: Int? = null)
@Serializable data class GamePackageRuntimeAsset(val runtime: String, val manifest: GamePackageAsset)
@Serializable data class GamePackageScanner(val web: GamePackageRuntimeAsset? = null, val ios: GamePackageRuntimeAsset? = null, val android: GamePackageRuntimeAsset? = null)
@Serializable data class GamePackageOfflinePacks(val schema: String, val manifest: GamePackageAsset)
@Serializable data class GamePackageSealedProducts(val schema: String, val asset: GamePackageAsset, val productCount: Int)
@Serializable data class GamePackageFormat(val id: String, val label: String, val physical: Boolean = true)
@Serializable data class GamePackagePresentation(val accentColor: String? = null, val iconUrl: String? = null, val cardBackUrl: String? = null)
@Serializable data class GamePackageFeature(val id: String, val version: Int = 1)
object GameFeatureAdapters {
    const val POKEDEX = "pokedex"
    val supportedVersions: Map<String, Int> = mapOf(POKEDEX to 1)
}
@Serializable data class GamePackageInterfaces(
    val search: Boolean = true,
    val collection: Boolean = true,
    val sets: Boolean = true,
    val wishlists: Boolean = true,
    val decks: Boolean = false,
    val pricing: Boolean = false,
    val sealedProducts: Boolean = false,
    val scanner: Boolean = false,
    val packOpening: Boolean = false,
    val features: List<GamePackageFeature> = emptyList(),
) {
    fun supportsFeature(id: String, maximumVersion: Int = 1): Boolean =
        features.any { it.id == id && it.version <= maximumVersion }

    fun enabledLabels(): List<String> = listOf(
        search to "Search", collection to "Collections", sets to "Sets", wishlists to "Wishlists",
        decks to "Decks", pricing to "Pricing", sealedProducts to "Sealed", scanner to "Scanner", packOpening to "Pack opening",
    ).mapNotNull { (enabled, label) -> label.takeIf { enabled } } + features.map { it.id }
}
@Serializable data class GamePackageIdentityMode(val id: String, val label: String, val description: String, val key: String)
@Serializable data class GamePackageCollectionDefinition(val identityModes: List<GamePackageIdentityMode>, val defaultIdentityMode: String, val facets: List<GamePackageFilter> = emptyList())
@Serializable data class GamePackageSearchDefinition(val facets: List<GamePackageFilter> = emptyList())
@Serializable data class GamePackageDefinition(
    val id: String,
    val label: String,
    val shortLabel: String? = null,
    val aliases: List<String> = emptyList(),
    val formats: List<GamePackageFormat> = emptyList(),
    val presentation: GamePackagePresentation? = null,
    val interfaces: GamePackageInterfaces? = null,
    val collection: GamePackageCollectionDefinition,
    val search: GamePackageSearchDefinition,
)
@Serializable data class GamePackageManifest(
    val schema: String,
    val packageId: String? = null,
    val packageVersion: String,
    val publishedAt: String,
    val update: GamePackageUpdate? = null,
    val game: GamePackageGame,
    val publisher: GamePackagePublisher,
    val signature: GamePackageSignature? = null,
    val catalog: GamePackageCatalog,
    val filters: List<GamePackageFilter> = emptyList(),
    val definition: GamePackageDefinition? = null,
    val scanner: GamePackageScanner? = null,
    val offlinePacks: GamePackageOfflinePacks? = null,
    val sealedProducts: GamePackageSealedProducts? = null,
) {
    val installedId: String get() = if (packageId != null && publisher.id != null) "${publisher.id}--$packageId" else game.id
    val effectiveDefinition: GamePackageDefinition get() = definition ?: GamePackageDefinition(
        id = game.id,
        label = game.name,
        shortLabel = game.shortName,
        presentation = game.accentColor?.let { GamePackagePresentation(accentColor = it) },
        interfaces = GamePackageInterfaces(sets = catalog.setCount != null, sealedProducts = sealedProducts != null, scanner = scanner != null, packOpening = offlinePacks != null),
        collection = GamePackageCollectionDefinition(
            identityModes = listOf(GamePackageIdentityMode("collector", "Collector", "Keep exact sets, rarities, artwork, and variants separate.", "printingKey")),
            defaultIdentityMode = "collector",
            facets = filters,
        ),
        search = GamePackageSearchDefinition(filters),
    )
}
@Serializable data class GamePackageTrust(val status: String, val keyId: String? = null, val fingerprint: String? = null)
@Serializable data class InstalledGamePackage(val id: String, val sourceUrl: String, val installedAt: String, val manifest: GamePackageManifest, val trust: GamePackageTrust? = null)
enum class GamePackageDuplicateKind { INCLUDED, SAME_PACKAGE, SAME_CATALOG }
enum class GamePackageReleaseRelation { DIFFERENT_PACKAGE, SAME, UPDATE, DOWNGRADE, CONFLICT }

fun needsGameInstallation(enabledGames: Set<String>, installedPackageCount: Int): Boolean =
    enabledGames.isEmpty() && installedPackageCount == 0

fun gamePackageReleaseRelation(current: GamePackageManifest, candidate: GamePackageManifest): GamePackageReleaseRelation {
    if (current.installedId != candidate.installedId) return GamePackageReleaseRelation.DIFFERENT_PACKAGE
    if (current.game.id != candidate.game.id) return GamePackageReleaseRelation.CONFLICT
    val sameContent = current == candidate
    val currentSequence = current.update?.sequence
    val candidateSequence = candidate.update?.sequence
    if (currentSequence != null || candidateSequence != null) {
        if (currentSequence == null || candidateSequence == null) return GamePackageReleaseRelation.CONFLICT
        return when {
            candidateSequence > currentSequence -> GamePackageReleaseRelation.UPDATE
            candidateSequence < currentSequence -> GamePackageReleaseRelation.DOWNGRADE
            sameContent -> GamePackageReleaseRelation.SAME
            else -> GamePackageReleaseRelation.CONFLICT
        }
    }
    val currentTime = runCatching { Instant.parse(current.publishedAt) }.getOrNull()
    val candidateTime = runCatching { Instant.parse(candidate.publishedAt) }.getOrNull()
    return when {
        currentTime == null || candidateTime == null -> GamePackageReleaseRelation.CONFLICT
        candidateTime > currentTime -> GamePackageReleaseRelation.UPDATE
        candidateTime < currentTime -> GamePackageReleaseRelation.DOWNGRADE
        sameContent -> GamePackageReleaseRelation.SAME
        else -> GamePackageReleaseRelation.CONFLICT
    }
}

fun duplicateGamePackage(installed: List<GamePackageManifest>, candidate: GamePackageManifest): GamePackageDuplicateKind? {
    if (candidate.publisher.id == "tcger" && candidate.packageId == "${candidate.game.id}-catalog") {
        return GamePackageDuplicateKind.INCLUDED
    }
    installed.forEach { current ->
        val sameCatalog = current.game.id == candidate.game.id &&
            current.catalog.asset.sha256.equals(candidate.catalog.asset.sha256, ignoreCase = true)
        if (current.installedId == candidate.installedId) {
            if (sameCatalog && current.packageVersion == candidate.packageVersion) return GamePackageDuplicateKind.SAME_PACKAGE
        } else if (sameCatalog) {
            return GamePackageDuplicateKind.SAME_CATALOG
        }
    }
    return null
}

@Serializable data class CommunityCatalogCard(
    val id: String,
    val baseExternalId: String? = null,
    val printingKey: String? = null,
    val artworkId: String? = null,
    val name: String,
    val setCode: String? = null,
    val setName: String? = null,
    val collectorNumber: String? = null,
    val rarity: String? = null,
    val artist: String? = null,
    val type: String? = null,
    val category: String? = null,
    val stage: String? = null,
    val suffix: String? = null,
    val archetype: String? = null,
    val classifications: List<String> = emptyList(),
    val variants: List<String> = emptyList(),
    val character: String? = null,
    val era: String? = null,
    val specialTrait: String? = null,
    val treatments: List<String> = emptyList(),
    val supertype: String? = null,
    val subtypes: List<String> = emptyList(),
    val types: List<String> = emptyList(),
    val hp: Double? = null,
    val manaCost: String? = null,
    val colors: List<String> = emptyList(),
    val race: String? = null,
    val atk: Double? = null,
    val def: Double? = null,
    val level: Double? = null,
    val language: String? = null,
    val regulationMark: String? = null,
    val sanctionedPlayLegal: Boolean? = null,
    val formatLegality: Map<String, JsonElement> = emptyMap(),
    val dexEntries: List<JsonElement> = emptyList(),
    val releasedAt: String? = null,
    val imageUrl: String? = null,
    val imageUrlSmall: String? = null,
    val attributes: Map<String, JsonElement> = emptyMap(),
) {
    fun effectiveAttributes(): Map<String, JsonElement> = buildMap {
        fun string(key: String, value: String?) { value?.let { put(key, JsonPrimitive(it)) } }
        fun strings(key: String, value: List<String>) { if (value.isNotEmpty()) put(key, JsonArray(value.map(::JsonPrimitive))) }
        fun number(key: String, value: Double?) { value?.let { put(key, JsonPrimitive(it)) } }
        string("artist", artist); string("type", type); string("category", category); string("stage", stage)
        string("suffix", suffix); string("archetype", archetype); string("character", character)
        string("era", era); string("specialTrait", specialTrait); string("manaCost", manaCost); string("race", race)
        strings("classifications", classifications); strings("variants", variants); strings("treatments", treatments)
        strings("subtypes", subtypes); strings("types", types); strings("colors", colors)
        number("hp", hp); number("atk", atk); number("def", def); number("level", level)
        putAll(attributes)
    }
}
@Serializable data class CommunityCatalogSet(val code: String, val name: String, val series: String? = null, val releasedAt: String? = null, val cardCount: Int? = null, val iconUrl: String? = null, val logoUrl: String? = null)
@Serializable private data class CommunityCatalog(val formatVersion: Int, val tcg: String, val sets: List<CommunityCatalogSet> = emptyList(), val cards: List<CommunityCatalogCard>)
@Serializable private data class OfficialCatalogManifest(val formatVersion: Int, val games: Map<String, OfficialCatalogEntry>)
@Serializable private data class OfficialCatalogEntry(val cardCount: Int, val sha256: String, val packageFile: String? = null)
data class GamePackageState(
    val installed: List<InstalledGamePackage> = emptyList(),
    val official: List<GamePackageManifest> = emptyList(),
    val isInstalling: Boolean = false,
    val isRefreshingOfficial: Boolean = false,
    val availableUpdates: Map<String, GamePackageManifest> = emptyMap(),
    val error: String? = null,
)

class GamePackageStore(
    context: Context,
    private val catalogBaseUrl: String = "https://assets.tcger.ahmadjalil.com/catalogs",
    private val requireSignedOfficialPackages: Boolean = BuildConfig.REQUIRE_SIGNED_OFFICIAL_GAME_PACKAGES,
) {
    private val root = File(context.filesDir, "game-packages")
    private val index = File(root, "installed.json")
    private val officialIndex = File(root, "official.json")
    private val publisherKeysIndex = File(root, "publisher-keys.json")
    private val json = Json { ignoreUnknownKeys = true; prettyPrint = true }
    private val http = OkHttpClient.Builder().followRedirects(false).build()
    private var publisherKeys: MutableMap<String, String> = loadPublisherKeys().toMutableMap()
    private val _state = MutableStateFlow(GamePackageState(installed = loadInstalled(), official = loadOfficial()))
    val state: StateFlow<GamePackageState> = _state.asStateFlow()

    suspend fun checkForUpdates() = withContext(Dispatchers.IO) {
        val updates = _state.value.installed.mapNotNull { installed ->
            val updateUrl = installed.manifest.update?.manifestUrl ?: installed.sourceUrl
            runCatching {
                val source = secureUri(updateUrl)
                val manifestBytes = download(source, 1_048_576)
                val candidate = json.decodeFromString<GamePackageManifest>(manifestBytes.decodeToString())
                validate(candidate)
                val verification = verifyPublisher(source, manifestBytes, candidate)
                if (installed.trust?.status == "verified" && verification.trust.status != "verified") {
                    return@runCatching null
                }
                if (installed.trust?.status == "verified" && installed.trust.keyId != verification.trust.keyId) {
                    return@runCatching null
                }
                candidate.takeIf {
                    gamePackageReleaseRelation(installed.manifest, it) == GamePackageReleaseRelation.UPDATE
                }?.let { installed.id to it }
            }.getOrNull()
        }.toMap()
        _state.value = _state.value.copy(availableUpdates = updates)
    }

    suspend fun update(packageId: String) {
        val installed = _state.value.installed.firstOrNull { it.id == packageId } ?: return
        installSource(
            installed.manifest.update?.manifestUrl ?: installed.sourceUrl,
            allowOfficial = installed.manifest.publisher.id == "tcger" &&
                installed.manifest.packageId == "${installed.manifest.game.id}-catalog",
        )
    }

    suspend fun installOfficial(gameId: String) {
        val manifest = _state.value.official.firstOrNull { it.game.id == gameId }
            ?: error("This game is not available in the current store index")
        val source = manifest.update?.manifestUrl
            ?: error("The official package does not declare a stable install URL")
        installSource(source, allowOfficial = true)
    }

    suspend fun refreshOfficial() = withContext(Dispatchers.IO) {
        _state.value = _state.value.copy(isRefreshingOfficial = true)
        runCatching {
            val base = secureUri(catalogBaseUrl.trimEnd('/') + "/")
            val catalogManifest = json.decodeFromString<OfficialCatalogManifest>(
                download(base.resolve("manifest.json"), 1_048_576).decodeToString(),
            )
            require(catalogManifest.formatVersion == 1) { "Unsupported official catalog manifest" }
            val official = catalogManifest.games.mapNotNull { (gameId, entry) ->
                val file = entry.packageFile ?: return@mapNotNull null
                require(!file.contains('/') && !file.contains('\\')) { "Unsafe official package filename" }
                val manifestUri = base.resolve(file)
                val manifestBytes = download(manifestUri, 1_048_576)
                val manifest = json.decodeFromString<GamePackageManifest>(manifestBytes.decodeToString())
                validate(manifest)
                require(
                    manifest.publisher.id == "tcger" && manifest.game.id == gameId &&
                        manifest.catalog.cardCount == entry.cardCount &&
                        manifest.catalog.asset.sha256.equals(entry.sha256, ignoreCase = true)
                ) { "Official package identity does not match the catalog index" }
                val verification = verifyPublisher(manifestUri, manifestBytes, manifest)
                require(!requireSignedOfficialPackages || verification.trust.status == "verified") {
                    "Official packages must have a valid publisher signature"
                }
                _state.value.official.firstOrNull { it.installedId == manifest.installedId }?.let { current ->
                    require(
                        gamePackageReleaseRelation(current, manifest) in setOf(
                            GamePackageReleaseRelation.SAME,
                            GamePackageReleaseRelation.UPDATE,
                        )
                    ) { "Official package rollback or release conflict for $gameId" }
                }
                verification.pin?.let { publisherKeys[it.first] = it.second }
                manifest
            }.sortedBy { it.game.name }
            root.mkdirs()
            persistPublisherKeys()
            officialIndex.writeText(json.encodeToString(official))
            _state.value = _state.value.copy(official = official, isRefreshingOfficial = false, error = null)
        }.onFailure { error ->
            _state.value = _state.value.copy(
                isRefreshingOfficial = false,
                error = if (_state.value.official.isEmpty()) error.message ?: "The Game Store could not be loaded" else _state.value.error,
            )
        }
    }

    suspend fun install(source: String) = installSource(source, allowOfficial = false)

    private suspend fun installSource(source: String, allowOfficial: Boolean) = withContext(Dispatchers.IO) {
        _state.value = _state.value.copy(isInstalling = true, error = null)
        runCatching {
            val sourceUri = secureUri(source)
            val manifestBytes = download(sourceUri, 1_048_576)
            val manifest = json.decodeFromString<GamePackageManifest>(manifestBytes.decodeToString())
            validate(manifest)
            val publisherVerification = verifyPublisher(sourceUri, manifestBytes, manifest)
            _state.value.installed.firstOrNull { it.id == manifest.installedId }?.let { current ->
                if (current.trust?.status == "verified" && publisherVerification.trust.status != "verified") {
                    error("A verified package cannot be replaced by an unsigned update")
                }
                if (current.trust?.status == "verified" && current.trust.keyId != publisherVerification.trust.keyId) {
                    error("The publisher signing key changed; explicit key rotation is required")
                }
                when (gamePackageReleaseRelation(current.manifest, manifest)) {
                    GamePackageReleaseRelation.UPDATE -> Unit
                    GamePackageReleaseRelation.SAME -> error("This exact package release is already installed")
                    GamePackageReleaseRelation.DOWNGRADE -> error("A newer package release is already installed")
                    GamePackageReleaseRelation.CONFLICT -> error("This package conflicts with the installed release sequence")
                    GamePackageReleaseRelation.DIFFERENT_PACKAGE -> Unit
                }
            }
            when (duplicateGamePackage(_state.value.installed.map { it.manifest }, manifest)) {
                GamePackageDuplicateKind.INCLUDED -> if (!allowOfficial) {
                    error("This official TCGer package is available through the Game Store")
                }
                GamePackageDuplicateKind.SAME_PACKAGE -> error("This exact package version is already installed")
                GamePackageDuplicateKind.SAME_CATALOG -> error("This catalog is already installed under another package name")
                null -> Unit
            }
            val catalogUri = secureUri(sourceUri.resolve(manifest.catalog.asset.url).toString())
            val catalogBytes = download(catalogUri, manifest.catalog.asset.bytes)
            require(catalogBytes.size.toLong() == manifest.catalog.asset.bytes) { "Catalog byte count does not match" }
            val digest = MessageDigest.getInstance("SHA-256").digest(catalogBytes).joinToString("") { "%02x".format(it) }
            require(digest == manifest.catalog.asset.sha256.lowercase()) { "Catalog checksum does not match" }
            val catalog = json.decodeFromString<CommunityCatalog>(catalogBytes.decodeToString())
            require(catalog.formatVersion == 1 && catalog.tcg == manifest.game.id && catalog.cards.size == manifest.catalog.cardCount) { "Catalog identity or card count does not match" }
            require(manifest.catalog.setCount == null || catalog.sets.size == manifest.catalog.setCount) { "Catalog set count does not match" }
            require(catalog.cards.map { it.id }.distinct().size == catalog.cards.size) { "Catalog card ids must be unique" }
            require(
                manifest.effectiveDefinition.interfaces?.supportsFeature("pokedex") != true ||
                    catalog.cards.any { card ->
                        card.dexEntries.any { entry ->
                            ((entry as? JsonObject)?.get("number") as? JsonPrimitive)?.intOrNull?.let { it > 0 } == true
                        }
                    }
            ) { "Pokédex support requires normalized dexEntries data" }
            root.mkdirs()
            val directory = File(root, manifest.installedId)
            val staging = File(root, ".staging-${manifest.installedId}-${UUID.randomUUID()}")
            val backup = File(root, ".backup-${manifest.installedId}-${UUID.randomUUID()}")
            require(staging.mkdir()) { "Could not stage the game package" }
            runCatching {
                File(staging, "manifest.json").writeBytes(manifestBytes)
                File(staging, "catalog.json").writeBytes(catalogBytes)
            }.onFailure {
                staging.deleteRecursively()
            }.getOrThrow()
            val previous = _state.value.installed.firstOrNull { it.id == manifest.installedId }
            val record = InstalledGamePackage(
                manifest.installedId,
                manifest.update?.manifestUrl ?: sourceUri.toString(),
                previous?.installedAt ?: Instant.now().toString(),
                manifest,
                publisherVerification.trust,
            )
            publisherVerification.pin?.let { pin ->
                publisherKeys[pin.first] = pin.second
                persistPublisherKeys()
            }
            val installed = (_state.value.installed.filterNot { it.id == record.id } + record).sortedBy { it.manifest.game.name }
            var movedExistingToBackup = false
            try {
                if (directory.exists()) {
                    require(directory.renameTo(backup)) { "Could not prepare the installed package for replacement" }
                    movedExistingToBackup = true
                }
                require(staging.renameTo(directory)) { "Could not activate the staged game package" }
                persist(installed)
                _state.value = _state.value.copy(
                    installed = installed,
                    isInstalling = false,
                    availableUpdates = _state.value.availableUpdates - record.id,
                    error = null,
                )
                if (movedExistingToBackup) backup.deleteRecursively()
            } catch (error: Throwable) {
                staging.deleteRecursively()
                if (directory.exists()) directory.deleteRecursively()
                if (movedExistingToBackup) backup.renameTo(directory)
                throw error
            }
        }.onFailure { error -> _state.value = _state.value.copy(isInstalling = false, error = error.message ?: "The game package could not be installed") }
    }

    suspend fun cards(gameId: String): List<CommunityCatalogCard> = withContext(Dispatchers.IO) {
        val catalog = json.decodeFromString<CommunityCatalog>(File(File(root, gameId), "catalog.json").readText())
        val setNames = catalog.sets.associate { it.code to it.name }
        catalog.cards.map { card -> if (card.setName == null) card.copy(setName = card.setCode?.let(setNames::get)) else card }
    }

    fun remove(gameId: String) {
        File(root, gameId).deleteRecursively()
        val installed = _state.value.installed.filterNot { it.id == gameId }
        persist(installed)
        _state.value = _state.value.copy(
            installed = installed,
            availableUpdates = _state.value.availableUpdates - gameId,
            error = null,
        )
    }

    private fun validate(manifest: GamePackageManifest) {
        require(manifest.schema == "https://tcger.app/schemas/game-package-manifest/v1") { "Unsupported game package schema" }
        require(manifest.catalog.schema == "tcger-catalog-v1") { "Unsupported catalog schema" }
        require(manifest.game.id.matches(Regex("^[a-z0-9][a-z0-9-]{0,63}$"))) { "Invalid game id" }
        require(manifest.catalog.cardCount >= 0 && manifest.catalog.asset.bytes in 1L..536_870_912L && manifest.catalog.asset.sha256.matches(Regex("^[A-Fa-f0-9]{64}$"))) { "Invalid catalog asset" }
        require(manifest.offlinePacks == null || manifest.offlinePacks.schema == "tcger-pack-library-v1") { "Unsupported pack schema" }
        require(manifest.sealedProducts == null || manifest.sealedProducts.schema == "tcger-sealed-catalog-v1") { "Unsupported sealed catalog schema" }
        require(listOfNotNull(manifest.scanner?.web, manifest.scanner?.ios, manifest.scanner?.android).all { it.runtime == "tcger-arcface-v1" }) { "Unsupported scanner runtime" }
        require(manifest.filters.size <= 24) { "Too many filters" }
        require(manifest.filters.map { it.id }.distinct().size == manifest.filters.size) { "Filter ids must be unique" }
        require(manifest.definition == null || manifest.definition.id == manifest.game.id) { "Definition id must match game id" }
        require(manifest.packageId == null || manifest.publisher.id != null) { "Namespaced packages require a stable publisher id" }
        val id = Regex("^[a-z0-9][a-z0-9-]{0,63}$")
        require(manifest.packageId == null || manifest.packageId.matches(id)) { "Invalid package id" }
        require(manifest.publisher.id == null || manifest.publisher.id.matches(id)) { "Invalid publisher id" }
        require((manifest.publisher.signingKey == null) == (manifest.signature == null)) { "Signing keys and signatures must be declared together" }
        require(manifest.publisher.signingKey?.id == manifest.signature?.keyId) { "Signature key id does not match publisher key" }
        require(manifest.update == null || manifest.update.sequence >= 0) { "Invalid package release sequence" }
        manifest.definition?.let { definition ->
            require(!(definition.interfaces?.scanner == true && manifest.scanner == null)) { "Scanner interface requires a scanner capability" }
            require(!(definition.interfaces?.packOpening == true && manifest.offlinePacks == null)) { "Pack opening interface requires a pack capability" }
            require(!(definition.interfaces?.sealedProducts == true && manifest.sealedProducts == null)) { "Sealed products interface requires a sealed catalog capability" }
            val features = definition.interfaces?.features.orEmpty()
            require(features.size <= 32 && features.map { it.id }.distinct().size == features.size) { "Too many features or duplicate feature ids" }
            require(features.all { it.version in 1..1000 && it.id.matches(id) }) { "Invalid game feature capability" }
            require(features.all { feature ->
                feature.id in GameFeatureAdapters.supportedVersions ||
                    manifest.publisher.id?.let { feature.id.startsWith("$it--") } == true
            }) { "Non-standard feature ids must be prefixed with the publisher id and --" }
            val modes = definition.collection.identityModes
            require(modes.isNotEmpty() && modes.size <= 2 && modes.map { it.id }.distinct().size == modes.size) { "Invalid collection identity modes" }
            require(modes.any { it.id == definition.collection.defaultIdentityMode }) { "Default collection identity mode is not declared" }
            require(modes.all { it.id in setOf("consolidated", "collector") && it.key == if (it.id == "consolidated") "baseExternalId" else "printingKey" }) { "Invalid collection identity key" }
            val definitionProperty = Regex("^(name|setCode|setName|collectorNumber|rarity|releasedAt|language|artist|supertype|regulationMark|sanctionedPlayLegal|quantity|dexEntries\\.number|formatLegality\\.(standard|expanded|unlimited)|attributes\\.[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*|copies\\.(condition|language|finishCode|finishLabel|edition|stamp))$")
            validateFilters(definition.collection.facets, definitionProperty, requireOptions = false)
            validateFilters(definition.search.facets, definitionProperty, requireOptions = false)
        }
        val packageProperty = Regex("^(id|name|setCode|collectorNumber|rarity|artist|type|category|releasedAt|attributes\\.[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*)$")
        validateFilters(manifest.filters, packageProperty, requireOptions = true)
    }

    private fun validateFilters(filters: List<GamePackageFilter>, property: Regex, requireOptions: Boolean) {
        require(filters.size <= 24 && filters.map { it.id }.distinct().size == filters.size) { "Too many filters or duplicate filter ids" }
        filters.forEach {
            require(it.id.matches(Regex("^[a-z0-9][a-z0-9-]{0,63}$")) && it.property.matches(property) && it.type in setOf("select", "multiSelect", "numberRange", "boolean", "text") && it.options.size <= 200) { "Unsupported package filter" }
            if (requireOptions && it.type in setOf("select", "multiSelect")) require(it.options.isNotEmpty()) { "Filter options are required" }
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

    private data class PublisherVerification(
        val trust: GamePackageTrust,
        val pin: Pair<String, String>? = null,
    )

    private fun verifyPublisher(
        sourceUri: URI,
        manifestBytes: ByteArray,
        manifest: GamePackageManifest,
    ): PublisherVerification {
        val signingKey = manifest.publisher.signingKey
            ?: return PublisherVerification(GamePackageTrust("unsigned"))
        val signatureMetadata = requireNotNull(manifest.signature)
        val publisherId = requireNotNull(manifest.publisher.id) { "Signed packages require a stable publisher id" }
        require(
            signingKey.algorithm == "ed25519" && signatureMetadata.algorithm == "ed25519" &&
                signingKey.id == signatureMetadata.keyId
        ) { "Invalid package signing metadata" }
        val publicKey = Base64.getDecoder().decode(signingKey.publicKey)
        require(publicKey.size == 32) { "Package signing key must be 32 bytes" }
        val signatureUri = secureUri(sourceUri.resolve(signatureMetadata.url).toString())
        val signature = download(signatureUri, 512)
        require(signature.size == 64) { "Package signature must be 64 bytes" }
        val verifier = Ed25519Signer().apply {
            init(false, Ed25519PublicKeyParameters(publicKey, 0))
            update(manifestBytes, 0, manifestBytes.size)
        }
        require(verifier.verifySignature(signature)) { "Package publisher signature is invalid" }
        val pinId = "$publisherId:${signingKey.id}"
        require(publisherKeys[pinId] in setOf(null, signingKey.publicKey)) {
            "The publisher signing key changed; explicit key rotation is required"
        }
        val fingerprint = MessageDigest.getInstance("SHA-256")
            .digest(publicKey)
            .joinToString("") { "%02x".format(it) }
        return PublisherVerification(
            GamePackageTrust("verified", signingKey.id, fingerprint),
            pinId to signingKey.publicKey,
        )
    }

    private fun loadInstalled(): List<InstalledGamePackage> = runCatching { json.decodeFromString<List<InstalledGamePackage>>(index.readText()) }.getOrDefault(emptyList())
    private fun loadOfficial(): List<GamePackageManifest> = runCatching { json.decodeFromString<List<GamePackageManifest>>(officialIndex.readText()) }.getOrDefault(emptyList())
    private fun loadPublisherKeys(): Map<String, String> = runCatching { json.decodeFromString<Map<String, String>>(publisherKeysIndex.readText()) }.getOrDefault(emptyMap())
    private fun persist(installed: List<InstalledGamePackage>) = atomicWrite(index, json.encodeToString(installed))
    private fun persistPublisherKeys() = atomicWrite(publisherKeysIndex, json.encodeToString(publisherKeys))

    private fun atomicWrite(target: File, contents: String) {
        root.mkdirs()
        val temporary = File(root, ".${target.name}-${UUID.randomUUID()}.tmp")
        temporary.writeText(contents)
        try {
            try {
                Files.move(
                    temporary.toPath(),
                    target.toPath(),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING,
                )
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
        } finally {
            temporary.delete()
        }
    }
}
