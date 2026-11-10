// @tcger-feature {"id":"scanner.model.queryNormalization","platform":"android","status":"partial","limitation":"Grey-world autocontrast runs for games whose policy declares it (Magic). The raw + normalized blend is implemented with unit tests but no built-in game declares it, and it has not been exercised on a device."}
package com.ahmadjalil.tcger.data.scanner.model

import android.graphics.Bitmap

/**
 * Query-side colour normalization applied to every crop before the encoder's
 * resize/centre-crop contract — the Android twin of iOS
 * `QueryColorNormalization.swift` and the trainer's `normalize_query_colors`.
 *
 * The gallery is embedded from clean, full-range renders; phone crops arrive
 * low-contrast under a room colour cast, which the encoder was never trained
 * to ignore. Measured offline on 108 labeled Magic frames (2026-08-30) a
 * grey-world white balance followed by Pillow's 1 % per-channel autocontrast
 * raised correct top-1 from 79 to 104 with no new wrong accept; Pokémon
 * would-be accepts 27 → 31. The arithmetic mirrors Pillow exactly (float
 * grey-world gains with truncating conversion, then `ImageOps.autocontrast`
 * with cutoff 1) so all runtimes and the offline evaluator agree.
 */
object QueryColorNormalization {
    const val AUTOCONTRAST_CUTOFF_PERCENT = 1

    /**
     * The query renderings a declared normalization embeds, in order: `false`
     * is the raw crop, `true` the normalized one. One rendering is searched
     * as is; two are combined by [blended].
     */
    fun renderings(normalization: ScannerAcceptancePolicy.QueryNormalization): List<Boolean> = when (normalization) {
        ScannerAcceptancePolicy.QueryNormalization.NONE -> listOf(false)
        ScannerAcceptancePolicy.QueryNormalization.GREY_WORLD_AUTOCONTRAST -> listOf(true)
        ScannerAcceptancePolicy.QueryNormalization.GREY_WORLD_AUTOCONTRAST_BLEND -> listOf(false, true)
    }

    /**
     * Combines the embeddings of one crop's renderings into the vector that is
     * searched — the twin of iOS `QueryColorNormalization.blended`. A single
     * embedding passes through untouched, so the existing modes are unchanged.
     * Several are each L2-normalized, averaged and L2-normalized again: the
     * mean direction of the raw and the colour-normalized view. Measured
     * offline with the released Pokémon encoder (2026-11-10): 106
     * hand-outlined cards of one warm-lit session go from 67 correct / 2
     * wrong would-be accepts to 93 / 0, and the 51 older labeled frames stay
     * at 33 correct while losing their one wrong accept.
     */
    fun blended(embeddings: List<FloatArray>): FloatArray {
        require(embeddings.isNotEmpty()) { "no query embeddings to combine" }
        if (embeddings.size == 1) return embeddings[0]
        val dimension = embeddings[0].size
        require(dimension > 0 && embeddings.all { it.size == dimension }) { "query embeddings differ in dimension" }
        val sum = DoubleArray(dimension)
        for (embedding in embeddings) {
            val norm = kotlin.math.sqrt(embedding.fold(0.0) { total, value -> total + value.toDouble() * value })
            require(norm > 0.0 && norm.isFinite()) { "query embedding is zero or non-finite" }
            for (index in 0 until dimension) sum[index] += embedding[index] / norm
        }
        val norm = kotlin.math.sqrt(sum.fold(0.0) { total, value -> total + value * value })
        require(norm > 0.0 && norm.isFinite()) { "combined query embedding is zero or non-finite" }
        return FloatArray(dimension) { (sum[it] / norm).toFloat() }
    }

    fun normalized(bitmap: Bitmap): Bitmap {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
        normalizeArgb(pixels)
        return Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
    }

    /** In-place grey-world white balance then per-channel autocontrast on packed ARGB pixels. */
    fun normalizeArgb(pixels: IntArray) {
        if (pixels.isEmpty()) return
        val sums = DoubleArray(3)
        for (pixel in pixels) {
            sums[0] += ((pixel ushr 16) and 0xff).toDouble()
            sums[1] += ((pixel ushr 8) and 0xff).toDouble()
            sums[2] += (pixel and 0xff).toDouble()
        }
        val means = DoubleArray(3) { sums[it] / pixels.size }
        val gains = greyWorldGains(means)
        val histograms = Array(3) { IntArray(256) }
        for (index in pixels.indices) {
            val pixel = pixels[index]
            val alpha = pixel ushr 24
            val red = balanced((pixel ushr 16) and 0xff, gains[0])
            val green = balanced((pixel ushr 8) and 0xff, gains[1])
            val blue = balanced(pixel and 0xff, gains[2])
            histograms[0][red]++
            histograms[1][green]++
            histograms[2][blue]++
            pixels[index] = (alpha shl 24) or (red shl 16) or (green shl 8) or blue
        }
        val tables = Array(3) { autocontrastTable(histograms[it], AUTOCONTRAST_CUTOFF_PERCENT) }
        for (index in pixels.indices) {
            val pixel = pixels[index]
            val alpha = pixel ushr 24
            val red = tables[0][(pixel ushr 16) and 0xff]
            val green = tables[1][(pixel ushr 8) and 0xff]
            val blue = tables[2][pixel and 0xff]
            pixels[index] = (alpha shl 24) or (red shl 16) or (green shl 8) or blue
        }
    }

    /** Pillow: clip to [0, 255] then truncate to uint8. */
    private fun balanced(value: Int, gain: Double): Int =
        minOf(255.0, value * gain).toInt()

    /** Per-channel multipliers moving each channel mean onto their common mean; a zero mean is left alone. */
    fun greyWorldGains(means: DoubleArray): DoubleArray {
        val overall = means.sum() / means.size
        return DoubleArray(means.size) { if (means[it] > 0) overall / means[it] else 1.0 }
    }

    /**
     * Pillow's `ImageOps.autocontrast` lookup table for one channel: drop
     * `cutoffPercent` of the pixels from each end of the histogram, then stretch
     * what remains to the full range.
     */
    fun autocontrastTable(histogram: IntArray, cutoffPercent: Int): IntArray {
        val counts = histogram.copyOf()
        val total = counts.sum()
        if (cutoffPercent > 0 && total > 0) {
            var cut = total * cutoffPercent / 100
            for (low in 0 until 256) {
                if (cut > counts[low]) {
                    cut -= counts[low]
                    counts[low] = 0
                } else {
                    counts[low] -= cut
                    cut = 0
                }
                if (cut <= 0) break
            }
            cut = total * cutoffPercent / 100
            for (high in 255 downTo 0) {
                if (cut > counts[high]) {
                    cut -= counts[high]
                    counts[high] = 0
                } else {
                    counts[high] -= cut
                    cut = 0
                }
                if (cut <= 0) break
            }
        }
        val low = counts.indexOfFirst { it > 0 }.let { if (it < 0) 0 else it }
        val high = counts.indexOfLast { it > 0 }.let { if (it < 0) 255 else it }
        if (high <= low) return IntArray(256) { it }
        val scale = 255.0 / (high - low)
        val offset = -low * scale
        return IntArray(256) { value ->
            // Pillow truncates toward zero before clamping.
            (value * scale + offset).toInt().coerceIn(0, 255)
        }
    }
}
