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
    internal val embedding: FloatArray,
)

/** Real on-device ArcFace inference and exact cosine matching against the bundled catalog index. */
class ArcFaceCardRecognizer private constructor(
    private val encoder: ArcFaceOnnxEncoder,
    private val index: PackedCardEmbeddingIndex,
    private val contract: ArcFaceRuntimeContract,
) : Closeable {
    val artifactVersion: String get() = contract.version

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
                physicalPokemonOnly = contract.game == "pokemon",
                game = contract.game,
                setCode = setCode,
            )
        }
        return ArcFaceRecognitionResult(
            decision = ArcFaceRecognitionPolicy.decide(
                matches,
                strongAcceptanceScore = contract.strongAcceptanceScore,
                ambiguityMargin = contract.ambiguityMargin,
            ),
            matches = matches,
            preprocessMs = preprocessNs / 1_000_000.0,
            inferenceMs = inferenceNs / 1_000_000.0,
            searchMs = searchNs / 1_000_000.0,
            embedding = embedding,
        )
    }

    /** Magic's intentional-capture policy: exact unique title evidence may
     * rescue a 0.55+ visual neighbor; a one-glyph OCR repair is bounded to an
     * already-strong 0.75+ visual shortlist. Other games retain their current
     * calibrated acceptance behavior until they have equivalent replay data. */
    fun rescueMagicManualCapture(
        result: ArcFaceRecognitionResult,
        evidence: DinoV2OcrEvidence,
    ): DinoV2OcrRescueDecision {
        require(contract.game == "magic") { "Magic OCR rescue requires a Magic runtime" }
        return DinoV2ManualOcrRescue.decide(
            evidence = evidence,
            originalMatches = result.matches,
            exactTitleMatches = { normalizedName ->
                index.nearest(
                    query = result.embedding,
                    limit = 10,
                    physicalPokemonOnly = false,
                    game = contract.game,
                    normalizedCardName = normalizedName,
                ) to index.printingCountForGame(contract.game, normalizedName)
            },
            strongAcceptanceScore = contract.strongAcceptanceScore,
            ambiguityMargin = contract.ambiguityMargin,
            uniqueTitleEvidenceScore = 0.55,
            singleEditVisualFloor = 0.75,
        )
    }

    override fun close() = encoder.close()

    companion object {
        fun availability(context: Context): ScannerModelAvailability =
            ArcFaceModelBundle.probe(AndroidScannerModelAssetSource(context))

        fun availability(
            context: Context,
            game: String,
            assetStore: ScannerAssetStore,
        ): ScannerModelAvailability {
            val normalized = normalizeScannerGame(game)
            val runtime = assetStore.installedRuntime(normalized)
            if (runtime == null) {
                return ScannerModelAvailability.Unavailable("Install the $normalized scanner model in Settings")
            }
            return ArcFaceModelBundle.probe(runtime.source, runtime.contract)
        }

        fun load(
            context: Context,
            game: String = "pokemon",
            assetStore: ScannerAssetStore? = null,
        ): ArcFaceCardRecognizer {
            val normalized = normalizeScannerGame(game)
            val runtime = requireNotNull(assetStore?.installedRuntime(normalized)) {
                "Install the ${normalized.replaceFirstChar(Char::uppercase)} offline scanner model first"
            }
            val contract = runtime.contract
            val bundle = ArcFaceModelBundle.load(runtime.source, contract)
            val index = PackedCardEmbeddingIndex.decode(bundle.vectorBytes, bundle.metadataBytes)
            require(index.count == contract.expectedCardCount) {
                "ArcFace index has ${index.count} cards; expected ${contract.expectedCardCount}"
            }
            require(index.dimension == contract.embeddingDimension) {
                "ArcFace index dimension is ${index.dimension}; expected ${contract.embeddingDimension}"
            }
            require(index.cardCountForGame(contract.game) == contract.expectedCardCount) {
                "ArcFace metadata contains cards outside ${contract.game}"
            }
            return ArcFaceCardRecognizer(
                ArcFaceOnnxEncoder(bundle.modelBytes, contract.embeddingDimension),
                index,
                contract,
            )
        }
    }
}
