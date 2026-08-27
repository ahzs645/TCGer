package com.ahmadjalil.tcger

/** Runtime switch set only by the parity-test launch argument. */
object ParityTestMode {
    var isEnabled: Boolean = false
        internal set
}
