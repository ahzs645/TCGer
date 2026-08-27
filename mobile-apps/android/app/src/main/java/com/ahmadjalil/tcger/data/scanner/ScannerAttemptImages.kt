package com.ahmadjalil.tcger.data.scanner

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File
import java.io.FileOutputStream
import kotlinx.serialization.Serializable

@Serializable
enum class ScannerAttemptImageKind { ORIGINAL, CARD_CROP }

@Serializable
data class ScannerAttemptImageReference(
    val fileName: String,
    val kind: ScannerAttemptImageKind,
    val width: Int,
    val height: Int,
    val normalizedQuad: List<List<Double>>? = null,
)

data class ScannerCropRect(val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val width: Int get() = right - left
    val height: Int get() = bottom - top

    fun normalized(imageWidth: Int, imageHeight: Int): List<List<Double>> = listOf(
        listOf(left.toDouble() / imageWidth, top.toDouble() / imageHeight),
        listOf(right.toDouble() / imageWidth, top.toDouble() / imageHeight),
        listOf(right.toDouble() / imageWidth, bottom.toDouble() / imageHeight),
        listOf(left.toDouble() / imageWidth, bottom.toDouble() / imageHeight),
    )
}

internal fun canonicalScannerCrop(width: Int, height: Int): ScannerCropRect {
    require(width > 0 && height > 0)
    val targetAspect = 0.714
    var cropWidth = (width * 0.68).toInt().coerceAtLeast(1)
    var cropHeight = (cropWidth / targetAspect).toInt().coerceAtLeast(1)
    val maxHeight = (height * 0.90).toInt().coerceAtLeast(1)
    if (cropHeight > maxHeight) {
        cropHeight = maxHeight
        cropWidth = (cropHeight * targetAspect).toInt().coerceAtLeast(1)
    }
    cropWidth = cropWidth.coerceAtMost(width)
    cropHeight = cropHeight.coerceAtMost(height)
    val left = (width - cropWidth) / 2
    val top = (height - cropHeight) / 2
    return ScannerCropRect(left, top, left + cropWidth, top + cropHeight)
}

/** Retains exact attempt JPEGs plus the deterministic crop represented by the live guide. */
class ScannerAttemptImageStore(context: Context) {
    private val directory = File(context.applicationContext.filesDir, "scanner-attempt-images").apply { mkdirs() }

    fun retain(sessionId: String, captureId: String, jpegBytes: ByteArray): List<ScannerAttemptImageReference> {
        require(ScannerRecordingSessionStore.validId(sessionId)) { "Invalid attempt-image session id" }
        require(ScannerRecordingSessionStore.validId(captureId)) { "Invalid attempt-image capture id" }
        require(jpegBytes.isNotEmpty() && jpegBytes.size <= MAX_SINGLE_IMAGE_BYTES) { "Invalid attempt JPEG size" }
        val bitmap = BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size)
            ?: error("The attempt image is not a decodable bitmap")
        try {
            val sessionDirectory = File(directory, sessionId).apply { mkdirs() }
            val originalName = "$sessionId/$captureId-original.jpg"
            File(sessionDirectory, "$captureId-original.jpg").writeBytes(jpegBytes)
            val cropRect = canonicalScannerCrop(bitmap.width, bitmap.height)
            val crop = Bitmap.createBitmap(bitmap, cropRect.left, cropRect.top, cropRect.width, cropRect.height)
            try {
                val cropName = "$sessionId/$captureId-card-crop.jpg"
                FileOutputStream(File(sessionDirectory, "$captureId-card-crop.jpg")).use { output ->
                    check(crop.compress(Bitmap.CompressFormat.JPEG, 90, output)) { "Could not encode attempt crop" }
                }
                prune()
                return listOf(
                    ScannerAttemptImageReference(originalName, ScannerAttemptImageKind.ORIGINAL, bitmap.width, bitmap.height),
                    ScannerAttemptImageReference(
                        cropName,
                        ScannerAttemptImageKind.CARD_CROP,
                        crop.width,
                        crop.height,
                        cropRect.normalized(bitmap.width, bitmap.height),
                    ),
                )
            } finally {
                crop.recycle()
            }
        } finally {
            bitmap.recycle()
        }
    }

    fun read(fileName: String): ByteArray? {
        val file = resolve(fileName) ?: return null
        return file.takeIf(File::isFile)?.readBytes()
    }

    fun delete(references: Collection<ScannerAttemptImageReference>) {
        references.mapNotNull { resolve(it.fileName) }.forEach(File::delete)
    }

    private fun resolve(fileName: String): File? {
        if (!validRelativeName(fileName)) return null
        val candidate = File(directory, fileName)
        return candidate.takeIf { it.canonicalPath.startsWith(directory.canonicalPath + File.separator) }
    }

    private fun prune() {
        val files = directory.walkTopDown().filter(File::isFile).sortedByDescending(File::lastModified).toList()
        var bytes = 0L
        files.forEachIndexed { index, file ->
            bytes += file.length()
            if (index >= MAX_FILES || bytes > MAX_TOTAL_BYTES) file.delete()
        }
        directory.walkBottomUp().filter { it.isDirectory && it != directory && it.list().isNullOrEmpty() }.forEach(File::delete)
    }

    companion object {
        private const val MAX_FILES = 800
        private const val MAX_SINGLE_IMAGE_BYTES = 25 * 1024 * 1024
        private const val MAX_TOTAL_BYTES = 300L * 1024 * 1024
        internal fun validRelativeName(name: String): Boolean =
            name.length in 3..240 && !name.startsWith('/') && name.split('/').all {
                ScannerRecordingSessionStore.validId(it.substringBeforeLast('.')) &&
                    ('.' !in it || it.endsWith(".jpg"))
            }
    }
}
