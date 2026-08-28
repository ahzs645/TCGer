package com.ahmadjalil.tcger.data.scanner.model

import com.ahmadjalil.tcger.domain.CardScanEncoderVariant
import com.ahmadjalil.tcger.domain.CardScanEngine
import com.ahmadjalil.tcger.domain.CardScanOptions
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ScannerAssetStoreTest {
    @get:Rule val temporaryFolder = TemporaryFolder()

    @Test
    fun `complete pack becomes current only after digest and index validation`() = runTest {
        val fixture = fixture("release-1")
        val store = store(fixture.responses)

        store.install("yu-gi-oh!")

        val installed = store.status("yugioh") as ScannerAssetInstallStatus.Installed
        assertEquals("release-1", installed.manifest.version)
        val runtime = requireNotNull(store.installedRuntime("yugioh"))
        assertNotNull(runtime)
        assertEquals(2, runtime.contract.expectedCardCount)
        assertEquals(3, runtime.contract.embeddingDimension)
        assertEquals(fixture.model.toList(), runtime.source.open(runtime.contract.model.path).use { it.readBytes() }.toList())
    }

    @Test
    fun `failed update keeps previously activated version available`() = runTest {
        val first = fixture("release-1")
        val responses = first.responses.toMutableMap()
        val store = store(responses)
        store.install("yugioh")

        val broken = fixture("release-2", modelDigest = "0".repeat(64))
        responses.putAll(broken.responses)
        store.install("yugioh")

        val failed = store.status("yugioh") as ScannerAssetInstallStatus.Failed
        assertEquals("release-1", failed.installedManifest?.version)
        assertEquals("release-1", store.installedRuntime("yugioh")?.contract?.version)
    }

    @Test
    fun `remove clears current runtime`() = runTest {
        val fixture = fixture("release-1")
        val store = store(fixture.responses)
        store.install("yugioh")

        store.remove("yugioh")

        assertEquals(ScannerAssetInstallStatus.NotInstalled, store.status("yugioh"))
        assertNull(store.installedRuntime("yugioh"))
    }

    @Test
    fun `manifest refresh advertises first install and later update without downloading assets`() = runTest {
        val first = fixture("release-1")
        val responses = first.responses.toMutableMap()
        val store = store(responses)

        val advertised = store.refreshManifest("yu-gi-oh!")

        assertEquals("release-1", advertised.version)
        assertEquals("release-1", store.remoteManifests.value["yugioh"]?.version)
        assertEquals(ScannerAssetInstallStatus.NotInstalled, store.status("yugioh"))
        assertTrue(!store.isUpdateAvailable("yugioh"))

        store.install("yugioh")
        val second = fixture("release-2")
        responses.putAll(second.responses)
        store.refreshManifest("yugioh")

        assertTrue(store.isUpdateAvailable("yugioh"))
        assertEquals("release-1", store.installedRuntime("yugioh")?.contract?.version)
    }

    @Test
    fun `local dispatch enables ArcFace for each published game`() {
        val arcFace = CardScanOptions(
            engine = CardScanEngine.AUTOMATIC,
            encoderVariant = CardScanEncoderVariant.ARCFACE,
        )
        assertEquals(LocalEmbeddingModel.ARCFACE, LocalEmbeddingDispatch.select("pokemon", arcFace))
        assertEquals(LocalEmbeddingModel.ARCFACE, LocalEmbeddingDispatch.select("mtg", arcFace))
        assertEquals(LocalEmbeddingModel.ARCFACE, LocalEmbeddingDispatch.select("yu-gi-oh!", arcFace))

        val dino = arcFace.copy(encoderVariant = CardScanEncoderVariant.DINOV2)
        assertEquals(LocalEmbeddingModel.DINOV2, LocalEmbeddingDispatch.select("pokemon", dino))
        assertNull(LocalEmbeddingDispatch.select("magic", dino))
        assertNull(LocalEmbeddingDispatch.select("yugioh", dino))
    }

    @Test
    fun `published numeric versions and shared object paths are accepted`() {
        val decoded = Json.decodeFromString<ScannerAssetManifest>(
            """{
              "formatVersion":1,"game":"yugioh","version":1,"encoder":"arcface","modelName":"fastvit_t8",
              "cardCount":2,"dimension":3,"downloadBytes":3,"strongAcceptanceScore":0.6,"ambiguityMargin":0.05,
              "model":{"file":"objects/model.onnx","bytes":1,"sha256":"${"a".repeat(64)}"},
              "vectors":{"file":"objects/vectors.bin","bytes":1,"sha256":"${"b".repeat(64)}"},
              "metadata":{"file":"objects/metadata.json","bytes":1,"sha256":"${"c".repeat(64)}"}
            }""",
        )

        assertEquals("1", decoded.version)
        assertEquals(
            "$BASE/objects/model.onnx",
            resolveManifestAssetURL("$BASE/yugioh/manifest.json", decoded.model.file),
        )
    }

    private fun store(responses: MutableMap<String, ByteArray> = mutableMapOf()) = ScannerAssetStore(
        root = temporaryFolder.newFolder("scanner-assets-${System.nanoTime()}"),
        remoteBaseURL = BASE,
        fetcher = ScannerAssetFetcher { url, destination, progress ->
            val bytes = responses[url] ?: error("missing response for $url")
            destination.parentFile?.mkdirs()
            destination.writeBytes(bytes)
            progress(bytes.size.toLong())
        },
    )

    private fun fixture(version: String, modelDigest: String? = null): Fixture {
        val model = "fake-onnx-$version".encodeToByteArray()
        val vectors = packed(
            listOf(
                byteArrayOf(127, 0, 0),
                byteArrayOf(0, 127, 0),
            ),
        )
        val metadata = """[
          {"annIndex":0,"cardId":"ygo-1","name":"First","game":"yugioh"},
          {"annIndex":1,"cardId":"ygo-2","name":"Second","game":"yugioh"}
        ]""".trimIndent().encodeToByteArray()
        val manifest = ScannerAssetManifest(
            formatVersion = 1,
            game = "yugioh",
            version = version,
            encoder = "arcface",
            modelName = "fastvit_t8",
            cardCount = 2,
            dimension = 3,
            downloadBytes = model.size.toLong() + vectors.size + metadata.size,
            model = ScannerAssetManifestFile("objects/model.onnx", model.size.toLong(), modelDigest ?: sha256(model)),
            vectors = ScannerAssetManifestFile("objects/vectors.bin", vectors.size.toLong(), sha256(vectors)),
            metadata = ScannerAssetManifestFile("objects/metadata.json", metadata.size.toLong(), sha256(metadata)),
            strongAcceptanceScore = 0.6,
            ambiguityMargin = 0.05,
        )
        val responses = mutableMapOf(
            "$BASE/yugioh/manifest.json" to Json.encodeToString(manifest).encodeToByteArray(),
            "$BASE/objects/model.onnx" to model,
            "$BASE/objects/vectors.bin" to vectors,
            "$BASE/objects/metadata.json" to metadata,
        )
        return Fixture(model, responses)
    }

    private fun packed(rows: List<ByteArray>): ByteArray {
        val buffer = ByteBuffer.allocate(8 + rows.size * rows.first().size).order(ByteOrder.LITTLE_ENDIAN)
        buffer.putInt(rows.size)
        buffer.putInt(rows.first().size)
        rows.forEach(buffer::put)
        return buffer.array()
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private data class Fixture(
        val model: ByteArray,
        val responses: MutableMap<String, ByteArray>,
    )

    private companion object {
        const val BASE = "https://assets.example/android/scan-assets"
    }
}
