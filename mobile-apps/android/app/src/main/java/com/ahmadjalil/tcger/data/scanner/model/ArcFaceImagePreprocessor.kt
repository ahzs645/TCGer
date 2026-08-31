package com.ahmadjalil.tcger.data.scanner.model

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayInputStream
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

object ArcFaceImagePreprocessor {
    fun preprocess(
        encodedImage: ByteArray,
        normalization: ScannerAcceptancePolicy.QueryNormalization = ScannerAcceptancePolicy.QueryNormalization.NONE,
    ): FloatArray {
        require(encodedImage.isNotEmpty()) { "image is empty" }
        val decoded = BitmapFactory.decodeByteArray(encodedImage, 0, encodedImage.size)
            ?: error("image could not be decoded")
        val oriented = applyExifOrientation(decoded, encodedImage)
        if (oriented !== decoded) decoded.recycle()
        return try {
            preprocess(oriented, normalization)
        } finally {
            oriented.recycle()
        }
    }

    fun preprocess(
        bitmap: Bitmap,
        normalization: ScannerAcceptancePolicy.QueryNormalization = ScannerAcceptancePolicy.QueryNormalization.NONE,
    ): FloatArray {
        require(bitmap.width > 0 && bitmap.height > 0) { "image dimensions must be positive" }
        if (normalization == ScannerAcceptancePolicy.QueryNormalization.GREY_WORLD_AUTOCONTRAST) {
            // Colour statistics come from the crop the encoder will see, so the
            // normalization precedes the geometric contract.
            val normalized = QueryColorNormalization.normalized(bitmap)
            return try {
                preprocessGeometry(normalized)
            } finally {
                normalized.recycle()
            }
        }
        return preprocessGeometry(bitmap)
    }

    private fun preprocessGeometry(bitmap: Bitmap): FloatArray {
        val size = ArcFaceModelContract.imageSize
        val scale = max(
            ArcFaceModelContract.resizedShortestEdge.toDouble() / min(bitmap.width, bitmap.height),
            max(size.toDouble() / bitmap.width, size.toDouble() / bitmap.height),
        )
        val resizedWidth = ceil(bitmap.width * scale).toInt()
        val resizedHeight = ceil(bitmap.height * scale).toInt()
        val resized = Bitmap.createScaledBitmap(bitmap, resizedWidth, resizedHeight, true)
        val left = (resizedWidth - size) / 2
        val top = (resizedHeight - size) / 2
        val crop = Bitmap.createBitmap(resized, left, top, size, size)
        if (crop !== resized) resized.recycle()
        return try {
            val pixels = IntArray(size * size)
            crop.getPixels(pixels, 0, size, 0, 0, size, size)
            argbToChwUnitFloats(pixels)
        } finally {
            crop.recycle()
        }
    }

    internal fun argbToChwUnitFloats(pixels: IntArray): FloatArray {
        val plane = pixels.size
        val output = FloatArray(plane * 3)
        pixels.forEachIndexed { index, pixel ->
            output[index] = ((pixel ushr 16) and 0xff) / 255f
            output[plane + index] = ((pixel ushr 8) and 0xff) / 255f
            output[2 * plane + index] = (pixel and 0xff) / 255f
        }
        return output
    }

    private fun applyExifOrientation(bitmap: Bitmap, encodedImage: ByteArray): Bitmap {
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
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.setRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.setRotate(-90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
            else -> return bitmap
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }
}
