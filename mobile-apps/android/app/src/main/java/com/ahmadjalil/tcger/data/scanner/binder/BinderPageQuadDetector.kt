package com.ahmadjalil.tcger.data.scanner.binder

import android.graphics.Bitmap
import kotlin.math.abs

data class BinderPageDetection(
    val quad: ScannerCropQuad,
    val confidence: Float,
)

/** Lightweight page-boundary detector used to seed the editable binder-page quad. */
object BinderPageQuadDetector {
    fun detect(bitmap: Bitmap): BinderPageDetection? {
        if (bitmap.width < 80 || bitmap.height < 80) return null
        val sampleWidth = bitmap.width.coerceAtMost(320)
        val sampleHeight = (bitmap.height * (sampleWidth.toFloat() / bitmap.width)).toInt().coerceIn(80, 420)
        val sampled = if (sampleWidth == bitmap.width && sampleHeight == bitmap.height) bitmap else {
            Bitmap.createScaledBitmap(bitmap, sampleWidth, sampleHeight, true)
        }
        return try {
            val pixels = IntArray(sampleWidth * sampleHeight)
            sampled.getPixels(pixels, 0, sampleWidth, 0, 0, sampleWidth, sampleHeight)
            detectArgb(pixels, sampleWidth, sampleHeight)
        } finally {
            if (sampled !== bitmap) sampled.recycle()
        }
    }

    internal fun detectArgb(pixels: IntArray, width: Int, height: Int): BinderPageDetection? {
        require(pixels.size == width * height)
        if (width < 20 || height < 20) return null
        val luma = IntArray(pixels.size) { index ->
            val color = pixels[index]
            val red = color shr 16 and 0xff
            val green = color shr 8 and 0xff
            val blue = color and 0xff
            (red * 30 + green * 59 + blue * 11) / 100
        }
        val vertical = FloatArray(width)
        for (x in 1 until width) {
            var score = 0L
            for (y in height / 12 until height - height / 12 step 2) {
                score += abs(luma[y * width + x] - luma[y * width + x - 1])
            }
            vertical[x] = score.toFloat()
        }
        val horizontal = FloatArray(height)
        for (y in 1 until height) {
            var score = 0L
            for (x in width / 12 until width - width / 12 step 2) {
                score += abs(luma[y * width + x] - luma[(y - 1) * width + x])
            }
            horizontal[y] = score.toFloat()
        }
        val left = vertical.strongest(width * 3 / 100, width * 38 / 100)
        val right = vertical.strongest(width * 62 / 100, width * 97 / 100)
        val top = horizontal.strongest(height * 3 / 100, height * 38 / 100)
        val bottom = horizontal.strongest(height * 62 / 100, height * 97 / 100)
        if (right.index - left.index < width * 0.35f || bottom.index - top.index < height * 0.35f) return null
        val averageVertical = vertical.average().toFloat().coerceAtLeast(1f)
        val averageHorizontal = horizontal.average().toFloat().coerceAtLeast(1f)
        val edgeRatio = listOf(
            left.score / averageVertical,
            right.score / averageVertical,
            top.score / averageHorizontal,
            bottom.score / averageHorizontal,
        ).average().toFloat()
        if (edgeRatio < 2.2f) return null
        return BinderPageDetection(
            quad = ScannerCropQuad.fromBounds(
                left.index.toFloat() / width,
                top.index.toFloat() / height,
                right.index.toFloat() / width,
                bottom.index.toFloat() / height,
            ),
            confidence = ((edgeRatio - 2.2f) / 5f).coerceIn(0.05f, 1f),
        )
    }

    private data class Peak(val index: Int, val score: Float)

    private fun FloatArray.strongest(start: Int, end: Int): Peak {
        val range = start.coerceAtLeast(1)..end.coerceAtMost(lastIndex)
        val index = range.maxBy { this[it] }
        return Peak(index, this[index])
    }
}
