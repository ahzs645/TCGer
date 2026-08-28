package com.ahmadjalil.tcger.data.scanner.model

import com.ahmadjalil.tcger.domain.CardScanEncoderVariant
import com.ahmadjalil.tcger.domain.CardScanEngine
import com.ahmadjalil.tcger.domain.CardScanOptions

enum class LocalEmbeddingModel { ARCFACE, DINOV2 }

object LocalEmbeddingDispatch {
    fun select(tcg: String, options: CardScanOptions): LocalEmbeddingModel? {
        if (options.engine !in setOf(CardScanEngine.AUTOMATIC, CardScanEngine.ON_DEVICE_OCR)) return null
        return when (normalizeScannerGame(tcg)) {
            "pokemon" -> when (options.encoderVariant) {
                CardScanEncoderVariant.ARCFACE -> LocalEmbeddingModel.ARCFACE
                CardScanEncoderVariant.DINOV2 -> LocalEmbeddingModel.DINOV2
            }
            // Downloaded game-specific models are selected explicitly by the
            // scanner mode. They are never treated as a cross-game classifier
            // or as a DINOv2 fallback.
            "magic", "yugioh" -> LocalEmbeddingModel.ARCFACE.takeIf {
                options.encoderVariant == CardScanEncoderVariant.ARCFACE
            }
            else -> null
        }
    }

    fun permitsManualOcrRescue(options: CardScanOptions): Boolean =
        !options.captureSource.equals("automatic-camera", ignoreCase = true)
}
