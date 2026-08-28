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

    private fun resource(path: String): ByteArray = requireNotNull(
        javaClass.classLoader?.getResourceAsStream(path),
    ) { "Missing test fixture $path" }.use { it.readBytes() }

    private fun sha256(bytes: ByteArray): String = MessageDigest
        .getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { "%02x".format(it) }
}
