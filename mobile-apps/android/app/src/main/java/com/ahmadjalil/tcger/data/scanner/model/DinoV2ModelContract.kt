package com.ahmadjalil.tcger.data.scanner.model

import java.io.InputStream
import java.security.MessageDigest

/** Atomic model/index/gate contract for the legacy DINOv2 rollback recognizer. */
object DinoV2ModelContract {
    const val inputName = "pixel_values"
    const val outputName = "last_hidden_state"
    const val imageSize = 224
    const val resizedShortestEdge = 256
    const val embeddingDimension = 384
    const val expectedSequenceLength = 257
    const val expectedCardCount = 21_828
    const val strongAcceptanceScore = 0.72
    const val ambiguityMargin = 0.02

    // Transformers.js dtype=q8 resolves to onnx/model_quantized.onnx.
    // Hub repository revision: 8b1f705a3a7f6f062f6bdd21986c1583d3ef105d.
    val model = ScannerModelAsset(
        path = "scan-index/card-embeddings-dinov2-q8.onnx",
        sizeBytes = 24_446_700,
        sha256 = "c179f8f7f592449c4c1bca4cd124a7538021428c5ffb89afde9503935b197efb",
    )
    val vectors = ScannerModelAsset(
        path = "scan-index/CardsIndexVectors.bin",
        sizeBytes = 8_381_960,
        sha256 = "68cf8412dc98afd3b0011bca8f9c2c4f4cb1bdb21061a2738c96c6cd61ffa729",
    )
    val gate = ScannerModelAsset(
        path = "scan-index/CardFaceGate.json",
        sizeBytes = 20_899,
        sha256 = "75721dd3f97b69c681338a48c8e70a36c51771a80b2e35a77d230d9d6ee0a41e",
    )
    val metadata = ArcFaceModelContract.metadata
    val assets = listOf(model, vectors, gate, metadata)
}

class DinoV2ModelBundle private constructor(
    val modelBytes: ByteArray,
    val vectorBytes: ByteArray,
    val gateBytes: ByteArray,
    val metadataBytes: ByteArray,
) {
    companion object {
        fun probe(source: ScannerModelAssetSource): ScannerModelAvailability = try {
            DinoV2ModelContract.assets.forEach { descriptor ->
                source.open(descriptor.path).use { input ->
                    require(input.available().toLong() == descriptor.sizeBytes) {
                        "${descriptor.path} is ${input.available()} bytes; expected ${descriptor.sizeBytes}"
                    }
                }
            }
            ScannerModelAvailability.Available
        } catch (error: Exception) {
            ScannerModelAvailability.Unavailable(error.message ?: "DINOv2 scanner assets are unavailable")
        }

        fun load(source: ScannerModelAssetSource): DinoV2ModelBundle {
            val loaded = DinoV2ModelContract.assets.associateWith { descriptor -> verified(source, descriptor) }
            return DinoV2ModelBundle(
                loaded.getValue(DinoV2ModelContract.model),
                loaded.getValue(DinoV2ModelContract.vectors),
                loaded.getValue(DinoV2ModelContract.gate),
                loaded.getValue(DinoV2ModelContract.metadata),
            )
        }

        private fun verified(source: ScannerModelAssetSource, descriptor: ScannerModelAsset): ByteArray {
            val bytes = source.open(descriptor.path).use(InputStream::readBytes)
            require(bytes.size.toLong() == descriptor.sizeBytes) {
                "${descriptor.path} is ${bytes.size} bytes; expected ${descriptor.sizeBytes}"
            }
            val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
                .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
            require(digest == descriptor.sha256) {
                "${descriptor.path} SHA-256 mismatch; refuse to mix scanner artifacts"
            }
            return bytes
        }
    }
}
