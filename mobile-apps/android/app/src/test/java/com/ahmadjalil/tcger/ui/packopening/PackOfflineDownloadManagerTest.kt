package com.ahmadjalil.tcger.ui.packopening

import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PackOfflineDownloadManagerTest {
    @get:Rule val temporaryFolder = TemporaryFolder()

    @Test
    fun `download persists manifest mesh wrappers and card art then removes only set assets`() = runTest {
        val root = temporaryFolder.newFolder("offline-pack")
        val store = PackAssetStore(File(root, "assets"))
        val dispatcher = StandardTestDispatcher(testScheduler)
        val scope = CoroutineScope(SupervisorJob() + dispatcher)
        val responses = fixtureResponses()
        val manager = PackOfflineDownloadManager(
            recordsDirectory = File(root, "records"),
            assetStore = store,
            remoteAssetBaseURL = ASSET_BASE,
            fetcher = PackAssetFetcher { url -> responses[url] ?: error("missing $url") },
            scope = scope,
        )

        manager.download(request)
        testScheduler.advanceUntilIdle()

        val status = manager.status("base1") as PackOfflineSetStatus.Downloaded
        assertEquals(1, status.record.cardCount)
        assertTrue(status.record.byteCount > 0)
        assertNotNull(manager.cachedAssetFile(CARD_HIGH))
        assertNotNull(manager.cachedAssetFile("$ASSET_BASE/pack/objects/wrapper.png"))
        assertNotNull(manager.cachedAssetFile("$ASSET_BASE/pack/objects/mesh.obj"))

        manager.remove("base1")

        assertEquals(PackOfflineSetStatus.NotDownloaded, manager.status("base1"))
        assertEquals(null, manager.cachedAssetFile(CARD_HIGH))
        assertEquals(null, manager.cachedAssetFile("$ASSET_BASE/pack/objects/wrapper.png"))
        assertNotNull(manager.cachedAssetFile("$ASSET_BASE/pack/objects/mesh.obj"))
        scope.cancel()
    }

    @Test
    fun `failed download exposes retry state and succeeds when source recovers`() = runTest {
        val root = temporaryFolder.newFolder("retry-pack")
        val dispatcher = StandardTestDispatcher(testScheduler)
        val scope = CoroutineScope(SupervisorJob() + dispatcher)
        var available = false
        val responses = fixtureResponses()
        val manager = PackOfflineDownloadManager(
            recordsDirectory = File(root, "records"),
            assetStore = PackAssetStore(File(root, "assets")),
            remoteAssetBaseURL = ASSET_BASE,
            fetcher = PackAssetFetcher { url ->
                if (!available) error("offline")
                responses[url] ?: error("missing $url")
            },
            scope = scope,
        )

        manager.download(request)
        testScheduler.advanceUntilIdle()
        assertTrue(manager.status("base1") is PackOfflineSetStatus.Failed)

        available = true
        manager.retry(request)
        testScheduler.advanceUntilIdle()
        assertTrue(manager.status("base1") is PackOfflineSetStatus.Downloaded)
        scope.cancel()
    }

    @Test
    fun `asset URL resolver only accepts HTTPS and safe relative paths`() {
        assertEquals("$ASSET_BASE/pack/manifest.json", resolveAssetURL("/pack/manifest.json", ASSET_BASE))
        assertEquals("https://cdn.example/card.webp", resolveAssetURL("https://cdn.example/card.webp", ASSET_BASE))
        assertTrue(runCatching { resolveAssetURL("http://bad.example/file", ASSET_BASE) }.isFailure)
        assertTrue(runCatching { resolveAssetURL("../secret", ASSET_BASE) }.isFailure)
        assertFalse(assetKey("one") == assetKey("two"))
    }

    private fun fixtureResponses(): Map<String, ByteArray> = mapOf(
        "$ASSET_BASE/pack/manifest.json" to """{
          "mesh":"/pack/objects/mesh.obj",
          "covers":{"base":{"packPool":"base1","plain":"/pack/objects/wrapper.png","decaled":"/pack/objects/wrapper.png"}}
        }""".trimIndent().encodeToByteArray(),
        "$ASSET_BASE/pack/objects/mesh.obj" to "mesh".encodeToByteArray(),
        "$ASSET_BASE/pack/objects/wrapper.png" to "wrapper".encodeToByteArray(),
        CARD_HIGH to "high-art".encodeToByteArray(),
        CARD_LOW to "low-art".encodeToByteArray(),
    )

    private companion object {
        const val ASSET_BASE = "https://assets.example"
        const val CARD_HIGH = "https://cards.example/base1/4/high.webp"
        const val CARD_LOW = "https://cards.example/base1/4/low.webp"
        val request = PackOfflineSetRequest(
            setID = "base1",
            setName = "Base Set",
            packPoolID = "base1",
            cardAssetURLs = listOf(CARD_HIGH, CARD_LOW),
        )
    }
}
