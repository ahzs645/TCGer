package com.ahmadjalil.tcger.data.scanner

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AutomaticCaptureRearmGateTest {
    @Test
    fun acceptedCardDisarmsUntilItLeaves() {
        val gate = AutomaticCaptureRearmGate()

        gate.accepted("card-a")
        gate.observe("card-a")

        assertFalse(gate.isArmed)
        assertTrue(gate.isWaitingForCardRemoval)

        gate.observe(null)

        assertTrue(gate.isArmed)
    }

    @Test
    fun replacementCardRearmsWithoutAcceptingIt() {
        val gate = AutomaticCaptureRearmGate()
        gate.accepted("card-a")

        gate.observe("card-b")

        assertTrue(gate.isArmed)
    }

    @Test
    fun explicitNextRearms() {
        val gate = AutomaticCaptureRearmGate()
        gate.accepted("card-a")

        gate.next()

        assertTrue(gate.isArmed)
    }
}
