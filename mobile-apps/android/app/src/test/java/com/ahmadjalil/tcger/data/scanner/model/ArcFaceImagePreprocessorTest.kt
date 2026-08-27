package com.ahmadjalil.tcger.data.scanner.model

import org.junit.Assert.assertArrayEquals
import org.junit.Test

class ArcFaceImagePreprocessorTest {
    @Test
    fun `converts ARGB pixels to RGB CHW unit floats without ImageNet normalization`() {
        val chw = ArcFaceImagePreprocessor.argbToChwUnitFloats(
            intArrayOf(0xffff0000.toInt(), 0xff00ff80.toInt()),
        )

        assertArrayEquals(
            floatArrayOf(1f, 0f, 0f, 1f, 0f, 128f / 255f),
            chw,
            0.000_001f,
        )
    }
}
