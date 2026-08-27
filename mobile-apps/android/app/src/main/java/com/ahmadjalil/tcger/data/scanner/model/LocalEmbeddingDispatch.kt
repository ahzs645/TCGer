package com.ahmadjalil.tcger.data.scanner.model

import com.ahmadjalil.tcger.domain.CardScanEncoderVariant
import com.ahmadjalil.tcger.domain.CardScanEngine
import com.ahmadjalil.tcger.domain.CardScanOptions

enum class LocalEmbeddingModel { ARCFACE, DINOV2 }

object LocalEmbeddingDispatch {
    fun select(tcg: String, options: CardScanOptions): LocalEmbeddingModel? {
        if (!tcg.equals("pokemon", ignoreCase = true)) return null
        if (options.engine !in setOf(CardScanEngine.AUTOMATIC, CardScanEngine.ON_DEVICE_OCR)) return null
        return when (options.encoderVariant) {
            CardScanEncoderVariant.ARCFACE -> LocalEmbeddingModel.ARCFACE
            CardScanEncoderVariant.DINOV2 -> LocalEmbeddingModel.DINOV2
        }
    }

    fun permitsManualOcrRescue(options: CardScanOptions): Boolean =
        !options.captureSource.equals("automatic-camera", ignoreCase = true)
}
