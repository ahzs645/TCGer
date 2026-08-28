package com.ahmadjalil.tcger.data.scanner.model

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.Closeable
import java.nio.FloatBuffer
import kotlin.math.sqrt

class ArcFaceOnnxEncoder(
    modelBytes: ByteArray,
    private val embeddingDimension: Int = ArcFaceModelContract.embeddingDimension,
    private val environment: OrtEnvironment = OrtEnvironment.getEnvironment(),
) : Closeable {
    private val sessionOptions = OrtSession.SessionOptions().apply {
        // ORT's documented XNNPACK configuration: XNNPACK owns the compute
        // thread pool and ORT's fallback CPU pool stays single-threaded.
        setIntraOpNumThreads(1)
        addConfigEntry("session.intra_op.allow_spinning", "0")
        addXnnpack(
            mapOf(
                "intra_op_num_threads" to Runtime.getRuntime()
                    .availableProcessors()
                    .coerceAtLeast(1)
                    .toString(),
            ),
        )
    }
    private val session = environment.createSession(modelBytes, sessionOptions)

    init {
        require(ArcFaceModelContract.inputName in session.inputNames) {
            "ArcFace model has inputs ${session.inputNames}; expected ${ArcFaceModelContract.inputName}"
        }
        require(ArcFaceModelContract.outputName in session.outputNames) {
            "ArcFace model has outputs ${session.outputNames}; expected ${ArcFaceModelContract.outputName}"
        }
    }

    @Synchronized
    fun encode(inputChw: FloatArray): FloatArray {
        val expectedValues = 3 * ArcFaceModelContract.imageSize * ArcFaceModelContract.imageSize
        require(inputChw.size == expectedValues) { "model input has ${inputChw.size} values; expected $expectedValues" }
        OnnxTensor.createTensor(
            environment,
            FloatBuffer.wrap(inputChw),
            longArrayOf(1, 3, ArcFaceModelContract.imageSize.toLong(), ArcFaceModelContract.imageSize.toLong()),
        ).use { input ->
            session.run(mapOf(ArcFaceModelContract.inputName to input)).use { outputs ->
                val value = outputs.get(ArcFaceModelContract.outputName)
                    .orElseThrow { IllegalStateException("ArcFace embedding output is missing") }
                    .value
                val embedding = when (value) {
                    is FloatArray -> value.copyOf()
                    is Array<*> -> (value.singleOrNull() as? FloatArray)?.copyOf()
                        ?: error("ArcFace embedding has an unexpected array shape")
                    else -> error("ArcFace embedding has unexpected type ${value::class.java.name}")
                }
                require(embedding.size == embeddingDimension) {
                    "model returned ${embedding.size} values; expected $embeddingDimension"
                }
                return l2Normalize(embedding)
            }
        }
    }

    override fun close() {
        session.close()
        sessionOptions.close()
    }

    private fun l2Normalize(vector: FloatArray): FloatArray {
        val norm = sqrt(vector.fold(0.0) { total, value -> total + value * value })
        require(norm > 0.0 && norm.isFinite()) { "model returned a non-finite or zero embedding" }
        for (index in vector.indices) vector[index] = (vector[index] / norm).toFloat()
        return vector
    }
}
