package com.ahmadjalil.tcger.feature.libraryoperations

import kotlinx.serialization.Serializable

@Serializable
data class StoragePlacement(
    val id: String,
    val collectionEntryId: String,
    val slotIndex: Int,
    val quantity: Int,
    val stackKey: String? = null,
    val cardName: String? = null,
    val printedName: String? = null,
)

@Serializable
data class StorageCompartment(
    val id: String,
    val label: String,
    val order: Int,
    val pageNumber: Int? = null,
    val rows: Int,
    val columns: Int,
    val capacity: Int,
    val locked: Boolean = false,
    val placements: List<StoragePlacement> = emptyList(),
)

@Serializable
data class StorageContainer(
    val id: String,
    val binderId: String? = null,
    val name: String,
    val kind: String,
    val order: Int,
    val isUnsorted: Boolean = false,
    val locked: Boolean = false,
    val compartments: List<StorageCompartment> = emptyList(),
)

@Serializable
data class CreateStorageContainerRequest(
    val name: String,
    val kind: String,
    val binderId: String? = null,
    val order: Int? = null,
    val isUnsorted: Boolean = false,
    val locked: Boolean = false,
)

@Serializable
data class UpdateStorageContainerRequest(
    val name: String? = null,
    val order: Int? = null,
    val locked: Boolean? = null,
)

@Serializable
data class CreateStorageCompartmentRequest(
    val containerId: String,
    val label: String,
    val order: Int,
    val pageNumber: Int? = null,
    val rows: Int,
    val columns: Int,
    val capacity: Int,
    val locked: Boolean = false,
)

@Serializable
data class UpdateStorageCompartmentRequest(
    val label: String? = null,
    val order: Int? = null,
    val pageNumber: Int? = null,
    val locked: Boolean? = null,
)

@Serializable
data class PlaceCollectionEntryRequest(
    val compartmentId: String,
    val collectionEntryId: String,
    val slotIndex: Int,
    val quantity: Int,
    val allowDuplicateStacking: Boolean = false,
)

/**
 * Fast client-side checks for the storage editor. The server remains authoritative
 * for ownership, owned quantity, and whether two entries represent the same printing.
 */
object StoragePlacementRules {
    fun placementError(
        container: StorageContainer,
        compartment: StorageCompartment,
        slotIndex: Int,
        quantity: Int,
        allowDuplicateStacking: Boolean,
        movingPlacementId: String? = null,
    ): String? {
        if (container.locked) return "Container is locked"
        if (compartment.locked) return "Compartment is locked"
        if (slotIndex !in 0 until compartment.capacity) {
            return "Slot must be between 1 and ${compartment.capacity}"
        }
        if (quantity < 1) return "Quantity must be at least 1"
        val occupants = compartment.placements.filter {
            it.slotIndex == slotIndex && it.id != movingPlacementId
        }
        if (occupants.isNotEmpty() && !allowDuplicateStacking) {
            return "Slot ${slotIndex + 1} is occupied; enable duplicate stacking to use it"
        }
        return null
    }

    fun compartmentError(rows: Int, columns: Int, capacity: Int): String? = when {
        rows < 1 -> "Rows must be at least 1"
        columns < 1 -> "Columns must be at least 1"
        capacity < 1 -> "Capacity must be at least 1"
        capacity > rows * columns -> "Capacity cannot exceed rows × columns"
        else -> null
    }
}

@Serializable
data class DeckCheckoutAllocation(
    val id: String,
    val deckCardId: String,
    val collectionEntryId: String,
    val quantity: Int,
    val containerId: String? = null,
    val containerName: String? = null,
    val compartmentId: String? = null,
    val compartmentLabel: String? = null,
    val slotIndex: Int? = null,
    val cardName: String? = null,
    val printedName: String? = null,
    val refilledAt: String? = null,
) {
    val locationDescription: String
        get() = buildList {
            containerName?.let(::add)
            compartmentLabel?.let(::add)
            slotIndex?.let { add("Slot ${it + 1}") }
        }.joinToString(" · ").ifBlank { "Unsorted" }
}

@Serializable
data class DeckCheckoutSession(
    val id: String,
    val deckId: String,
    val status: String,
    val note: String? = null,
    val checkedOutAt: String,
    val checkedInAt: String? = null,
    val allocations: List<DeckCheckoutAllocation> = emptyList(),
) {
    val isCheckedOut: Boolean get() = status == "checked_out"
}

@Serializable data class DeckCheckoutRequest(val note: String? = null)

@Serializable
data class RapidSetEntryRequest(
    val binderId: String,
    val tcg: String,
    val setCode: String,
    val entries: List<RapidSetEntryRow>,
)

@Serializable
data class RapidCardData(
    val name: String,
    val printedName: String? = null,
    val searchAliases: List<String>? = null,
    val tcg: String,
    val externalId: String,
    val setCode: String? = null,
    val setName: String? = null,
    val collectorNumber: String? = null,
    val imageUrl: String? = null,
    val imageUrlSmall: String? = null,
)

@Serializable
data class RapidSetEntryRow(
    val rowId: String,
    val collectorNumber: String,
    val card: RapidCardData,
    val quantity: Int = 1,
)

