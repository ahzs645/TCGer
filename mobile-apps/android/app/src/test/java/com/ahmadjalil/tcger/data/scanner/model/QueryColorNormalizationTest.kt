package com.ahmadjalil.tcger.data.scanner.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class QueryColorNormalizationTest {
    @Test
    fun `autocontrast table matches Pillow semantics`() {
        val histogram = IntArray(256)
        for (value in 64..191) histogram[value] = 100
        val table = QueryColorNormalization.autocontrastTable(histogram, cutoffPercent = 0)
        assertEquals(0, table[64])
        assertEquals(255, table[191])
        assertEquals(((128 - 64) * 255.0 / 127.0).toInt(), table[128])
        // 12,800 pixels: 1 % = 128 pixels removes bin 64 and part of 65 → new low 65, high 190.
        val cut = QueryColorNormalization.autocontrastTable(histogram, cutoffPercent = 1)
        assertEquals(0, cut[65])
        assertEquals(255, cut[190])
        val flat = IntArray(256).also { it[100] = 500 }
        assertEquals(100, QueryColorNormalization.autocontrastTable(flat, cutoffPercent = 1)[100])
    }

    @Test
    fun `grey world gains balance a warm cast`() {
        val gains = QueryColorNormalization.greyWorldGains(doubleArrayOf(150.0, 128.0, 100.0))
        assertEquals(126.0, gains[0] * 150, 0.01)
        assertEquals(126.0, gains[2] * 100, 0.01)
        assertEquals(1.0, QueryColorNormalization.greyWorldGains(doubleArrayOf(0.0, 10.0, 20.0))[0], 0.0)
    }

    @Test
    fun `normalizes packed ARGB pixels in place and keeps alpha`() {
        val warm = (0xff shl 24) or (150 shl 16) or (128 shl 8) or 100
        val pixels = IntArray(100) { warm }
        pixels[98] = (0xff shl 24) or (200 shl 16) or (178 shl 8) or 150
        pixels[99] = (0x80 shl 24) or (100 shl 16) or (78 shl 8) or 50
        QueryColorNormalization.normalizeArgb(pixels)
        val red = (pixels[0] ushr 16) and 0xff
        val green = (pixels[0] ushr 8) and 0xff
        val blue = pixels[0] and 0xff
        assertTrue(abs(red - green) <= 2)
        assertTrue(abs(green - blue) <= 2)
        assertEquals(0xff, pixels[0] ushr 24)
        assertEquals(0x80, pixels[99] ushr 24)
    }
}
