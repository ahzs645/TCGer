package com.ahmadjalil.tcger.data.scanner

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
enum class ScannerCaptureMode(val displayName: String) {
    CARD("Card"),
    BINDER("Binder"),
}

@Serializable
enum class ScannerTriggerMode(val displayName: String) {
    MANUAL("Tap Shutter"),
    AUTOMATIC("Auto-scan"),
}

@Serializable
enum class ScannerRecognitionEngine(
    val displayName: String,
    val description: String,
    val transportValue: String,
) {
    AUTOMATIC(
        "Automatic",
        "Use the best available Android path and fall back to on-device title OCR.",
        "automatic",
    ),
    SERVER_PHASH(
        "Server pHash",
        "Send the capture to the server perceptual-hash matcher.",
        "phash",
    ),
    SERVER_EMBEDDING(
        "Server Embedding",
        "Send the capture to the server embedding matcher.",
        "embedding",
    ),
    ON_DEVICE_OCR(
        "On-Device",
        "Use the selected local embedding model, then fall back to bundled title OCR.",
        "on_device_ocr",
    ),
}

@Serializable
enum class ScannerEncoderVariant(val displayName: String) {
    ARCFACE("TCGer ArcFace (default)"),
    DINOV2("DINOv2 (original)"),
}

@Serializable
enum class ScannerPriceMode(val displayName: String) {
    OFF("Off"),
    SESSION_MARKET("Session market prices"),
}

@Serializable
enum class ScannerPrintingMode(val displayName: String, val description: String) {
    QUICK_LATEST(
        "Quick Scan",
        "Use verified print details when available; otherwise choose the newest compatible printing in the matched artwork family.",
    ),
    EXACT_PRINTING(
        "Exact Printing",
        "Never guess among visually identical printings. Ask you to choose when printed details cannot decide.",
    ),
}

@Serializable
enum class ScannerPerformanceOption(
    val displayName: String,
    val defaultEnabled: Boolean,
) {
    VECTORIZED_ANN("Fast Index Search", true),
    STAGED_HYPOTHESES("Staged Crop Retries", true),
    ALLOWED_INDEX_CACHE("Cache Search Scope", true),
    CONCURRENT_ORIENTATIONS("Parallel Orientation Check", true),
    BATCHED_ORIENTATION("Batched Orientation Check", false),
    WARM_START("Preload Scanner Models", true),
    FAST_CAPTURE("Fast Shutter Capture", true),
    FAST_FOOTER_OCR("Fast Footer OCR", true),
    LEAN_OCR_STRIPS("Lean OCR Strips", true),
    FOOTER_FIRST_OCR("Footer-First OCR", true),
}

@Serializable
data class ScannerSessionOptions(
    val captureMode: ScannerCaptureMode = ScannerCaptureMode.CARD,
    val triggerMode: ScannerTriggerMode = ScannerTriggerMode.MANUAL,
    val automaticallyShowResults: Boolean = false,
    val priceMode: ScannerPriceMode = ScannerPriceMode.OFF,
    val printingMode: ScannerPrintingMode = ScannerPrintingMode.QUICK_LATEST,
    val ocrEnabled: Boolean = true,
    val savesBinderPageImages: Boolean = false,
    val replacesBinderPageImages: Boolean = true,
    val binderPageNumber: Int = 1,
    val language: String = "English",
    val sharedSessionCode: String = "",
    val recognitionEngine: ScannerRecognitionEngine = ScannerRecognitionEngine.AUTOMATIC,
    val encoderVariant: ScannerEncoderVariant = ScannerEncoderVariant.ARCFACE,
    val saveServerDebugCapture: Boolean = false,
    val captureNotes: String = "",
    val testingToolsEnabled: Boolean = false,
    val devModeRecordingEnabled: Boolean = false,
    val recordAttemptImages: Boolean = false,
    val cropRescueEnabled: Boolean = false,
    val analysisIntervalMillis: Long = 700,
    val performance: Map<ScannerPerformanceOption, Boolean> = ScannerPerformanceOption.entries
        .associateWith(ScannerPerformanceOption::defaultEnabled),
)

