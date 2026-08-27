package com.ahmadjalil.tcger.data.scanner.model

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.ahmadjalil.tcger.data.scanner.OnDeviceCardTextRecognizer
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DinoV2OnnxRecognitionInstrumentedTest {
    @Test fun bundledDinoModelSelfRetrievesAllFiveDemoCards() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        assertEquals(ScannerModelAvailability.Available, DinoV2CardRecognizer.availability(context))
        val testAssets = InstrumentationRegistry.getInstrumentation().context.assets
        val fixtures = mapOf(
            "BossOrders.imageset/swsh9-132.png" to ("swsh9-132" to true),
            "PokeStop.imageset/pgo-68.png" to ("swsh10.5-068" to true),
            "ProfessorsResearch.imageset/swsh45-60.png" to ("swsh4.5-60" to true),
            // The shipped gate intentionally rejects these two clean fixtures;
            // iOS/host q8 does too. Manual capture can use OCR rescue, while
            // automatic/live capture abstains. Preserve that calibrated behavior.
            "Peonia.imageset/swsh9-167.png" to ("swsh9-167" to false),
            "Rayquaza.imageset/swsh4-188.png" to ("swsh4-188" to false),
        )
        DinoV2CardRecognizer.load(context).use { recognizer ->
            fixtures.forEach { (fixture, expectation) ->
                val (expectedCardId, expectedAccepted) = expectation
                val result = recognizer.recognize(testAssets.open(fixture).use { it.readBytes() })
                val diagnostic = "$fixture ${result.matches.take(3).map { "${it.card.cardId}:${it.similarity}" }} " +
                    "decision=${result.decision} inferenceMs=${result.inferenceMs}"
                assertEquals(diagnostic, expectedCardId, result.matches.first().card.cardId)
                assertTrue(diagnostic, result.matches.first().similarity > 0.88)
                assertEquals(diagnostic, expectedAccepted, result.decision is DinoV2RecognitionDecision.Accepted)
                if (!expectedAccepted) {
                    val evidence = OnDeviceCardTextRecognizer().recognizeDinoV2Evidence(
                        testAssets.open(fixture).use { it.readBytes() },
                    )
                    val rescue = recognizer.rescueManualCapture(result, evidence)
                    assertTrue(
                        "$diagnostic evidence=$evidence rescue=$rescue",
                        rescue is DinoV2OcrRescueDecision.Accepted,
                    )
                    assertEquals(
                        "$diagnostic evidence=$evidence",
                        expectedCardId,
                        (rescue as DinoV2OcrRescueDecision.Accepted).match.card.cardId,
                    )
                }
            }
        }
    }
}
