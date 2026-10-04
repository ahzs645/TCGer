package com.ahmadjalil.tcger.data.backup

import kotlinx.serialization.json.*

/** Incoming stable IDs win; unrelated records survive. Recovery uses replacement. */
object PortableBackupMerge {
    private fun rows(before: JsonArray, after: JsonArray): JsonArray = JsonArray(
        (before + after).associateBy { it.jsonObject.getValue("id").jsonPrimitive.content }.values.toList(),
    )
    fun merge(before: JsonObject, incoming: JsonObject): JsonObject {
        val result = (before + incoming).toMutableMap()
        for (key in listOf("binders", "wishlists")) {
            val next = incoming[key]?.jsonArray ?: JsonArray(emptyList())
            val moved = next.flatMap { it.jsonObject["cards"]?.jsonArray.orEmpty() }.map { it.jsonObject["id"] }.toSet()
            val records = before[key]?.jsonArray.orEmpty().associateBy { it.jsonObject.getValue("id").jsonPrimitive.content }.toMutableMap()
            records.replaceAll { _, value -> JsonObject(value.jsonObject + ("cards" to JsonArray(value.jsonObject["cards"]?.jsonArray.orEmpty().filter { it.jsonObject["id"] !in moved }))) }
            for (item in next) {
                val parent = item.jsonObject
                val id = parent.getValue("id").jsonPrimitive.content
                val old = records[id]?.jsonObject ?: JsonObject(emptyMap())
                records[id] = JsonObject(old + parent + ("cards" to rows(old["cards"]?.jsonArray ?: JsonArray(emptyList()), parent["cards"]?.jsonArray ?: JsonArray(emptyList()))))
            }
            result[key] = JsonArray(records.values.toList())
        }
        result["sealedInventory"] = rows(before["sealedInventory"]?.jsonArray ?: JsonArray(emptyList()), incoming["sealedInventory"]?.jsonArray ?: JsonArray(emptyList()))
        val sections = before["sections"]?.jsonObject.orEmpty().toMutableMap()
        for ((key, value) in incoming["sections"]?.jsonObject.orEmpty()) {
            sections[key] = when {
                key in listOf("transactions", "onlineCodes", "smartFolders", "binderPages") && value is JsonArray -> rows(sections[key] as? JsonArray ?: JsonArray(emptyList()), value)
                key in listOf("binderPageImages", "copyImages", "preferences") && value is JsonObject -> JsonObject((sections[key] as? JsonObject).orEmpty() + value)
                else -> value
            }
        }
        result["sections"] = JsonObject(sections)
        return JsonObject(result)
    }
}
