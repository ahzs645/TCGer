package com.ahmadjalil.tcger.data.scanner

import android.content.Context
import java.io.File
import java.time.Instant
import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class SavedBinderPagePhoto(
    val id: String,
    val binderId: String,
    val pageNumber: Int,
    val fileName: String,
    val capturedAt: String,
)

class BinderPagePhotoStore(context: Context) {
    private val directory = File(context.applicationContext.filesDir, "binder-page-photos").apply { mkdirs() }
    private val manifest = File(directory, "manifest.json")

    @Synchronized
    fun list(binderId: String? = null): List<SavedBinderPagePhoto> = readManifest()
        .filter { binderId == null || it.binderId == binderId }
        .sortedWith(compareBy(SavedBinderPagePhoto::binderId, SavedBinderPagePhoto::pageNumber, SavedBinderPagePhoto::capturedAt))

    @Synchronized
    fun save(
        binderId: String,
        pageNumber: Int,
        jpeg: ByteArray,
        replaceExisting: Boolean,
    ): SavedBinderPagePhoto {
        require(binderId.isNotBlank()) { "Binder is required" }
        require(pageNumber > 0) { "Page number must be at least 1" }
        require(jpeg.isNotEmpty()) { "Binder-page image is empty" }
        val entries = readManifest().toMutableList()
        if (replaceExisting) {
            entries.filter { it.binderId == binderId && it.pageNumber == pageNumber }.forEach {
                File(directory, it.fileName).delete()
            }
            entries.removeAll { it.binderId == binderId && it.pageNumber == pageNumber }
        }
        val id = UUID.randomUUID().toString()
        val fileName = "$id.jpg"
        val destination = File(directory, fileName)
        val temporary = File(directory, "$id.tmp")
        temporary.writeBytes(jpeg)
        check(temporary.renameTo(destination)) { "Could not activate binder-page photo" }
        val saved = SavedBinderPagePhoto(id, binderId, pageNumber, fileName, Instant.now().toString())
        entries += saved
        writeManifest(entries)
        return saved
    }

    @Synchronized
    fun delete(id: String): Boolean {
        val entries = readManifest().toMutableList()
        val match = entries.firstOrNull { it.id == id } ?: return false
        File(directory, match.fileName).delete()
        entries.removeAll { it.id == id }
        writeManifest(entries)
        return true
    }

    fun file(photo: SavedBinderPagePhoto): File = File(directory, photo.fileName)

    private fun readManifest(): List<SavedBinderPagePhoto> = if (!manifest.exists()) emptyList() else runCatching {
        codec.decodeFromString<List<SavedBinderPagePhoto>>(manifest.readText())
    }.getOrDefault(emptyList())

    private fun writeManifest(entries: List<SavedBinderPagePhoto>) {
        val temporary = File(directory, "manifest.tmp")
        temporary.writeText(codec.encodeToString(entries.takeLast(MAX_PHOTOS)))
        if (manifest.exists()) manifest.delete()
        check(temporary.renameTo(manifest)) { "Could not update binder-page manifest" }
    }

    companion object {
        private const val MAX_PHOTOS = 500
        private val codec = Json { ignoreUnknownKeys = true; encodeDefaults = true; prettyPrint = true }
    }
}
