package com.ahmadjalil.tcger.data.scanner

import androidx.core.content.FileProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ScannerShareProviderInstrumentedTest {
    @Test
    fun scannerArchiveIsReadableOnlyThroughTheScopedContentUri() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.cacheDir, "shared-scanner-recordings").apply { mkdirs() }
        val archive = File(directory, "provider-test.json").apply { writeText("{\"format\":\"test\"}") }

        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", archive)
        val text = context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }

        assertEquals("content", uri.scheme)
        assertEquals("{\"format\":\"test\"}", text)
        archive.delete()
    }
}
