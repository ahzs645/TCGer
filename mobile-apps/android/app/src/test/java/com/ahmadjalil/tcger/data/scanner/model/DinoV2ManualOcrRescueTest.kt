package com.ahmadjalil.tcger.data.scanner.model

import com.ahmadjalil.tcger.domain.CardScanEncoderVariant
import com.ahmadjalil.tcger.domain.CardScanEngine
import com.ahmadjalil.tcger.domain.CardScanOptions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DinoV2ManualOcrRescueTest {
    @Test fun exactTitleAndStrongEmbeddingRescueKnownGateFalseNegatives() {
        val barry = match("swsh9-167", "Barry", 0.9708)
        val pikachu = match("swsh4-188", "Pikachu VMAX", 0.9600)

        listOf(barry, pikachu).forEach { expected ->
            val decision = DinoV2ManualOcrRescue.decide(
                DinoV2OcrEvidence(
                    fullText = expected.card.name,
                    titleLines = listOf(expected.card.name),
                    footerText = "",
                ),
                originalMatches = listOf(expected),
                exactTitleMatches = { normalized ->
                    if (normalized == normalizedScannerCardName(expected.card.name)) listOf(expected) to 1
                    else emptyList<CardEmbeddingMatch>() to 0
                },
            )
            assertTrue(decision is DinoV2OcrRescueDecision.Accepted)
            assertEquals(expected.card.cardId, (decision as DinoV2OcrRescueDecision.Accepted).match.card.cardId)
        }
    }

    @Test fun titleAloneCannotRescueWeakOrUnresolvedPrinting() {
        val weak = match("set-1", "Pikachu", 0.71)
        val weakDecision = DinoV2ManualOcrRescue.decide(
            DinoV2OcrEvidence("Pikachu", listOf("Pikachu"), ""),
            listOf(weak),
        ) { listOf(weak) to 1 }
        assertEquals(
            DinoV2OcrRescueDecision.Rejected.Reason.TITLE_BELOW_THRESHOLD,
            (weakDecision as DinoV2OcrRescueDecision.Rejected).reason,
        )

        val first = match("set-1", "Pikachu", 0.84)
        val second = match("other-2", "Pikachu", 0.70)
        val unresolved = DinoV2ManualOcrRescue.decide(
            DinoV2OcrEvidence("Pikachu", listOf("Pikachu"), ""),
            listOf(first, second),
        ) { listOf(first, second) to 2 }
        assertEquals(
            DinoV2OcrRescueDecision.Rejected.Reason.TITLE_PRINTING_UNRESOLVED,
            (unresolved as DinoV2OcrRescueDecision.Rejected).reason,
        )
    }

    @Test fun exactCollectorPairCanOverrideGateButBareDigitsCannot() {
        val expected = match("swsh9-167", "Barry", 0.60)
        val confirmed = DinoV2ManualOcrRescue.decide(
            DinoV2OcrEvidence("", emptyList(), "167 / 172"),
            listOf(expected),
        ) { emptyList<CardEmbeddingMatch>() to 0 }
        assertEquals(
            DinoV2OcrRescueDecision.Accepted.Reason.COLLECTOR_NUMBER,
            (confirmed as DinoV2OcrRescueDecision.Accepted).reason,
        )
        val bare = DinoV2ManualOcrRescue.decide(
            DinoV2OcrEvidence("", emptyList(), "167"),
            listOf(expected),
        ) { emptyList<CardEmbeddingMatch>() to 0 }
        assertTrue(bare is DinoV2OcrRescueDecision.Rejected)
    }

    @Test fun dispatchSelectsDinoAndNeverRescuesAutomaticPreview() {
        val manual = CardScanOptions(
            engine = CardScanEngine.ON_DEVICE_OCR,
            encoderVariant = CardScanEncoderVariant.DINOV2,
            captureSource = "camera",
        )
        assertEquals(LocalEmbeddingModel.DINOV2, LocalEmbeddingDispatch.select("pokemon", manual))
        assertTrue(LocalEmbeddingDispatch.permitsManualOcrRescue(manual))
        assertTrue(!LocalEmbeddingDispatch.permitsManualOcrRescue(manual.copy(captureSource = "automatic-camera")))
        assertNull(LocalEmbeddingDispatch.select("magic", manual))
        assertNull(LocalEmbeddingDispatch.select("pokemon", manual.copy(engine = CardScanEngine.SERVER_PHASH)))
    }

    private fun match(id: String, name: String, score: Double) = CardEmbeddingMatch(
        index = 0,
        similarity = score,
        card = CardEmbeddingMetadata(0, id, name, game = "pokemon"),
    )
}
