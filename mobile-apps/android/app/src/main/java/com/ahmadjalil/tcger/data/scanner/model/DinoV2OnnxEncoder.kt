package com.ahmadjalil.tcger.data.scanner.model

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.Closeable
import java.nio.FloatBuffer
import kotlin.math.sqrt

class DinoV2OnnxEncoder(
    modelBytes: ByteArray,
    private val environment: OrtEnvironment = OrtEnvironment.getEnvironment(),
) : Closeable {
    private val options = OrtSession.SessionOptions().apply {
        setIntraOpNumThreads(1)
        addConfigEntry("session.intra_op.allow_spinning", "0")
        addXnnpack(mapOf("intra_op_num_threads" to Runtime.getRuntime().availableProcessors().coerceAtLeast(1).toString()))
    }
    private val session = environment.createSession(modelBytes, options)

    init {
        require(DinoV2ModelContract.inputName in session.inputNames)
        require(DinoV2ModelContract.outputName in session.outputNames)
    }

    @Synchronized
    fun encode(inputChw: FloatArray): FloatArray {
        val size = DinoV2ModelContract.imageSize
        require(inputChw.size == 3 * size * size) { "DINOv2 input has ${inputChw.size} values" }
        OnnxTensor.createTensor(environment, FloatBuffer.wrap(inputChw), longArrayOf(1, 3, size.toLong(), size.toLong())).use { input ->
            session.run(mapOf(DinoV2ModelContract.inputName to input)).use { outputs ->
                val batch = outputs.get(DinoV2ModelContract.outputName).orElseThrow().value as? Array<*>
                    ?: error("DINOv2 output is not a batch")
                val tokens = batch.singleOrNull() as? Array<*>
                    ?: error("DINOv2 output batch shape is unexpected")
                require(tokens.size == DinoV2ModelContract.expectedSequenceLength) {
                    "DINOv2 returned ${tokens.size} tokens"
                }
                val cls = (tokens.firstOrNull() as? FloatArray)?.copyOf()
                    ?: error("DINOv2 CLS token has an unexpected type")
                require(cls.size == DinoV2ModelContract.embeddingDimension)
                val norm = sqrt(cls.fold(0.0) { total, value -> total + value * value })
                require(norm > 0.0 && norm.isFinite())
                cls.indices.forEach { cls[it] = (cls[it] / norm).toFloat() }
                return cls
            }
        }
    }

    override fun close() {
        session.close()
        options.close()
    }
}
