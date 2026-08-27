package com.ahmadjalil.tcger.data.scanner.model

import android.content.Context
import java.io.Closeable
import kotlin.system.measureNanoTime

data class ArcFaceRecognitionResult(
    val decision: ArcFaceRecognitionDecision,
    val matches: List<CardEmbeddingMatch>,
    val preprocessMs: Double,
    val inferenceMs: Double,
    val searchMs: Double,
)

/** Real on-device ArcFace inference and exact cosine matching against the bundled catalog index. */
class ArcFaceCardRecognizer private constructor(
    private val encoder: ArcFaceOnnxEncoder,
    private val index: PackedCardEmbeddingIndex,
) : Closeable {
    fun recognize(
        imageBytes: ByteArray,
        candidateLimit: Int = 10,
        setCode: String? = null,
    ): ArcFaceRecognitionResult {
        lateinit var input: FloatArray
        val preprocessNs = measureNanoTime { input = ArcFaceImagePreprocessor.preprocess(imageBytes) }
        lateinit var embedding: FloatArray
        val inferenceNs = measureNanoTime { embedding = encoder.encode(input) }
        lateinit var matches: List<CardEmbeddingMatch>
        val searchNs = measureNanoTime {
            matches = index.nearest(
                query = embedding,
                limit = candidateLimit,
                physicalPokemonOnly = true,
                setCode = setCode,
            )
        }
        return ArcFaceRecognitionResult(
            decision = ArcFaceRecognitionPolicy.decide(matches),
            matches = matches,
            preprocessMs = preprocessNs / 1_000_000.0,
            inferenceMs = inferenceNs / 1_000_000.0,
            searchMs = searchNs / 1_000_000.0,
        )
    }

    override fun close() = encoder.close()

    companion object {
        fun availability(context: Context): ScannerModelAvailability =
            ArcFaceModelBundle.probe(AndroidScannerModelAssetSource(context))

        fun load(context: Context): ArcFaceCardRecognizer {
            val bundle = ArcFaceModelBundle.load(AndroidScannerModelAssetSource(context))
            val index = PackedCardEmbeddingIndex.decode(bundle.vectorBytes, bundle.metadataBytes)
            require(index.count == ArcFaceModelContract.expectedCardCount) {
                "ArcFace index has ${index.count} cards; expected ${ArcFaceModelContract.expectedCardCount}"
            }
            require(index.dimension == ArcFaceModelContract.embeddingDimension) {
                "ArcFace index dimension is ${index.dimension}; expected ${ArcFaceModelContract.embeddingDimension}"
            }
            return ArcFaceCardRecognizer(ArcFaceOnnxEncoder(bundle.modelBytes), index)
        }
    }
}
