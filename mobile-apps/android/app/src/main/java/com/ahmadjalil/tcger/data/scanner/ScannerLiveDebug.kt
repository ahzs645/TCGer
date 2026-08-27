package com.ahmadjalil.tcger.data.scanner

import java.time.Instant

data class ScannerLiveGeometry(
    val left: Double = 0.16,
    val top: Double = 0.045,
    val right: Double = 0.84,
    val bottom: Double = 0.955,
) {
    init { require(left in 0.0..1.0 && top in 0.0..1.0 && right in 0.0..1.0 && bottom in 0.0..1.0 && left < right && top < bottom) }
    val label: String get() = "L %.3f · T %.3f · R %.3f · B %.3f".format(left, top, right, bottom)
}

data class ScannerLiveDebugEvent(
    val sequence: Long,
    val timestamp: String,
    val message: String,
)

class ScannerLiveDebugLog(
    private val maxEvents: Int = 100,
    private val now: () -> Instant = Instant::now,
) {
    private val events = ArrayDeque<ScannerLiveDebugEvent>()
    private var nextSequence = 1L
    var isRunning: Boolean = false
        private set

    init { require(maxEvents > 0) }

    fun start() { isRunning = true; append("Live pipeline observation started") }
    fun stop() { append("Live pipeline observation stopped"); isRunning = false }
    fun clear() { events.clear() }
    fun record(message: String) { if (isRunning) append(message) }
    fun snapshot(): List<ScannerLiveDebugEvent> = events.toList()

    private fun append(message: String) {
        while (events.size >= maxEvents) events.removeFirst()
        events.addLast(ScannerLiveDebugEvent(nextSequence++, now().toString(), message.take(300)))
    }
}
