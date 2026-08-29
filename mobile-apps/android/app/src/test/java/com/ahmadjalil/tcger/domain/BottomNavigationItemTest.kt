package com.ahmadjalil.tcger.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class BottomNavigationItemTest {
    @Test
    fun normalizedOrder_dropsUnknownAndDuplicateValues_thenAppendsNewItems() {
        val normalized = BottomNavigationItem.normalizedOrder(
            listOf("SCAN", "HOME", "SCAN", "REMOVED_DESTINATION"),
        )

        assertEquals(BottomNavigationItem.SCAN, normalized[0])
        assertEquals(BottomNavigationItem.HOME, normalized[1])
        assertEquals(BottomNavigationItem.defaultOrder.toSet(), normalized.toSet())
        assertEquals(BottomNavigationItem.defaultOrder.size, normalized.size)
    }

    @Test
    fun normalizedHidden_neverHidesPinnedSettings() {
        val hidden = BottomNavigationItem.normalizedHidden(
            listOf("HOME", "SETTINGS", "UNKNOWN"),
        )

        assertEquals(setOf(BottomNavigationItem.HOME), hidden)
        assertFalse(BottomNavigationItem.SETTINGS in hidden)
    }

    @Test
    fun appPreferences_filtersHiddenItemsInSavedOrder() {
        val preferences = AppPreferences(
            bottomNavigationOrder = listOf(
                BottomNavigationItem.SCAN,
                BottomNavigationItem.HOME,
                BottomNavigationItem.SETTINGS,
            ),
            hiddenBottomNavigationItems = setOf(
                BottomNavigationItem.HOME,
                BottomNavigationItem.SETTINGS,
            ),
        )

        assertEquals(
            listOf(BottomNavigationItem.SCAN, BottomNavigationItem.SETTINGS),
            preferences.visibleBottomNavigationItems,
        )
    }

    @Test
    fun orderAndVisibility_roundTripThroughPersistenceCodec() {
        val order = listOf(
            BottomNavigationItem.SETTINGS,
            BottomNavigationItem.SEALED,
            BottomNavigationItem.HOME,
            BottomNavigationItem.PACK_OPENING,
        )
        val hidden = setOf(
            BottomNavigationItem.HOME,
            BottomNavigationItem.SETTINGS,
        )

        val restoredOrder = BottomNavigationItem.normalizedOrder(
            BottomNavigationItem.encodeOrder(order).split(','),
        )
        val restoredHidden = BottomNavigationItem.normalizedHidden(
            BottomNavigationItem.encodeHidden(hidden).split(','),
        )

        assertEquals(order, restoredOrder.take(order.size))
        assertEquals(setOf(BottomNavigationItem.HOME), restoredHidden)
    }

    @Test
    fun layout_reservesFifthSlotForOverflow() {
        val layout = BottomNavigationLayout(BottomNavigationItem.defaultOrder)

        assertEquals(4, layout.primaryItems.size)
        assertEquals(
            BottomNavigationItem.defaultOrder.drop(4),
            layout.overflowItems,
        )
        assertEquals(true, layout.usesOverflow)
    }
}