data class AndroidScannerRequest(
    val imageBytes: ByteArray,
    val game: String,
    val options: ScannerSessionOptions,
    val debugCapture: ScannerDebugCaptureMetadata,
)

fun interface AndroidScannerRequestHandler {
    fun scan(request: AndroidScannerRequest)
}

/** Production scanner boundary for guided multi-capture flows that need each result independently. */
fun interface AndroidScannerResultRequestHandler {
    fun scan(request: AndroidScannerRequest, completion: (Result<com.ahmadjalil.tcger.domain.CardScanResult>) -> Unit)
}

object ScannerOptionsJson {
    private val codec = Json { encodeDefaults = true; ignoreUnknownKeys = true; prettyPrint = true }

    fun encode(options: ScannerSessionOptions): String = codec.encodeToString(options)
    fun decode(json: String): ScannerSessionOptions = codec.decodeFromString(json)
}

class ScannerOptionsStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun load(): ScannerSessionOptions = preferences.getString(KEY, null)
        ?.let { runCatching { ScannerOptionsJson.decode(it) }.getOrNull() }
        ?: ScannerSessionOptions()

    fun save(options: ScannerSessionOptions) {
        preferences.edit().putString(KEY, ScannerOptionsJson.encode(options)).apply()
    }

    fun loadLastSelectedGame(): String? = preferences.getString(LAST_SELECTED_GAME_KEY, null)

    fun saveLastSelectedGame(game: String) {
        preferences.edit().putString(LAST_SELECTED_GAME_KEY, game).apply()
    }

    companion object {
        private const val FILE = "scanner-options"
        private const val KEY = "session-options-json"
        private const val LAST_SELECTED_GAME_KEY = "last-selected-game"
    }
}

data class ScannerGameChoiceResolution(
    val selectedGame: String? = null,
    val choices: List<String> = emptyList(),
) {
    val requiresChoice: Boolean get() = selectedGame == null && choices.size > 1
}

fun resolveScannerGameChoice(
    availableGames: List<String>,
    requestedGame: String? = null,
): ScannerGameChoiceResolution {
    val games = availableGames.distinct()
    if (requestedGame != null && requestedGame in games) {
        return ScannerGameChoiceResolution(selectedGame = requestedGame)
    }
    return when (games.size) {
        0 -> ScannerGameChoiceResolution()
        1 -> ScannerGameChoiceResolution(selectedGame = games.single())
        else -> ScannerGameChoiceResolution(choices = games)
    }
}

enum class ScannerCapabilityStatus { AVAILABLE, UNAVAILABLE, NOT_APPLICABLE }

data class ScannerCapability(
    val status: ScannerCapabilityStatus,
    val explanation: String,
) {
    val isAvailable: Boolean get() = status == ScannerCapabilityStatus.AVAILABLE
}

/**
 * Truthful runtime inventory. Encoder options become selectable only after
 * their complete checksum-validated Android bundles are present.
 */
