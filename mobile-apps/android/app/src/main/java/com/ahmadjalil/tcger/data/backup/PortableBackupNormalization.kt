package com.ahmadjalil.tcger.data.backup

import kotlinx.serialization.json.*

/** Legacy readers are explicit: a future version is never guessed at or partially imported. */
fun normalizeBackupDocument(raw: JsonObject): JsonObject {
    if (raw["format"]?.jsonPrimitive?.content == "com.tcger.local-data-backup") {
        require(raw["schemaVersion"]?.jsonPrimitive?.int == 1) { "Unsupported iOS backup version" }
        val payload = raw.getValue("payload").jsonObject
        fun nativeCard(card: JsonObject) = JsonObject(card + ("id" to (card["externalId"]?.takeUnless { it is JsonNull } ?: card["cardId"] ?: card.getValue("id"))))
        val binders = payload.getValue("collections").jsonArray.map { element ->
            val binder = element.jsonObject
            JsonObject(binder + mapOf("colorHex" to (binder["colorHex"]?.takeUnless { it is JsonNull } ?: JsonPrimitive("315DA8")), "cards" to JsonArray(binder.getValue("cards").jsonArray.flatMap { group ->
                val card = group.jsonObject
                val copies = card["copies"]?.jsonArray?.takeIf { it.isNotEmpty() } ?: JsonArray(List(card["quantity"]?.jsonPrimitive?.int ?: 1) { i -> JsonObject(card + ("id" to JsonPrimitive("${card["id"]?.jsonPrimitive?.content}:$i"))) })
                copies.map { copyElement ->
                    val copy = copyElement.jsonObject
                    buildJsonObject {
                        put("id", copy.getValue("id")); put("card", nativeCard(card)); put("quantity", 1)
                        listOf("condition", "price", "acquisitionPrice").forEach { key -> copy[key]?.let { put(key, it) } }
                        put("details", JsonObject(copy.filterValues { it !is JsonNull }))
                    }
                }
            })))
        }
        val wishlists = payload["wishlists"]?.jsonArray.orEmpty().map { element ->
            val list = element.jsonObject
            JsonObject(list + mapOf("colorHex" to (list["colorHex"]?.takeUnless { it is JsonNull } ?: JsonPrimitive("315DA8")), "matchAnyPrinting" to (list["matchAnyPrinting"]?.takeUnless { it is JsonNull } ?: JsonPrimitive(false)), "rules" to (list["rules"]?.takeUnless { it is JsonNull } ?: JsonArray(emptyList())), "cards" to JsonArray(list.getValue("cards").jsonArray.map { element ->
                val card = element.jsonObject
                buildJsonObject { put("id", card.getValue("id")); put("card", nativeCard(card)); put("desiredQuantity", card["desiredQuantity"] ?: JsonPrimitive(1)); card["notes"]?.let { put("notes", it) } }
            })))
        }
        val sealed = payload["sealedInventory"]?.jsonArray.orEmpty().map { element ->
            val item = element.jsonObject; val product = item.getValue("product").jsonObject
            JsonObject(item + mapOf("productId" to product.getValue("id"), "productName" to product.getValue("name")))
        }
        return buildJsonObject {
            put("format", "com.tcger.portable-backup"); put("formatVersion", 2); put("exportedAt", raw.getValue("exportedAt"))
            put("binders", JsonArray(binders)); put("wishlists", JsonArray(wishlists)); put("sealedInventory", JsonArray(sealed))
            put("sections", buildJsonObject {
                payload["portableSections"]?.jsonObject?.forEach { (key, value) -> put(key, value) }
                put("ios", JsonObject(raw + ("payload" to JsonObject(payload - "portableSections"))))
                raw["appPreferences"]?.jsonObject?.get("smartFolders")?.jsonArray?.let { folders ->
                    val types = mapOf("Game" to "tcg", "TCG Game" to "tcg", "Set Code" to "setCode", "Foil Only" to "isFoil", "Rarity" to "rarity", "Condition" to "condition", "Set" to "setCode", "Foil" to "isFoil", "Tag" to "tag")
                    put("smartFolders", JsonArray(folders.map { element ->
                        val folder = element.jsonObject
                        JsonObject(folder + mapOf("matchMode" to JsonPrimitive(if (folder["matchMode"]?.jsonPrimitive?.content in listOf("any", "Match Any", "Any Rule")) "any" else "all"), "rules" to JsonArray(folder.getValue("rules").jsonArray.map { ruleElement ->
                            val rule = ruleElement.jsonObject; val type = rule.getValue("type").jsonPrimitive.content
                            JsonObject(rule + ("type" to JsonPrimitive(types[type] ?: type)))
                        })))
                    }))
                }
                listOf("transactions", "onlineCodes", "binderPages", "preferences").forEach { key -> payload[key]?.takeUnless { it is JsonNull }?.let { put(key, it) } }
                raw["binderPageImages"]?.takeUnless { it is JsonNull }?.let { put("binderPageImages", it) }
            })
        }
    }
    require(raw["formatVersion"]?.jsonPrimitive?.int in 1..2) { "Unsupported backup version" }
    require(raw["format"] == null || raw["format"]?.jsonPrimitive?.content == "com.tcger.portable-backup") { "Unrecognized backup format" }
    return JsonObject(raw + mapOf("formatVersion" to JsonPrimitive(2), "format" to JsonPrimitive("com.tcger.portable-backup")))
}
