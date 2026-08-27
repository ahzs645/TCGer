package com.ahmadjalil.tcger.data.scanner.model

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ArcFaceOnnxRecognitionInstrumentedTest {
    @Test
    fun bundledArcFaceModelSelfRetrievesRayquazaFixture() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        assertEquals(ScannerModelAvailability.Available, ArcFaceCardRecognizer.availability(context))
        val testAssets = InstrumentationRegistry.getInstrumentation().context.assets
        val image = testAssets.open("Rayquaza.imageset/swsh4-188.png").use { it.readBytes() }

        val bundle = ArcFaceModelBundle.load(AndroidScannerModelAssetSource(context))
        val input = ArcFaceImagePreprocessor.preprocess(image)
        ArcFaceOnnxEncoder(bundle.modelBytes).use { encoder ->
            val constantEmbedding = encoder.encode(
                FloatArray(3 * ArcFaceModelContract.imageSize * ArcFaceModelContract.imageSize) { 0.5f },
            )
            assertArrayEquals(
                floatArrayOf(
                    0.04020919f, 0.05117394f, -0.03211651f, -0.05193449f,
                    -0.08012538f, -0.04657637f, -0.08069486f, 0.01107232f,
                    0.01632174f, 0.03753859f, 0.03990198f, -0.03291689f,
                ),
                constantEmbedding.copyOf(12),
                0.0003f,
            )
            val embedding = encoder.encode(input)
            val index = PackedCardEmbeddingIndex.decode(bundle.vectorBytes, bundle.metadataBytes)
            val matches = index.nearest(embedding, limit = 10)
            val decision = ArcFaceRecognitionPolicy.decide(matches)
            val diagnostic = matches.joinToString { "${it.card.cardId}:${"%.5f".format(it.similarity)}" } +
                " inputMean=${input.average()} inputFirst=${input.take(5)} outputFirst=${embedding.take(10)}"
            assertEquals(diagnostic, "swsh4-188", matches.first().card.cardId)
            assertTrue(diagnostic, matches.first().similarity > 0.90)
            assertTrue(diagnostic, decision is ArcFaceRecognitionDecision.Accepted)
        }
    }
}
