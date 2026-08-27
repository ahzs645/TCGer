package com.ahmadjalil.tcger.data.scanner.binder

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint

/** Perspective-corrects a validated card quad to the iOS scanner's 720x1000 crop contract. */
object PerspectiveCardCropper {
    const val DEFAULT_WIDTH = 720
    const val DEFAULT_HEIGHT = 1000

    fun crop(
        source: Bitmap,
        quad: ScannerCropQuad,
        outputWidth: Int = DEFAULT_WIDTH,
        outputHeight: Int = DEFAULT_HEIGHT,
    ): Bitmap {
        require(source.width > 0 && source.height > 0) { "source dimensions must be positive" }
        require(quad.isValid) { "crop quad is invalid" }
        require(outputWidth > 0 && outputHeight > 0) { "output dimensions must be positive" }

        val sourcePoints = quad.corners.flatMap { point ->
            listOf(point.x * source.width, point.y * source.height)
        }.toFloatArray()
        val destinationPoints = floatArrayOf(
            0f, 0f,
            outputWidth.toFloat(), 0f,
            outputWidth.toFloat(), outputHeight.toFloat(),
            0f, outputHeight.toFloat(),
        )
        val transform = Matrix()
        check(transform.setPolyToPoly(sourcePoints, 0, destinationPoints, 0, 4)) {
            "crop quad could not be perspective transformed"
        }

        return Bitmap.createBitmap(outputWidth, outputHeight, Bitmap.Config.ARGB_8888).also { output ->
            Canvas(output).apply {
                drawColor(Color.BLACK)
                drawBitmap(source, transform, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
            }
        }
    }
}
