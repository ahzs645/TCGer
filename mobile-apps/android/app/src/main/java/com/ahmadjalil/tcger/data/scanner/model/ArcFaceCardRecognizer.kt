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
    /** The declarative per-game policy this runtime scans under. */
    val acceptancePolicy: ScannerAcceptancePolicy get() = contract.acceptancePolicy

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
                strongAcceptanceScore = acceptancePolicy.strongAcceptanceScore,
                ambiguityMargin = acceptancePolicy.ambiguityMargin,
            ),
            matches = matches,
            preprocessMs = preprocessNs / 1_000_000.0,
            inferenceMs = inferenceNs / 1_000_000.0,
            searchMs = searchNs / 1_000_000.0,
            embedding = embedding,
        )
    }

    /** Bounded OCR rescue for an intentional capture the visual policy did
     * not accept, driven by the game's [acceptancePolicy]: a footer collector
     * number confirms an exact printing (searching every printing the family
     * row represents when the scope is FAMILY); an exact catalog-unique title,
     * or an exact title agreeing with the image's own leader, confirms the
     * family from the evidence floor; a one-glyph OCR repair is bounded to an
     * already-strong 0.75+ visual shortlist. OCR never establishes identity
     * from weak or unrelated visual evidence. */
    fun rescueManualCapture(
        result: ArcFaceRecognitionResult,
        evidence: DinoV2OcrEvidence,
    ): DinoV2OcrRescueDecision {
        require(acceptancePolicy.permitsManualOcrRescue) { "OCR rescue is disabled for ${contract.game}" }
        return DinoV2ManualOcrRescue.decide(
            evidence = evidence,
            originalMatches = result.matches,
            exactTitleMatches = { normalizedName ->
                index.nearest(
                    query = result.embedding,
                    limit = 10,
                    physicalPokemonOnly = contract.game == "pokemon",
                    game = contract.game,
                    normalizedCardName = normalizedName,
                ) to index.printingCountForGame(contract.game, normalizedName)
            },
            strongAcceptanceScore = acceptancePolicy.strongAcceptanceScore,
            ambiguityMargin = acceptancePolicy.ambiguityMargin,
            uniqueTitleEvidenceScore = acceptancePolicy.evidenceFloor,
            singleEditVisualFloor = 0.75,
            uniqueTitleRescue = acceptancePolicy.uniqueTitleRescue,
            titleAgreementRescue = acceptancePolicy.titleAgreementRescue,
            collectorNumberScope = acceptancePolicy.collectorNumberScope,
        )
    }

    @Deprecated("Use rescueManualCapture; the policy is declared per game", ReplaceWith("rescueManualCapture(result, evidence)"))
    fun rescueMagicManualCapture(
        result: ArcFaceRecognitionResult,
        evidence: DinoV2OcrEvidence,
    ): DinoV2OcrRescueDecision = rescueManualCapture(result, evidence)

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
