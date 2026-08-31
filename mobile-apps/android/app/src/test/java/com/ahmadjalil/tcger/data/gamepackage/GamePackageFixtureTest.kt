package com.ahmadjalil.tcger.data.gamepackage

import java.security.MessageDigest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GamePackageFixtureTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `Codex Critters decodes and verifies as an unknown game package`() {
        val manifestBytes = resource("codex-critters/codex-critters.game-package.json")
        val manifest = json.decodeFromString<GamePackageManifest>(manifestBytes.decodeToString())
        val catalogBytes = resource("codex-critters/${manifest.catalog.asset.url.removePrefix("./")}")
        val catalog = json.parseToJsonElement(catalogBytes.decodeToString()).jsonObject

        assertEquals("codex-critters", manifest.game.id)
        assertEquals("codex-critters-library", manifest.packageId)
        assertEquals("tcger-fixtures", manifest.publisher.id)
        assertEquals("tcger-fixtures--codex-critters-library", manifest.installedId)
        assertEquals(manifest.game.id, manifest.effectiveDefinition.id)
        assertEquals(true, manifest.effectiveDefinition.interfaces?.search)
        assertEquals(false, manifest.effectiveDefinition.interfaces?.scanner)
        assertEquals(true, manifest.effectiveDefinition.interfaces?.supportsFeature("tcger-fixtures--critter-index"))
        assertEquals("collector", manifest.effectiveDefinition.collection.defaultIdentityMode)
        assertEquals(5, manifest.effectiveDefinition.search.facets.size)
        assertNull(manifest.scanner)
        assertNull(manifest.offlinePacks)
        assertEquals(manifest.catalog.asset.bytes, catalogBytes.size.toLong())
        assertEquals(manifest.catalog.asset.sha256, sha256(catalogBytes))
        assertEquals(manifest.game.id, catalog.getValue("tcg").jsonPrimitive.content)
        assertEquals(manifest.catalog.cardCount, catalog.getValue("cards").jsonArray.size)
        assertEquals(manifest.catalog.setCount, catalog.getValue("sets").jsonArray.size)
        assertEquals(
            setOf("select", "multiSelect", "numberRange", "boolean", "text"),
            manifest.filters.map { it.type }.toSet(),
        )
    }

    @Test
    fun `duplicate package and renamed catalog copies are gated but updates are allowed`() {
        val text = resource("codex-critters/codex-critters.game-package.json").decodeToString()
        val installed = json.decodeFromString<GamePackageManifest>(text)
        assertEquals(GamePackageDuplicateKind.SAME_PACKAGE, duplicateGamePackage(listOf(installed), installed))

        val included = json.decodeFromString<GamePackageManifest>(
            text.replace("codex-critters-library", "pokemon-catalog")
                .replace("codex-critters", "pokemon")
                .replace("tcger-fixtures", "tcger")
                .replace("\"definition\": {", "\"unusedDefinition\": {")
        )
        assertEquals(GamePackageDuplicateKind.INCLUDED, duplicateGamePackage(emptyList(), included))

        val renamed = json.decodeFromString<GamePackageManifest>(
            text.replace("codex-critters-library", "renamed-critters-library")
                .replace("tcger-fixtures", "another-publisher"),
        )
        assertEquals(GamePackageDuplicateKind.SAME_CATALOG, duplicateGamePackage(listOf(installed), renamed))

        val update = json.decodeFromString<GamePackageManifest>(
            text.replace("fixture-1", "fixture-2")
                .replace(installed.catalog.asset.sha256, "a".repeat(64)),
        )
        assertEquals(null, duplicateGamePackage(listOf(installed), update))
    }

    @Test
    fun `package updates are monotonic and release conflicts are rejected`() {
        val text = resource("codex-critters/codex-critters.game-package.json").decodeToString()
        val current = json.decodeFromString<GamePackageManifest>(text)
        val next = json.decodeFromString<GamePackageManifest>(
            text.replace("fixture-1", "fixture-2")
                .replace("2026-08-27T00:00:00Z", "2026-08-29T00:00:00Z")
                .replace("\"sequence\": 1", "\"sequence\": 2"),
        )
        val conflict = json.decodeFromString<GamePackageManifest>(
            text.replace("fixture-1", "fixture-conflict"),
        )

        assertEquals(GamePackageReleaseRelation.UPDATE, gamePackageReleaseRelation(current, next))
        assertEquals(GamePackageReleaseRelation.DOWNGRADE, gamePackageReleaseRelation(next, current))
        assertEquals(GamePackageReleaseRelation.SAME, gamePackageReleaseRelation(current, current))
        assertEquals(GamePackageReleaseRelation.CONFLICT, gamePackageReleaseRelation(current, conflict))
    }

    @Test
    fun `the app asks for a game only when no source is active`() {
        assertEquals(true, needsGameInstallation(emptySet(), 0))
        assertEquals(false, needsGameInstallation(setOf("pokemon"), 0))
        assertEquals(false, needsGameInstallation(emptySet(), 1))
    }

    private fun resource(path: String): ByteArray = requireNotNull(
        javaClass.classLoader?.getResourceAsStream(path),
    ) { "Missing test fixture $path" }.use { it.readBytes() }

    private fun sha256(bytes: ByteArray): String = MessageDigest
        .getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { "%02x".format(it) }
}