@Serializable
data class RapidSetEntryReceipt(
    val receiptId: String,
    val addedRows: Int,
    val addedCopies: Int,
    val items: List<RapidSetEntryItem>,
)

@Serializable
data class RapidSetEntryItem(
    val rowId: String,
    val collectorNumber: String,
    val entryId: String,
    val auditId: String,
    val quantity: Int,
)

@Serializable data class UndoCollectionMutationRequest(val idempotencyKey: String)

@Serializable data class RapidCardSearchResponse(val cards: List<RapidCardData> = emptyList(), val total: Int = cards.size)

@Serializable
data class AcquisitionCostSplitItem(
    val collectionEntryId: String,
    val weight: Int = 1,
)

@Serializable
data class AcquisitionCostSplitRequest(
    val totalCents: Long,
    val currency: String,
    val mode: String,
    val lines: List<AcquisitionCostSplitItem>,
    val notes: String? = null,
)

@Serializable
data class AcquisitionCostAllocation(
    val collectionEntryId: String,
    val allocatedCents: Long,
    val acquisitionPrice: Double,
    val transactionId: String,
)

@Serializable
data class AcquisitionCostSplitReceipt(
    val allocationGroupId: String,
    val auditId: String,
    val totalCents: Long,
    val currency: String,
    val allocations: List<AcquisitionCostAllocation>,
)

@Serializable
data class PsaCertificationLookup(
    val certNumber: String,
    val grader: String,
    val grade: Double? = null,
    val gradeLabel: String? = null,
    val labelType: String? = null,
    val year: String? = null,
    val brand: String? = null,
    val subject: String? = null,
    val searchableName: String? = null,
    val cardNumber: String? = null,
    val variety: String? = null,
    val category: String? = null,
    val population: Int? = null,
    val populationHigher: Int? = null,
    val specId: String? = null,
    val cardId: String? = null,
    val providerResponseHash: String,
    val retrievedAt: String,
    val refreshAfter: String,
    val cached: Boolean,
)

@Serializable
data class PsaCertIntakeRequest(
    val binderId: String,
    val entryId: String,
    val gradingCompany: String,
    val gradingScore: String? = null,
    val certNumber: String,
)

@Serializable
data class PsaIntakeResult(
    val id: String,
    val name: String,
)

@Serializable
data class PrintedIdentityUpdateRequest(
    val printedName: String? = null,
    val searchAliases: List<String> = emptyList(),
)

@Serializable
data class PrintedIdentityResult(
    val id: String,
    val name: String,
    val printedName: String? = null,
    val searchAliases: List<String> = emptyList(),
)

@Serializable
data class TrackedPriceRequest(
    val items: List<TrackedPriceItem>,
    val force: Boolean = false,
    val source: String = "automatic",
)

@Serializable data class TrackedPriceItem(val tcg: String, val externalId: String)

@Serializable
data class PriceOriginalQuote(
    val amount: Double,
    val currency: String,
    val source: String,
    val asOf: String? = null,
)

@Serializable
data class PriceFxProvenance(
    val fromCurrency: String,
    val toCurrency: String,
    val rate: Double,
    val source: String,
    val asOf: String,
)

@Serializable
data class PriceMatchProvenance(
    val method: String,
    val confidence: Double,
    val ambiguous: Boolean? = null,
    val providerProductId: String? = null,
    val providerGroupId: String? = null,
)

@Serializable
data class PriceResultProvenance(
    val provider: String,
    val retrievedAt: String,
    val originalQuotes: List<PriceOriginalQuote> = emptyList(),
    val fx: PriceFxProvenance? = null,
    val match: PriceMatchProvenance? = null,
)

@Serializable
data class TrackedPriceResult(
    val key: String,
    val tcg: String,
    val externalId: String,
    val price: Double? = null,
    val currency: String? = null,
    val source: String? = null,
    val updatedAt: String? = null,
    val cached: Boolean,
    val error: String? = null,
    val provenance: PriceResultProvenance? = null,
)

@Serializable
data class TrackedPricesEnvelope(
    val prices: List<TrackedPriceResult> = emptyList(),
    val refreshedAt: String? = null,
    val refreshAfter: String? = null,
)

object ExactCentAllocator {
    fun allocate(totalCents: Long, items: List<AcquisitionCostSplitItem>): Map<String, Long> {
        require(totalCents >= 0) { "Total must not be negative" }
        require(items.isNotEmpty()) { "At least one item is required" }
        require(items.all { it.weight > 0 }) { "Weights must be positive" }
        require(items.map { it.collectionEntryId }.distinct().size == items.size) {
            "Collection entries must be unique"
        }

        val totalWeight = items.sumOf { it.weight.toLong() }
        val base = items.associate { item ->
            item.collectionEntryId to totalCents * item.weight / totalWeight
        }.toMutableMap()
        var remainder = totalCents - base.values.sum()

        items.sortedWith(
            compareByDescending<AcquisitionCostSplitItem> {
                (totalCents * it.weight) % totalWeight
            }.thenBy { it.collectionEntryId },
        ).forEach { item ->
            if (remainder > 0) {
                base[item.collectionEntryId] = base.getValue(item.collectionEntryId) + 1
                remainder -= 1
            }
        }
        return base
    }
}
