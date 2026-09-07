package com.ahmadjalil.tcger.data.backup

import com.ahmadjalil.tcger.data.local.*
import kotlinx.serialization.Serializable

@Serializable
data class LocalCollectionSnapshot(
    val binders: List<BinderWithCards>,
    val wishlists: List<WishlistWithCards>,
    val products: List<SealedProductEntity>,
    val inventory: List<SealedInventoryWithProduct>,
    val openings: List<SealedOpeningEntity>,
    val sections: kotlinx.serialization.json.JsonObject = kotlinx.serialization.json.JsonObject(emptyMap()),
)
