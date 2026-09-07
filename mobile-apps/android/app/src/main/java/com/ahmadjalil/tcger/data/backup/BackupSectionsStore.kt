package com.ahmadjalil.tcger.data.backup

import android.content.Context
import com.ahmadjalil.tcger.data.scanner.SavedBinderPagePhoto
import com.ahmadjalil.tcger.feature.onlinecodes.OnlineCode
import com.ahmadjalil.tcger.feature.settingsparity.FinanceTransaction
import com.ahmadjalil.tcger.domain.SmartFolder
import java.io.File
import java.util.Base64
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*

/** User documents only. Tokens, credentials, downloaded catalogs and caches never enter a backup. */
class BackupSectionsStore(private val context: Context) {
    private val codec = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }
    private val retained = File(context.filesDir, "portable-backup-sections.json")
    private val photoDirectory = File(context.filesDir, "binder-page-photos")
    private val stores = mapOf("transactions" to ("finance_transactions" to "items"), "onlineCodes" to ("online_code_vault" to "codes"), "smartFolders" to ("smart_folders" to "local"))
    fun snapshot(): JsonObject = buildJsonObject {
        if (retained.exists()) codec.parseToJsonElement(retained.readText()).jsonObject.forEach { (key, value) -> put(key, value) }
        stores.forEach { (section, location) -> put(section, codec.parseToJsonElement(context.getSharedPreferences(location.first, Context.MODE_PRIVATE).getString(location.second, "[]")!!)) }
        val manifest = File(photoDirectory, "manifest.json")
        if (manifest.exists()) {
            val photos = codec.decodeFromString<List<SavedBinderPagePhoto>>(manifest.readText())
            val old = if (retained.exists()) codec.parseToJsonElement(retained.readText()).jsonObject else JsonObject(emptyMap())
            val oldPages = old["binderPages"]?.jsonArray.orEmpty()
            put("binderPages", JsonArray((oldPages + photos.map { photo ->
                val existing = oldPages.firstOrNull { it.jsonObject["id"]?.jsonPrimitive?.content == photo.id }?.jsonObject.orEmpty()
                buildJsonObject {
                    existing.forEach { (key, value) -> put(key, value) }
                    put("id", photo.id); put("binderId", photo.binderId); put("pageNumber", photo.pageNumber); put("revision", 1)
                    put("capturedAt", photo.capturedAt); put("createdAt", photo.capturedAt); put("updatedAt", photo.capturedAt)
                    if (!existing.containsKey("placements")) put("placements", JsonArray(emptyList()))
                }
            }).associateBy { it.jsonObject.getValue("id") }.values.toList()))
            put("binderPageImages", buildJsonObject {
                old["binderPageImages"]?.jsonObject?.forEach { (key, value) -> put(key, value) }
                photos.forEach { photo -> put(photo.id, Base64.getEncoder().encodeToString(safePhoto(photo.fileName).readBytes())) }
            })
        }
        put("androidBinderPagePhotos", if (manifest.exists()) codec.parseToJsonElement(manifest.readText()) else JsonArray(emptyList()))
        put("androidBinderPageImages", buildJsonObject {
            if (manifest.exists()) codec.decodeFromString<List<SavedBinderPagePhoto>>(manifest.readText()).forEach { photo ->
                val file = safePhoto(photo.fileName)
                require(file.exists()) { "Binder-page photo ${photo.pageNumber} is missing; export stopped to avoid an incomplete backup" }
                put(photo.fileName, Base64.getEncoder().encodeToString(file.readBytes()))
            }
        })
    }
    fun validate(input: JsonObject) {
        val sections = photoSections(input)
        sections["transactions"]?.let { codec.decodeFromJsonElement<List<FinanceTransaction>>(it) }
        sections["onlineCodes"]?.let { codec.decodeFromJsonElement<List<OnlineCode>>(it) }
        sections["smartFolders"]?.let { codec.decodeFromJsonElement<List<SmartFolder>>(it) }
        sections["androidBinderPagePhotos"]?.let { codec.decodeFromJsonElement<List<SavedBinderPagePhoto>>(it).forEach { photo -> safePhoto(photo.fileName); require(sections["androidBinderPageImages"]?.jsonObject?.containsKey(photo.fileName) == true) { "A binder-page photo is missing from the backup" } } }
        sections["androidBinderPageImages"]?.jsonObject?.forEach { (name, data) -> safePhoto(name); require(Base64.getDecoder().decode(data.jsonPrimitive.content).isNotEmpty()) }
    }
    fun apply(input: JsonObject, merge: Boolean = true) {
        val sections = photoSections(input)
        validate(sections)
        val previous = snapshot()
        val combined = if (merge) JsonObject(previous + sections) else sections
        stores.forEach { (section, location) ->
            val incoming = sections[section] ?: return@forEach
            val rows = if (merge) JsonArray((previous[section]?.jsonArray.orEmpty() + incoming.jsonArray).associateBy { it.jsonObject["id"]?.jsonPrimitive?.content ?: it.toString() }.values.toList()) else incoming
            check(context.getSharedPreferences(location.first, Context.MODE_PRIVATE).edit().putString(location.second, rows.toString()).commit()) { "Could not save $section" }
        }
        photoDirectory.mkdirs()
        sections["androidBinderPageImages"]?.jsonObject?.forEach { (name, data) -> atomicWrite(safePhoto(name), Base64.getDecoder().decode(data.jsonPrimitive.content)) }
        sections["androidBinderPagePhotos"]?.let { incoming ->
            val photos = if (merge) JsonArray((previous["androidBinderPagePhotos"]?.jsonArray.orEmpty() + incoming.jsonArray).associateBy { it.jsonObject.getValue("id").jsonPrimitive.content }.values.toList()) else incoming
            atomicWrite(File(photoDirectory, "manifest.json"), photos.toString().toByteArray())
        }
        atomicWrite(retained, combined.toString().toByteArray())
    }
    private fun photoSections(sections: JsonObject): JsonObject {
        val pages = sections["binderPages"]?.jsonArray ?: return sections
        val images = sections["binderPageImages"]?.jsonObject ?: return sections
        val photos = sections["androidBinderPagePhotos"]?.jsonArray.orEmpty().toMutableList()
        val files = sections["androidBinderPageImages"]?.jsonObject.orEmpty().toMutableMap()
        pages.forEach { item ->
            val page = item.jsonObject
            val id = page["id"]?.jsonPrimitive?.content ?: return@forEach
            val data = images[id] ?: return@forEach
            val fileName = java.util.UUID.nameUUIDFromBytes(id.toByteArray()).toString() + ".jpg"
            val photo = SavedBinderPagePhoto(id, page.getValue("binderId").jsonPrimitive.content, page.getValue("pageNumber").jsonPrimitive.int, fileName, page["capturedAt"]?.jsonPrimitive?.content ?: java.time.Instant.now().toString())
            photos += codec.encodeToJsonElement(photo); files[fileName] = data
        }
        return JsonObject(sections + mapOf("androidBinderPagePhotos" to JsonArray(photos.distinctBy { it.jsonObject.getValue("id") }), "androidBinderPageImages" to JsonObject(files)))
    }

    private fun safePhoto(name: String): File {
        require(name.matches(Regex("[A-Za-z0-9-]+\\.jpg"))) { "Invalid binder-page photo filename" }
        return File(photoDirectory, name)
    }
    private fun atomicWrite(file: File, bytes: ByteArray) {
        val temporary = File(file.path + ".tmp"); temporary.writeBytes(bytes)
        check(temporary.renameTo(file)) { "Could not save ${file.name}" }
    }
}
