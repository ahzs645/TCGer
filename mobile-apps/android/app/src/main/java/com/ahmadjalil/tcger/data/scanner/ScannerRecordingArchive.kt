package com.ahmadjalil.tcger.data.scanner

import java.util.Base64
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

private const val PORTABLE_SCANNER_RECORDING_FORMAT = "tcger-android-scanner-archive-v1"

@Serializable
private data class PortableScannerRecording(
    val format: String = PORTABLE_SCANNER_RECORDING_FORMAT,
    val recording: ScannerRecordingBundle,
    val images: Map<String, String> = emptyMap(),
)

data class ImportedScannerRecording(
    val recording: ScannerRecordingBundle,
    val images: Map<String, ByteArray>,
) {
    fun originalBytes(frame: RecordedScannerFrame): ByteArray? {
        val name = frame.attemptImages.firstOrNull { it.kind == ScannerAttemptImageKind.ORIGINAL }?.fileName
            ?: frame.imageFile.takeIf(String::isNotBlank)
        return name?.let(images::get)
    }

    val replayableFrameCount: Int get() = recording.frames.count { originalBytes(it) != null }
}

object ScannerRecordingArchiveJson {
    fun encode(bundle: ScannerRecordingBundle, imageLoader: (String) -> ByteArray?): String {
        require(bundle.formatVersion == 1) { "Unsupported scanner recording version" }
        val names = bundle.frames.flatMap(RecordedScannerFrame::attemptImages).map(ScannerAttemptImageReference::fileName).distinct()
        require(names.size <= MAX_IMAGES) { "Too many attempt images to export" }
        var total = 0L
        val images = names.associateWith { name ->
            require(ScannerAttemptImageStore.validRelativeName(name)) { "Invalid attempt image reference" }
            val bytes = requireNotNull(imageLoader(name)) { "A retained attempt image is missing: $name" }
            total += bytes.size
            require(total <= MAX_IMAGE_BYTES) { "Attempt image archive is too large" }
            Base64.getEncoder().encodeToString(bytes)
        }
        return ScannerRecordingJson.codec.encodeToString(PortableScannerRecording(recording = bundle, images = images))
    }

    fun decode(json: String): ImportedScannerRecording {
        val portable = runCatching { ScannerRecordingJson.codec.decodeFromString<PortableScannerRecording>(json) }.getOrNull()
        if (portable == null) {
            val recording = ScannerRecordingJson.decode(json)
            require(recording.formatVersion == 1) { "Unsupported scanner recording version" }
            return ImportedScannerRecording(recording, emptyMap())
        }
        require(portable.format == PORTABLE_SCANNER_RECORDING_FORMAT) { "Unsupported scanner recording archive" }
        require(portable.recording.formatVersion == 1) { "Unsupported scanner recording version" }
        require(portable.images.size <= MAX_IMAGES) { "Too many attempt images in archive" }
        require(portable.images.keys.all(ScannerAttemptImageStore::validRelativeName)) { "Invalid attempt image reference" }
        require(portable.images.values.sumOf { it.length.toLong() } <= MAX_BASE64_CHARS) { "Attempt image archive is too large" }
        var total = 0L
        val decoded = portable.images.mapValues { (_, value) ->
            Base64.getDecoder().decode(value).also {
                total += it.size
                require(total <= MAX_IMAGE_BYTES) { "Attempt image archive is too large" }
            }
        }
        return ImportedScannerRecording(portable.recording, decoded)
    }

    private const val MAX_IMAGES = 800
    private const val MAX_IMAGE_BYTES = 300L * 1024 * 1024
    private const val MAX_BASE64_CHARS = 420L * 1024 * 1024
}
