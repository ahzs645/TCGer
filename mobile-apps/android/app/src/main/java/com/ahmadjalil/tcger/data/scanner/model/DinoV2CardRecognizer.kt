package com.ahmadjalil.tcger.data.scanner.model

import android.content.Context
import java.io.Closeable
import kotlin.system.measureNanoTime

data class DinoV2RecognitionResult(
    val decision: DinoV2RecognitionDecision,
    val matches: List<CardEmbeddingMatch>,
    val preprocessMs: Double,
    val inferenceMs: Double,
    val searchMs: Double,
    internal val embedding: FloatArray,
)

/** Exact Android DINOv2 q8 inference, gate scoring, and packed-index search. */
class DinoV2CardRecognizer private constructor(
    private val encoder: DinoV2OnnxEncoder,
    private val index: PackedCardEmbeddingIndex,
    private val gate: DinoV2CardFaceGate,
) : Closeable {
    fun recognize(imageBytes: ByteArray, candidateLimit: Int = 10, setCode: String? = null): DinoV2RecognitionResult {
        lateinit var input: FloatArray
        val preprocessNs = measureNanoTime { input = DinoV2ImagePreprocessor.preprocess(imageBytes) }
        lateinit var embedding: FloatArray
        val inferenceNs = measureNanoTime { embedding = encoder.encode(input) }
        lateinit var matches: List<CardEmbeddingMatch>
        val searchNs = measureNanoTime {
            matches = index.nearest(embedding, candidateLimit, physicalPokemonOnly = true, setCode = setCode)
        }
        return DinoV2RecognitionResult(
            DinoV2RecognitionPolicy.decide(embedding, matches, gate),
            matches,
            preprocessNs / 1_000_000.0,
            inferenceNs / 1_000_000.0,
            searchNs / 1_000_000.0,
            embedding,
        )
    }

    fun rescueManualCapture(
        result: DinoV2RecognitionResult,
        evidence: DinoV2OcrEvidence,
    ): DinoV2OcrRescueDecision = DinoV2ManualOcrRescue.decide(
        evidence = evidence,
        originalMatches = result.matches,
        exactTitleMatches = { normalizedName ->
            index.nearest(
                query = result.embedding,
                limit = 10,
                physicalPokemonOnly = true,
                normalizedCardName = normalizedName,
            ) to index.physicalPokemonCardCount(normalizedName)
        },
    )

    override fun close() = encoder.close()

    companion object {
        fun availability(context: Context): ScannerModelAvailability =
            DinoV2ModelBundle.probe(AndroidScannerModelAssetSource(context))

        fun load(context: Context): DinoV2CardRecognizer {
            val bundle = DinoV2ModelBundle.load(AndroidScannerModelAssetSource(context))
            val index = PackedCardEmbeddingIndex.decode(bundle.vectorBytes, bundle.metadataBytes)
            require(index.count == DinoV2ModelContract.expectedCardCount)
            require(index.dimension == DinoV2ModelContract.embeddingDimension)
            return DinoV2CardRecognizer(
                DinoV2OnnxEncoder(bundle.modelBytes),
                index,
                DinoV2CardFaceGate.decode(bundle.gateBytes),
            )
        }
    }
}
