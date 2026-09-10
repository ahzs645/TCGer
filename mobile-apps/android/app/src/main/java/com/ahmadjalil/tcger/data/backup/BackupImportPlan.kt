package com.ahmadjalil.tcger.data.backup

import com.ahmadjalil.tcger.data.local.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.UUID

fun PortableCollectionBackup.importPlan(products: List<SealedProductEntity>): LocalCollectionSnapshot {
    val fingerprint = UUID.nameUUIDFromBytes(Json.encodeToString(copy(exportedAt = "")).toByteArray()).toString()
    fun stable(path: String) = UUID.nameUUIDFromBytes("$fingerprint:$path".toByteArray()).toString()
    val binderGroups = binders.mapIndexed { index, binder ->
        val id = binder.id ?: stable("binder:$index")
        BinderWithCards(BinderEntity(id, binder.name, binder.description, binder.colorHex, binder.defaultCondition,
            binder.containerType, binder.imageUrl, binder.associatedTcg, binder.associatedSetCode, binder.associatedSetName, 0, 0),
            binder.cards.flatMapIndexed { cardIndex, owned -> List(owned.quantity) { copyIndex ->
                val card = owned.card
                OwnedCardEntity(if (copyIndex == 0) owned.id ?: stable("copy:$index:$cardIndex:0") else stable("copy:$index:$cardIndex:$copyIndex"),
                    id, card.id, card.name, card.tcg, card.setCode, card.setName, card.rarity, card.collectorNumber, card.imageUrl,
                    1, owned.condition, owned.price, 0, owned.acquisitionPrice, Json.encodeToString(owned.details))
            } })
    }
    val wishlistGroups = wishlists.mapIndexed { index, wishlist ->
        val id = wishlist.id ?: stable("wishlist:$index")
        WishlistWithCards(WishlistEntity(id, wishlist.name, wishlist.description, wishlist.colorHex, wishlist.matchAnyPrinting, 0, 0, Json.encodeToString(wishlist.rules), Json.encodeToString(wishlist.excludedCardKeys)),
            wishlist.cards.mapIndexed { cardIndex, wanted ->
                val card = wanted.card
                WishlistCardEntity(wanted.id ?: stable("wanted:$index:$cardIndex"), id, card.id, card.name, card.tcg, card.setCode,
                    card.setName, card.rarity, card.collectorNumber, card.imageUrl, wanted.desiredQuantity, wanted.notes, 0)
            })
    }
    val importedProducts = sealedInventory.mapNotNull { it.product }.map { json ->
        val defaults = kotlinx.serialization.json.buildJsonObject {
            put("isCustom", kotlinx.serialization.json.JsonPrimitive(false))
            for (key in listOf("setCode", "cardsPerPack", "packsPerBox", "releaseDate", "imageUrl", "msrp", "upc")) put(key, kotlinx.serialization.json.JsonNull)
            json.forEach { (key, value) -> put(key, value) }
        }
        Json { ignoreUnknownKeys = true }.decodeFromJsonElement(SealedProductEntity.serializer(), defaults)
    }
    val allProducts = (products + importedProducts).distinctBy { it.id }
    val inventory = sealedInventory.mapIndexed { index, item ->
        val product = requireNotNull(allProducts.firstOrNull { it.id == item.productId }) { "Missing sealed product ${item.productName}; no data was imported" }
        SealedInventoryWithProduct(SealedInventoryEntity(item.id ?: stable("sealed:$index"), item.productId, item.quantity,
            item.purchasePrice, item.purchaseDate, item.notes, exportedAt), product)
    }
    require(binderGroups.flatMap { it.cards }.map { it.id }.distinct().size == binderGroups.sumOf { it.cards.size }) { "Duplicate collection-copy IDs" }
    val openings = sections["androidSealedOpenings"]?.let { Json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(SealedOpeningEntity.serializer()), it) } ?: emptyList()
    return LocalCollectionSnapshot(binderGroups, wishlistGroups, allProducts, inventory, openings)
}
