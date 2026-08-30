package com.ahmadjalil.tcger.feature.libraryoperations

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ExactCentAllocatorTest {
    @Test
    fun equalSplitAssignsRemainderDeterministically() {
        val result = ExactCentAllocator.allocate(
            100,
            listOf(
                AcquisitionCostSplitItem("entry-c"),
                AcquisitionCostSplitItem("entry-a"),
                AcquisitionCostSplitItem("entry-b"),
            ),
        )

        assertEquals(34, result.getValue("entry-a"))
        assertEquals(33, result.getValue("entry-b"))
        assertEquals(33, result.getValue("entry-c"))
        assertEquals(100, result.values.sum())
    }

    @Test
    fun weightedSplitPreservesEveryCent() {
        val result = ExactCentAllocator.allocate(
            999,
            listOf(
                AcquisitionCostSplitItem("premium", 5),
                AcquisitionCostSplitItem("regular", 2),
                AcquisitionCostSplitItem("bulk", 1),
            ),
        )

        assertEquals(999, result.values.sum())
        assertEquals(624, result.getValue("premium"))
        assertEquals(250, result.getValue("regular"))
        assertEquals(125, result.getValue("bulk"))
    }

    @Test
    fun duplicateEntriesAreRejected() {
        assertThrows(IllegalArgumentException::class.java) {
            ExactCentAllocator.allocate(
                100,
                listOf(AcquisitionCostSplitItem("same"), AcquisitionCostSplitItem("same")),
            )
        }
    }
}
