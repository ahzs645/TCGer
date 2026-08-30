package com.ahmadjalil.tcger.data.scanner.model

import android.content.Context
import java.io.InputStream
import java.security.MessageDigest

/**
 * The model, vector index, metadata, and operating points are one calibrated
 * artifact. Changing any descriptor requires regenerating and validating the
 * whole bundle against the scanner replay corpus.
 */
object ArcFaceModelContract {
    const val inputName = "pixel_values"
    const val outputName = "embedding"
    const val imageSize = 224
    const val resizedShortestEdge = 256
    const val embeddingDimension = 384
    const val expectedCardCount = 21_828
    const val strongAcceptanceScore = 0.65
    const val ambiguityMargin = 0.05

    val model = ScannerModelAsset(
        path = "scan-index/card-embeddings-arcface-fp32.onnx",
        sizeBytes = 15_014_526,
        sha256 = "1f1af50e30c5ce05d8b2964c745afed2c35df0ebb84aa019dc5abd216e0bc43a",
    )
    val vectors = ScannerModelAsset(
        path = "scan-index/CardsIndexVectors-arcface.bin",
        sizeBytes = 8_381_960,
        sha256 = "9c36853fde9c5b8935c28c269dda9467a336d8d961f2eddc565fc9f54b920b55",
    )
    val metadata = ScannerModelAsset(
        path = "scan-index/CardsIndexMetadata.json",
        sizeBytes = 4_314_177,
        sha256 = "e1b4ed3a64f59b0a1970f5c0d8d29dffa746f7cf02959bdb39bdeae2b3718141",
    )
    val assets = listOf(model, vectors, metadata)

    val pokemonRuntime = ArcFaceRuntimeContract(
        game = "pokemon",
        version = "bundled",
        model = model,
        vectors = vectors,
        metadata = metadata,
        expectedCardCount = expectedCardCount,
        embeddingDimension = embeddingDimension,
        strongAcceptanceScore = strongAcceptanceScore,
        ambiguityMargin = ambiguityMargin,
    )
}

data class ScannerModelAsset(
    val path: String,
    val sizeBytes: Long,
    val sha256: String,
)

data class ArcFaceRuntimeContract(
    val game: String,
    val version: String,
    val model: ScannerModelAsset,
    val vectors: ScannerModelAsset,
    val metadata: ScannerModelAsset,
    val expectedCardCount: Int,
    val embeddingDimension: Int,
    val strongAcceptanceScore: Double,
    val ambiguityMargin: Double,
    /**
     * The per-game acceptance policy this runtime scans under: the manifest's
     * declared `acceptancePolicy` when valid, else the built-in profile for
     * [game]. Its operating point takes precedence over the two legacy
     * top-level fields above, which remain for manifests that predate it.
     */
    val acceptancePolicy: ScannerAcceptancePolicy = ScannerAcceptancePolicy.builtin(game),
) {
    val assets: List<ScannerModelAsset> = listOf(model, vectors, metadata)
}

interface ScannerModelAssetSource {
    fun open(path: String): InputStream
}

class AndroidScannerModelAssetSource(context: Context) : ScannerModelAssetSource {
    private val assets = context.applicationContext.assets

    override fun open(path: String): InputStream = assets.open(path)
}

class FileScannerModelAssetSource(private val directory: java.io.File) : ScannerModelAssetSource {
    override fun open(path: String): InputStream = java.io.File(directory, path).inputStream()
}

sealed interface ScannerModelAvailability {
    data object Available : ScannerModelAvailability
    data class Unavailable(val reason: String) : ScannerModelAvailability
}

class ArcFaceModelBundle private constructor(
    val modelBytes: ByteArray,
    val vectorBytes: ByteArray,
    val metadataBytes: ByteArray,
) {
    companion object {
        fun probe(
            source: ScannerModelAssetSource,
            contract: ArcFaceRuntimeContract = ArcFaceModelContract.pokemonRuntime,
        ): ScannerModelAvailability = try {
            contract.assets.forEach { descriptor ->
                source.open(descriptor.path).use { input ->
                    // AssetInputStream.available() reports the uncompressed
                    // asset length without inflating the full model on the UI
                    // thread. load() performs the authoritative digest check.
                    val available = input.available().toLong()
                    require(available == descriptor.sizeBytes) {
                        "${descriptor.path} is $available bytes; expected ${descriptor.sizeBytes}"
                    }
                }
            }
            ScannerModelAvailability.Available
        } catch (error: Exception) {
            ScannerModelAvailability.Unavailable(error.message ?: "ArcFace scanner assets are unavailable")
        }

        fun load(
            source: ScannerModelAssetSource,
            contract: ArcFaceRuntimeContract = ArcFaceModelContract.pokemonRuntime,
        ): ArcFaceModelBundle {
            val loaded = contract.assets.associateWith { descriptor ->
                val bytes = source.open(descriptor.path).use(InputStream::readBytes)
                require(bytes.size.toLong() == descriptor.sizeBytes) {
                    "${descriptor.path} is ${bytes.size} bytes; expected ${descriptor.sizeBytes}"
                }
                val digest = MessageDigest.getInstance("SHA-256")
                    .digest(bytes)
                    .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
                require(digest == descriptor.sha256) {
                    "${descriptor.path} SHA-256 mismatch; refuse to mix scanner artifacts"
                }
                bytes
            }
            return ArcFaceModelBundle(
                modelBytes = loaded.getValue(contract.model),
                vectorBytes = loaded.getValue(contract.vectors),
                metadataBytes = loaded.getValue(contract.metadata),
            )
        }
    }
}
