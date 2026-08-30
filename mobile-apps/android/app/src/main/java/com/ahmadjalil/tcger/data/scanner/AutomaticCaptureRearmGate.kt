package com.ahmadjalil.tcger.data.scanner

/**
 * One-card/one-capture safety boundary for automatic scanning.
 *
 * Recognition probes may continue while disarmed so the app can observe the
 * accepted card leaving the guide. Only the acceptance boundary is disarmed.
 */
class AutomaticCaptureRearmGate {
    private var acceptedCardId: String? = null

    val isArmed: Boolean get() = acceptedCardId == null
    val isWaitingForCardRemoval: Boolean get() = !isArmed

    fun accepted(cardId: String) {
        require(cardId.isNotBlank())
        acceptedCardId = cardId
    }

    /** A missing or different match means the accepted card has left the guide. */
    fun observe(candidateId: String?) {
        val accepted = acceptedCardId ?: return
        if (candidateId == null || candidateId != accepted) acceptedCardId = null
    }

    fun next() {
        acceptedCardId = null
    }

    fun reset() = next()
}
