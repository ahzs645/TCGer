package com.ahmadjalil.tcger.data.scanner

import android.content.Context
import java.io.File
import java.time.Instant
import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class SavedScannerRecording(
    val id: String,
    val capturedAt: String,
    val frameCount: Int,
    val mode: String,
    val pipeline: String,
    val sizeBytes: Long,
)

/** Internal session metadata store. Portable per-session exports resolve retained JPEG references separately. */
class ScannerRecordingSessionStore(context: Context) {
    private val directory = File(context.applicationContext.filesDir, "scanner-recordings")

    init { directory.mkdirs() }

    fun save(bundle: ScannerRecordingBundle, id: String = newId()): SavedScannerRecording {
        require(bundle.frames.isNotEmpty()) { "Cannot save an empty scanner recording" }
        require(validId(id)) { "Invalid scanner recording id" }
        val target = file(id)
        val temporary = File(directory, ".$id.tmp")
        temporary.writeText(ScannerRecordingJson.encode(bundle))
        check(temporary.renameTo(target) || runCatching {
            temporary.copyTo(target, overwrite = true)
            temporary.delete()
        }.isSuccess) { "Could not persist scanner recording" }
        prune()
        return target.describe(bundle)
    }

    fun list(): List<SavedScannerRecording> = directory.listFiles()
        .orEmpty()
        .asSequence()
        .filter { it.isFile && it.extension == "json" && validId(it.nameWithoutExtension) }
        .mapNotNull { stored ->
            runCatching {
                val bundle = ScannerRecordingJson.decode(stored.readText())
                stored.describe(bundle)
            }.getOrNull()
        }
        .sortedByDescending(SavedScannerRecording::capturedAt)
        .toList()

    fun load(id: String): ScannerRecordingBundle {
        require(validId(id)) { "Invalid scanner recording id" }
        return ScannerRecordingJson.decode(file(id).readText())
    }

    fun delete(id: String): Boolean {
        require(validId(id)) { "Invalid scanner recording id" }
        return file(id).delete()
    }

    fun exportAll(): String = exportCodec.encodeToString(list().map { load(it.id) })

    private fun file(id: String) = File(directory, "$id.json")

    private fun File.describe(bundle: ScannerRecordingBundle) = SavedScannerRecording(
        id = nameWithoutExtension,
        capturedAt = bundle.summary.capturedAt,
        frameCount = bundle.frames.size,
        mode = bundle.summary.mode,
        pipeline = bundle.summary.pipeline,
        sizeBytes = length(),
    )

    private fun prune() {
        val files = directory.listFiles().orEmpty().filter { it.extension == "json" }.sortedByDescending(File::lastModified)
        files.drop(MAX_SESSIONS).forEach(File::delete)
    }

    companion object {
        private const val MAX_SESSIONS = 25
        private val exportCodec = Json { encodeDefaults = true; prettyPrint = true }
        private fun newId() = "android-${Instant.now().toEpochMilli()}-${UUID.randomUUID().toString().take(8)}"
        internal fun validId(id: String): Boolean = id.matches(Regex("[A-Za-z0-9_-]{1,96}"))
    }
}
