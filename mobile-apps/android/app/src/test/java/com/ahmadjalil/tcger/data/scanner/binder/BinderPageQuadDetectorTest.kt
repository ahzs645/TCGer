package com.ahmadjalil.tcger.data.scanner.binder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class BinderPageQuadDetectorTest {
    @Test
    fun `detects high contrast binder page boundary`() {
        val width = 100
        val height = 120
        val pixels = IntArray(width * height) { 0xff202020.toInt() }
        for (y in 18 until 102) for (x in 15 until 85) pixels[y * width + x] = 0xffe8e8e8.toInt()

        val detection = BinderPageQuadDetector.detectArgb(pixels, width, height)

        assertNotNull(detection)
        assertEquals(0.15f, detection!!.quad.topLeft.x, 0.03f)
        assertEquals(0.15f, detection.quad.topLeft.y, 0.03f)
        assertEquals(0.85f, detection.quad.bottomRight.x, 0.03f)
        assertEquals(0.85f, detection.quad.bottomRight.y, 0.03f)
    }

    @Test
    fun `rejects flat images`() {
        assertNull(BinderPageQuadDetector.detectArgb(IntArray(100 * 120) { 0xff808080.toInt() }, 100, 120))
    }
}
