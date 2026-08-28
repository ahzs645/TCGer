package com.ahmadjalil.tcger.ui.packopening

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PackOpeningWebHostPolicyTest {
    @Test
    fun `cached manifest is served immediately and refreshed in background`() {
        assertEquals(
            PackRemoteAssetCachePolicy(
                serveImmediately = true,
                refreshInBackground = true,
            ),
            packRemoteAssetCachePolicy(
                hasCachedBytes = true,
                isRefreshableManifest = true,
            ),
        )
    }

    @Test
    fun `missing manifest still uses bounded foreground fetch`() {
        assertEquals(
            PackRemoteAssetCachePolicy(
                serveImmediately = false,
                refreshInBackground = false,
            ),
            packRemoteAssetCachePolicy(
                hasCachedBytes = false,
                isRefreshableManifest = true,
            ),
        )
    }

    @Test
    fun `downloaded sets remain enabled while other sets are unavailable offline`() {
        val downloaded = PackOfflineSetStatus.Downloaded(
            PackOfflineDownloadRecord(
                setID = "base1",
                setName = "Base Set",
                downloadedAtEpochMillis = 1_700_000_000_000,
                cardCount = 102,
                byteCount = 1_024,
                removableURLs = emptyList(),
            ),
        )
        val statuses = mapOf("base1" to downloaded)

        assertTrue(canOpenPackSet("base1", remoteAssetsUsable = false, statuses = statuses))
        assertFalse(canOpenPackSet("me5", remoteAssetsUsable = false, statuses = statuses))
        assertTrue(canOpenPackSet("me5", remoteAssetsUsable = true, statuses = statuses))
    }
}
