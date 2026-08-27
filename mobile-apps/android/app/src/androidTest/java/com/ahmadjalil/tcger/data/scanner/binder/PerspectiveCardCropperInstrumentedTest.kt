package com.ahmadjalil.tcger.data.scanner.binder

import android.graphics.Bitmap
import android.graphics.Color
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PerspectiveCardCropperInstrumentedTest {
    @Test fun perspectiveCropMapsARealTrapezoidIntoCardCorners() {
        val source = Bitmap.createBitmap(400, 500, Bitmap.Config.ARGB_8888)
        source.eraseColor(Color.BLACK)
        val quad = ScannerCropQuad(
            NormalizedPoint(0.20f, 0.10f), NormalizedPoint(0.80f, 0.16f),
            NormalizedPoint(0.90f, 0.90f), NormalizedPoint(0.10f, 0.84f),
        )
        val colors = listOf(Color.RED, Color.GREEN, Color.BLUE, Color.YELLOW)
        quad.corners.zip(colors).forEach { (point, color) ->
            val centerX = (point.x * source.width).toInt()
            val centerY = (point.y * source.height).toInt()
            for (y in centerY - 12..centerY + 12) for (x in centerX - 12..centerX + 12) {
                if (x in 0 until source.width && y in 0 until source.height) source.setPixel(x, y, color)
            }
        }

        val output = PerspectiveCardCropper.crop(source, quad, 180, 250)
        assertEquals(180, output.width)
        assertEquals(250, output.height)
        val samples = listOf(output.getPixel(4, 4), output.getPixel(175, 4), output.getPixel(175, 245), output.getPixel(4, 245))
        colors.zip(samples).forEach { (expected, actual) ->
            assertTrue(Color.red(actual) >= Color.red(expected) - 30)
            assertTrue(Color.green(actual) >= Color.green(expected) - 30)
            assertTrue(Color.blue(actual) >= Color.blue(expected) - 30)
        }
        source.recycle()
        output.recycle()
    }
}