data class AndroidScannerCapabilities(
    val serverConfigured: Boolean,
    val priceLookupAvailable: Boolean = false,
    val binderPageDetectorAvailable: Boolean = false,
    val automaticPreviewAnalysisAvailable: Boolean = true,
    val arcFaceRuntimeAvailable: Boolean = false,
    val dinoV2RuntimeAvailable: Boolean = false,
    /** True only when ScannerWarmStartCoordinator owns the same reusable instance as production recognition. */
    val warmStartBoundaryAvailable: Boolean = false,
) {
    fun engine(engine: ScannerRecognitionEngine, game: String): ScannerCapability = when (engine) {
        ScannerRecognitionEngine.AUTOMATIC -> ScannerCapability(
            ScannerCapabilityStatus.AVAILABLE,
            when {
                arcFaceRuntimeAvailable && serverConfigured -> "On-device ArcFace first, then server matching and title OCR fallback."
                arcFaceRuntimeAvailable -> "On-device ArcFace with title OCR fallback."
                serverConfigured -> "Server image matching with on-device title OCR fallback."
                else -> "On-device title OCR; configure a server or install ArcFace for artwork matching."
            },
        )
        ScannerRecognitionEngine.SERVER_PHASH -> serverCapability("Server pHash requires a configured server.")
        ScannerRecognitionEngine.SERVER_EMBEDDING -> when {
            game.normalizedGame() != "pokemon" -> ScannerCapability(
                ScannerCapabilityStatus.UNAVAILABLE,
                "The server embedding matcher currently supports Pokémon only.",
            )
            else -> serverCapability("Server embedding requires a configured server.")
        }
        ScannerRecognitionEngine.ON_DEVICE_OCR -> ScannerCapability(
            ScannerCapabilityStatus.AVAILABLE,
            if (arcFaceRuntimeAvailable) {
                "Bundled ArcFace artwork matching with Latin-script title OCR fallback runs offline."
            } else {
                "Bundled Latin-script title OCR runs offline; install the ArcFace bundle for artwork matching."
            },
        )
    }

    fun encoder(variant: ScannerEncoderVariant): ScannerCapability {
        val available = when (variant) {
            ScannerEncoderVariant.ARCFACE -> arcFaceRuntimeAvailable
            ScannerEncoderVariant.DINOV2 -> dinoV2RuntimeAvailable
        }
        return if (available) {
            ScannerCapability(
                ScannerCapabilityStatus.AVAILABLE,
                when (variant) {
                    ScannerEncoderVariant.ARCFACE -> "Android ArcFace model and calibrated index are installed."
                    ScannerEncoderVariant.DINOV2 -> "Android DINOv2 model, index, gate, and manual OCR rescue are installed."
                },
            )
        } else {
            ScannerCapability(
                ScannerCapabilityStatus.UNAVAILABLE,
                "iOS model name shown for parity; no compatible Android model/index is bundled, so it will not run.",
            )
        }
    }

    fun captureMode(mode: ScannerCaptureMode): ScannerCapability = when (mode) {
        ScannerCaptureMode.CARD -> ScannerCapability(ScannerCapabilityStatus.AVAILABLE, "Single-card capture is available.")
        ScannerCaptureMode.BINDER -> ScannerCapability(
            if (binderPageDetectorAvailable) ScannerCapabilityStatus.AVAILABLE else ScannerCapabilityStatus.UNAVAILABLE,
            if (binderPageDetectorAvailable) {
                "Guided page corners and deterministic 3×3 pocket extraction are available."
            } else {
                "Binder mode is represented for parity, but Android guided page capture is not installed."
            },
        )
    }

    fun trigger(mode: ScannerTriggerMode): ScannerCapability = when (mode) {
        ScannerTriggerMode.MANUAL -> ScannerCapability(ScannerCapabilityStatus.AVAILABLE, "Tap the shutter to analyze a frame.")
        ScannerTriggerMode.AUTOMATIC -> ScannerCapability(
            if (automaticPreviewAnalysisAvailable) ScannerCapabilityStatus.AVAILABLE else ScannerCapabilityStatus.UNAVAILABLE,
            if (automaticPreviewAnalysisAvailable) "Bounded CameraX captures require two stable matches before confirmation." else "Automatic preview analysis is not connected on Android yet.",
        )
    }

    fun price(mode: ScannerPriceMode): ScannerCapability = when (mode) {
        ScannerPriceMode.OFF -> ScannerCapability(ScannerCapabilityStatus.AVAILABLE, "Pricing is hidden.")
        ScannerPriceMode.SESSION_MARKET -> ScannerCapability(
            if (priceLookupAvailable) ScannerCapabilityStatus.AVAILABLE else ScannerCapabilityStatus.UNAVAILABLE,
            if (priceLookupAvailable) "Market prices and the running total are available." else "No Android scanner price provider is configured.",
        )
    }

    fun performance(option: ScannerPerformanceOption): ScannerCapability = when (option) {
        ScannerPerformanceOption.FAST_CAPTURE -> ScannerCapability(
            ScannerCapabilityStatus.AVAILABLE,
            "Controls CameraX capture latency preference.",
        )
        ScannerPerformanceOption.WARM_START -> ScannerCapability(
            if (warmStartBoundaryAvailable) ScannerCapabilityStatus.AVAILABLE else ScannerCapabilityStatus.NOT_APPLICABLE,
            if (warmStartBoundaryAvailable) {
                "Prepares the shared production recognizer through Android's single-flight warm-start boundary."
            } else {
                "Requires the production recognizer owner to provide a shared-instance warm-start boundary."
            },
        )
        ScannerPerformanceOption.FAST_FOOTER_OCR,
        ScannerPerformanceOption.LEAN_OCR_STRIPS,
        ScannerPerformanceOption.FOOTER_FIRST_OCR,
        -> ScannerCapability(
            ScannerCapabilityStatus.NOT_APPLICABLE,
            "Android currently exposes one full-image ML Kit OCR pass; no separate footer/title decision boundary exists.",
        )
        ScannerPerformanceOption.VECTORIZED_ANN,
        ScannerPerformanceOption.STAGED_HYPOTHESES,
        ScannerPerformanceOption.ALLOWED_INDEX_CACHE,
        ScannerPerformanceOption.CONCURRENT_ORIENTATIONS,
        ScannerPerformanceOption.BATCHED_ORIENTATION,
        -> ScannerCapability(
            ScannerCapabilityStatus.NOT_APPLICABLE,
            "The current Android recognizer does not expose this internal strategy for runtime switching.",
        )
    }

    fun normalize(options: ScannerSessionOptions, game: String): ScannerSessionOptions {
        val captureMode = options.captureMode.takeIf { captureMode(it).isAvailable } ?: ScannerCaptureMode.CARD
        val triggerMode = if (captureMode == ScannerCaptureMode.BINDER) {
            ScannerTriggerMode.MANUAL
        } else {
            options.triggerMode.takeIf { trigger(it).isAvailable } ?: ScannerTriggerMode.MANUAL
        }
        val recognitionEngine = options.recognitionEngine.takeIf { engine(it, game).isAvailable }
            ?: ScannerRecognitionEngine.AUTOMATIC
        val priceMode = options.priceMode.takeIf { price(it).isAvailable } ?: ScannerPriceMode.OFF
        val encoderVariant = options.encoderVariant.takeIf { encoder(it).isAvailable }
            ?: ScannerEncoderVariant.entries.firstOrNull { encoder(it).isAvailable }
            ?: ScannerEncoderVariant.ARCFACE
        return options.copy(
            captureMode = captureMode,
            triggerMode = triggerMode,
            recognitionEngine = recognitionEngine,
            encoderVariant = encoderVariant,
            priceMode = priceMode,
            language = options.language.takeIf(scannerLanguages::contains) ?: scannerLanguages.first(),
        )
    }

    private fun serverCapability(unavailableMessage: String) = ScannerCapability(
        if (serverConfigured) ScannerCapabilityStatus.AVAILABLE else ScannerCapabilityStatus.UNAVAILABLE,
        if (serverConfigured) "Available through the configured scanner server." else unavailableMessage,
    )

    companion object {
        val OnDeviceOnly = AndroidScannerCapabilities(serverConfigured = false)
    }
}

/** Dev-mode recordings are training artifacts, so they always retain the production input JPEG. */
fun ScannerSessionOptions.withRequiredTrainingEvidence(): ScannerSessionOptions =
    if (devModeRecordingEnabled && !recordAttemptImages) copy(recordAttemptImages = true) else this

val scannerLanguages = listOf(
    "English", "Japanese", "German", "French", "Italian", "Spanish", "Portuguese", "Korean", "Chinese",
)

private fun String.normalizedGame(): String = when (lowercase()) {
    "mtg", "magic-the-gathering" -> "magic"
    "yu-gi-oh", "yu-gi-oh!" -> "yugioh"
    else -> lowercase()
}
