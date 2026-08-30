package com.ahmadjalil.tcger.feature.libraryoperations

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StoragePlacementRulesTest {
    private val placement = StoragePlacement(
        id = "placement-1",
        collectionEntryId = "entry-1",
        slotIndex = 0,
        quantity = 1,
        stackKey = "pokemon:base-4",
    )
    private val compartment = StorageCompartment(
        id = "compartment-1",
        label = "Page 1",
        order = 0,
        rows = 3,
        columns = 3,
        capacity = 9,
        placements = listOf(placement),
    )
    private val container = StorageContainer(
        id = "container-1",
        name = "Main binder",
        kind = "binder",
        order = 0,
        compartments = listOf(compartment),
    )

    @Test
    fun `locked locations reject placement`() {
        assertEquals(
            "Container is locked",
            StoragePlacementRules.placementError(
                container.copy(locked = true), compartment, 1, 1, false,
            ),
        )
        assertEquals(
            "Compartment is locked",
            StoragePlacementRules.placementError(
                container, compartment.copy(locked = true), 1, 1, false,
            ),
        )
    }

    @Test
    fun `capacity is exact and one based presentation maps to zero based storage`() {
        assertNull(StoragePlacementRules.placementError(container, compartment, 8, 1, false))
        assertEquals(
            "Slot must be between 1 and 9",
            StoragePlacementRules.placementError(container, compartment, 9, 1, false),
        )
    }

    @Test
    fun `occupied slot requires explicit stacking but moving placement does not occupy itself`() {
        assertTrue(
            StoragePlacementRules.placementError(container, compartment, 0, 1, false)!!
                .contains("enable duplicate stacking"),
        )
        assertNull(StoragePlacementRules.placementError(container, compartment, 0, 1, true))
        assertNull(
            StoragePlacementRules.placementError(
                container, compartment, 0, 1, false, movingPlacementId = placement.id,
            ),
        )
    }

    @Test
    fun `compartment capacity cannot exceed its grid`() {
        assertNull(StoragePlacementRules.compartmentError(3, 3, 9))
        assertEquals("Capacity cannot exceed rows × columns", StoragePlacementRules.compartmentError(3, 3, 10))
    }

    @Test
    fun `update payload serializes only requested patch fields`() {
        val json = Json { explicitNulls = false }.encodeToString(UpdateStorageContainerRequest(locked = true))
        assertEquals("{\"locked\":true}", json)
        assertFalse(json.contains("name"))
        assertFalse(json.contains("order"))
    }
}
