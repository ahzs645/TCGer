package com.ahmadjalil.tcger.data.scanner

import android.graphics.BitmapFactory
import android.graphics.Bitmap
import com.ahmadjalil.tcger.data.scanner.model.DinoV2OcrEvidence
import com.google.android.gms.tasks.Task
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class OnDeviceCardTextRecognizer {
    suspend fun recognize(imageBytes: ByteArray): String {
        val bitmap = decode(imageBytes)
        return try {
            recognize(bitmap)
        } finally {
            bitmap.recycle()
        }
    }

    /** Accurate title/footer evidence used only for intentional DINOv2 captures. */
    suspend fun recognizeDinoV2Evidence(imageBytes: ByteArray): DinoV2OcrEvidence {
        val bitmap = decode(imageBytes)
        val title = cropAndScale(bitmap, topFraction = 0f, heightFraction = 0.24f, scale = 2f)
        val footer = cropAndScale(bitmap, topFraction = 0.88f, heightFraction = 0.11f, scale = 4f)
        return try {
            val fullText = recognize(bitmap)
            val titleText = recognize(title)
            val footerText = recognize(footer)
            DinoV2OcrEvidence(
                fullText = fullText,
                titleLines = titleText.lineSequence().map(String::trim).filter(String::isNotEmpty).toList(),
                footerText = footerText,
            )
        } finally {
            title.recycle()
            footer.recycle()
            bitmap.recycle()
        }
    }

    private suspend fun decode(imageBytes: ByteArray): Bitmap = withContext(Dispatchers.Default) {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size, bounds)
            var sampleSize = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / sampleSize > MAX_RECOGNITION_DIMENSION) {
                sampleSize *= 2
            }
            requireNotNull(
                BitmapFactory.decodeByteArray(
                    imageBytes,
                    0,
                    imageBytes.size,
                    BitmapFactory.Options().apply { inSampleSize = sampleSize },
                ),
            ) { "The selected image could not be decoded" }
        }

    private suspend fun recognize(bitmap: Bitmap): String {
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        return try {
            recognizer.process(InputImage.fromBitmap(bitmap, 0)).awaitResult().text.trim()
        } finally {
            recognizer.close()
        }
    }

    private fun cropAndScale(bitmap: Bitmap, topFraction: Float, heightFraction: Float, scale: Float): Bitmap {
        val top = (bitmap.height * topFraction).toInt().coerceIn(0, bitmap.height - 1)
        val height = (bitmap.height * heightFraction).toInt().coerceIn(1, bitmap.height - top)
        val strip = Bitmap.createBitmap(bitmap, 0, top, bitmap.width, height)
        val scaled = Bitmap.createScaledBitmap(strip, (strip.width * scale).toInt(), (strip.height * scale).toInt(), true)
        if (scaled !== strip) strip.recycle()
        return scaled
    }

    private companion object {
        const val MAX_RECOGNITION_DIMENSION = 2048
    }
}

private suspend fun <T> Task<T>.awaitResult(): T = suspendCancellableCoroutine { continuation ->
    addOnSuccessListener { if (continuation.isActive) continuation.resume(it) }
    addOnFailureListener { if (continuation.isActive) continuation.resumeWithException(it) }
    addOnCanceledListener { continuation.cancel() }
}
