package com.ahmadjalil.tcger.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.test.core.app.ApplicationProvider
import com.ahmadjalil.tcger.data.backup.CollectionBackupJson
import com.ahmadjalil.tcger.domain.Binder
import com.ahmadjalil.tcger.ui.screens.BackupTransferViewModel
import java.io.File
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class BackupTransferTest {
    private val app: Application = ApplicationProvider.getApplicationContext()
    private val payload = CollectionBackupJson.encode(CollectionBackupJson.create(
        listOf(Binder("review-fixture", "Transfer test")), emptyList(), emptyList(),
    ))
    private suspend fun model(state: SavedStateHandle = SavedStateHandle()) = withContext(Dispatchers.Main) {
        BackupTransferViewModel(app, state)
    }
    private suspend fun recreated(state: SavedStateHandle): BackupTransferViewModel = model(
        withContext(Dispatchers.Main) { SavedStateHandle(state.keys().associateWith { state.get<Any?>(it) }) },
    )

    @Test fun preparedExportSurvivesViewModelRecreationAndWritesTheFullFile() = runBlocking {
        val state = SavedStateHandle()
        val original = model(state)
        withContext(Dispatchers.Main) { original.prepareExport({ payload }) {} }.join()
        val restored = recreated(state)
        val output = File.createTempFile("tcger-export-test", ".json", app.cacheDir)
        try {
            withContext(Dispatchers.Main) { restored.write(Uri.fromFile(output)) }.join()
            assertEquals(payload, output.readText())
            assertEquals("Export saved.", restored.notice)
        } finally { output.delete() }
    }

    @Test fun importIsReviewedAfterRecreationAndRejectsADifferentDestination() = runBlocking {
        val state = SavedStateHandle()
        val original = model(state)
        val input = File.createTempFile("tcger-import-test", ".json", app.cacheDir).apply { writeText(payload) }
        try {
            withContext(Dispatchers.Main) { original.read(Uri.fromFile(input), "this device") }.join()
            assertTrue(original.review.orEmpty().contains("1 binders"))
            val restored = recreated(state)
            withTimeout(5_000) { while (restored.review == null) delay(10) }
            var imports = 0
            withContext(Dispatchers.Main) { restored.apply("another server", { imports++ }, {}) }.join()
            assertEquals(0, imports)
            assertTrue(restored.notice.orEmpty().contains("destination changed"))
            withContext(Dispatchers.Main) { restored.cancelImport() }
            assertNull(restored.review)
            assertEquals(0, imports)
        } finally { input.delete() }
    }

    @Test fun reviewedImportAppliesOnlyWhenExplicitlyConfirmed() = runBlocking {
        val transfer = model()
        val input = File.createTempFile("tcger-import-test", ".json", app.cacheDir).apply { writeText(payload) }
        try {
            var imported: String? = null
            withContext(Dispatchers.Main) { transfer.read(Uri.fromFile(input), "this device") }.join()
            assertNull(imported)
            withContext(Dispatchers.Main) { transfer.apply("this device", { imported = it }, {}) }.join()
            assertEquals(payload, imported)
            assertNull(transfer.review)
        } finally { input.delete() }
    }
}
