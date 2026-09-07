package com.ahmadjalil.tcger.domain

import kotlinx.serialization.Serializable

@Serializable
data class CollectionTag(val id: String = "", val label: String, val colorHex: String = "315DA8")

@Serializable
data class CollectionDetails(
    val language: String? = null,
    val notes: String? = null,
    val serialNumber: String? = null,
    val acquiredAt: String? = null,
    val isFoil: Boolean = false,
    val finishCode: String? = null,
    val finishLabel: String? = null,
    val edition: String? = null,
    val stamp: String? = null,
    val isSealedPromo: Boolean = false,
    val isOversized: Boolean = false,
    val isPeelOff: Boolean = false,
    val isSigned: Boolean = false,
    val isAltered: Boolean = false,
    val gradingCompany: String? = null,
    val gradingScore: String? = null,
    val certNumber: String? = null,
    val storageLocation: String? = null,
    val imageUrls: List<String> = emptyList(),
    val tags: List<CollectionTag> = emptyList(),
)

@Serializable
data class CollectionEdit(
    val condition: String? = null,
    val price: Double? = null,
    val acquisitionPrice: Double? = null,
    val details: CollectionDetails = CollectionDetails(),
) {
    fun validate() {
        val conditions = setOf("GEM MINT", "GM", "MINT", "M", "NEAR MINT", "NM", "EXCELLENT", "EX", "VERY GOOD", "VG", "GOOD", "GD", "G", "LIGHTLY PLAYED", "LIGHT PLAYED", "LP", "MODERATE PLAY", "MODERATELY PLAYED", "MP", "PLAYED", "PL", "HEAVY PLAY", "HEAVILY PLAYED", "HP", "POOR", "PO", "PR", "DAMAGED", "DMG")
        require(condition == null || condition.trim().uppercase() in conditions) { "Choose a recognized condition, such as NM, LP, MP, HP, or Damaged" }
        details.acquiredAt?.let { date -> require(runCatching { java.time.Instant.parse(date) }.isSuccess || runCatching { java.time.LocalDate.parse(date) }.isSuccess) { "Acquired date must be YYYY-MM-DD or an ISO timestamp" } }
        require(details.tags.all { it.label.isNotBlank() && it.colorHex.matches(Regex("[0-9A-Fa-f]{6}")) }) { "Tags need a label and a six-digit color" }
        require(price == null || price.isFinite() && price >= 0) { "Price must be a nonnegative number" }
        require(acquisitionPrice == null || acquisitionPrice.isFinite() && acquisitionPrice >= 0) { "Purchase cost must be a nonnegative number" }
    }
}

fun OwnedCard.edit() = CollectionEdit(condition, price, acquisitionPrice, details)
fun CatalogCard.identity() = "${tcg.lowercase()}:$id"
