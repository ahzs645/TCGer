package com.ahmadjalil.tcger.data.scanner.model

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayInputStream
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/** Resize-shortest-256, center-crop-224, then ImageNet-normalize in RGB NCHW order. */
object DinoV2ImagePreprocessor {
    private val mean = floatArrayOf(0.485f, 0.456f, 0.406f)
    private val standardDeviation = floatArrayOf(0.229f, 0.224f, 0.225f)

    fun preprocess(encodedImage: ByteArray): FloatArray {
        require(encodedImage.isNotEmpty()) { "image is empty" }
        val decoded = BitmapFactory.decodeByteArray(encodedImage, 0, encodedImage.size)
            ?: error("image could not be decoded")
        val oriented = orient(decoded, encodedImage)
        if (oriented !== decoded) decoded.recycle()
        return try { preprocess(oriented) } finally { oriented.recycle() }
    }

    fun preprocess(bitmap: Bitmap): FloatArray {
        require(bitmap.width > 0 && bitmap.height > 0) { "image dimensions must be positive" }
        val size = DinoV2ModelContract.imageSize
        val scale = max(
            DinoV2ModelContract.resizedShortestEdge.toDouble() / min(bitmap.width, bitmap.height),
            max(size.toDouble() / bitmap.width, size.toDouble() / bitmap.height),
        )
        val width = ceil(bitmap.width * scale).toInt()
        val height = ceil(bitmap.height * scale).toInt()
        val resized = Bitmap.createScaledBitmap(bitmap, width, height, true)
        val cropped = Bitmap.createBitmap(resized, (width - size) / 2, (height - size) / 2, size, size)
        if (cropped !== resized) resized.recycle()
        return try {
            val pixels = IntArray(size * size)
            cropped.getPixels(pixels, 0, size, 0, 0, size, size)
            argbToNormalizedChw(pixels)
        } finally {
            cropped.recycle()
        }
    }

    internal fun argbToNormalizedChw(pixels: IntArray): FloatArray {
        val plane = pixels.size
        val output = FloatArray(plane * 3)
        pixels.forEachIndexed { index, pixel ->
            output[index] = (((pixel ushr 16) and 0xff) / 255f - mean[0]) / standardDeviation[0]
            output[plane + index] = (((pixel ushr 8) and 0xff) / 255f - mean[1]) / standardDeviation[1]
            output[2 * plane + index] = ((pixel and 0xff) / 255f - mean[2]) / standardDeviation[2]
        }
        return output
    }

    private fun orient(bitmap: Bitmap, encodedImage: ByteArray): Bitmap {
        val orientation = runCatching {
            ExifInterface(ByteArrayInputStream(encodedImage)).getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL,
            )
        }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.setRotate(-90f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
            else -> return bitmap
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }
}
