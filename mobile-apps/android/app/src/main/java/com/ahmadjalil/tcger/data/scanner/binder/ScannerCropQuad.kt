package com.ahmadjalil.tcger.data.scanner.binder

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** A point in top-left-origin image coordinates, normalized to [0, 1]. */
data class NormalizedPoint(val x: Float, val y: Float)

/**
 * Four card corners in clockwise, top-left-origin image coordinates.
 *
 * This mirrors the iOS crop-rescue geometry contract. Keeping the model free
 * of Android UI types lets detection, an editor, and replay tests share it.
 */
data class ScannerCropQuad(
    val topLeft: NormalizedPoint,
    val topRight: NormalizedPoint,
    val bottomRight: NormalizedPoint,
    val bottomLeft: NormalizedPoint,
) {
    val corners: List<NormalizedPoint>
        get() = listOf(topLeft, topRight, bottomRight, bottomLeft)

    val area: Float
        get() {
            var total = 0f
            corners.indices.forEach { index ->
                val current = corners[index]
                val next = corners[(index + 1) % corners.size]
                total += current.x * next.y - next.x * current.y
            }
            return abs(total) / 2f
        }

    val isValid: Boolean
        get() {
            if (corners.any { !it.x.isFinite() || !it.y.isFinite() || it.x !in 0f..1f || it.y !in 0f..1f }) {
                return false
            }
            if (area < MINIMUM_AREA) return false
            val crosses = corners.indices.map { index ->
                val first = corners[index]
                val second = corners[(index + 1) % 4]
                val third = corners[(index + 2) % 4]
                (second.x - first.x) * (third.y - second.y) -
                    (second.y - first.y) * (third.x - second.x)
            }
            return crosses.all { it > MINIMUM_CROSS } || crosses.all { it < -MINIMUM_CROSS }
        }

    fun expandedOutward(fraction: Float): ScannerCropQuad {
        require(fraction > -1f) { "fraction must keep a positive-sized quad" }
        val center = NormalizedPoint(
            corners.sumOf { it.x.toDouble() }.toFloat() / 4f,
            corners.sumOf { it.y.toDouble() }.toFloat() / 4f,
        )
        fun expand(point: NormalizedPoint) = NormalizedPoint(
            x = (center.x + (point.x - center.x) * (1f + fraction)).coerceIn(EDGE_INSET, 1f - EDGE_INSET),
            y = (center.y + (point.y - center.y) * (1f + fraction)).coerceIn(EDGE_INSET, 1f - EDGE_INSET),
        )
        return ScannerCropQuad(expand(topLeft), expand(topRight), expand(bottomRight), expand(bottomLeft))
    }

    companion object {
        private const val MINIMUM_AREA = 0.04f
        private const val MINIMUM_CROSS = 0.0001f
        private const val EDGE_INSET = 0.005f
        private const val CARD_ASPECT = 63f / 88f

        fun centered(imageWidth: Int, imageHeight: Int): ScannerCropQuad {
            require(imageWidth > 0 && imageHeight > 0) { "image dimensions must be positive" }
            val imageAspect = max(0.1f, imageWidth.toFloat() / imageHeight)
            var heightFraction = 0.82f
            var widthFraction = heightFraction * CARD_ASPECT / imageAspect
            if (widthFraction > 0.86f) {
                widthFraction = 0.86f
                heightFraction = widthFraction * imageAspect / CARD_ASPECT
            }
            val left = (1f - widthFraction) / 2f
            val top = (1f - heightFraction) / 2f
            return fromBounds(left, top, left + widthFraction, top + heightFraction)
        }

        fun fromBounds(left: Float, top: Float, right: Float, bottom: Float) = ScannerCropQuad(
            NormalizedPoint(left, top),
            NormalizedPoint(right, top),
            NormalizedPoint(right, bottom),
            NormalizedPoint(left, bottom),
        )
    }
}
