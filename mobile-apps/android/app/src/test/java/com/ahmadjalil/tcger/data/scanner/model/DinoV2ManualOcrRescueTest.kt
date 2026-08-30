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

    @Test fun magicPolicyRescuesUniqueExactAndVisualBoundedSingleEditTitles() {
        val oin = match("magic-oin", "Óin the Brave", 0.56)
        val exact = DinoV2ManualOcrRescue.decide(
            evidence = DinoV2OcrEvidence("Oin the Brave", listOf("Oin the Brave"), ""),
            originalMatches = listOf(oin),
            exactTitleMatches = { normalized ->
                if (normalized == normalizedScannerCardName(oin.card.name)) listOf(oin) to 1
                else emptyList<CardEmbeddingMatch>() to 0
            },
            uniqueTitleEvidenceScore = 0.55,
            singleEditVisualFloor = 0.75,
        )
        assertTrue(exact is DinoV2OcrRescueDecision.Accepted)

        val map = match("magic-map", "Thrór's Map", 0.80)
        val corrected = DinoV2ManualOcrRescue.decide(
            evidence = DinoV2OcrEvidence("Thrór's Man", listOf("Thrór's Man"), ""),
            originalMatches = listOf(map),
            exactTitleMatches = { normalized ->
                if (normalized == normalizedScannerCardName(map.card.name)) listOf(map) to 1
                else emptyList<CardEmbeddingMatch>() to 0
            },
            uniqueTitleEvidenceScore = 0.55,
            singleEditVisualFloor = 0.75,
        )
        assertTrue(corrected is DinoV2OcrRescueDecision.Accepted)

        val weakMap = map.copy(similarity = 0.74)
        val unbounded = DinoV2ManualOcrRescue.decide(
            evidence = DinoV2OcrEvidence("Thrór's Man", listOf("Thrór's Man"), ""),
            originalMatches = listOf(weakMap),
            exactTitleMatches = { emptyList<CardEmbeddingMatch>() to 0 },
            uniqueTitleEvidenceScore = 0.55,
            singleEditVisualFloor = 0.75,
        )
        assertTrue(unbounded is DinoV2OcrRescueDecision.Rejected)
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

    @Test fun familyScopedFooterMatchPinsANestedPrinting() {
        val family = CardEmbeddingMatch(
            index = 0,
            similarity = 0.82,
            card = CardEmbeddingMetadata(
                0, "scd-306", "Jwar Isle Refuge", game = "magic",
                setCode = "scd", collectorNumber = "306", recognitionFamilyId = "magic:visual:jwar",
                printings = listOf(
                    CardEmbeddingPrinting("scd-306", setCode = "scd", collectorNumber = "306", releaseDate = "2022-12-02"),
                    CardEmbeddingPrinting("c17-258", setCode = "c17", collectorNumber = "258", releaseDate = "2017-08-25"),
                ),
            ),
        )
        val evidence = DinoV2OcrEvidence("258/309", emptyList(), "258/309")

        val representativeOnly = DinoV2ManualOcrRescue.decide(
            evidence, listOf(family),
            collectorNumberScope = ScannerAcceptancePolicy.CollectorNumberScope.REPRESENTATIVE,
        ) { emptyList<CardEmbeddingMatch>() to 0 }
        assertTrue(representativeOnly is DinoV2OcrRescueDecision.Rejected)

        val familyScoped = DinoV2ManualOcrRescue.decide(
            evidence, listOf(family),
            collectorNumberScope = ScannerAcceptancePolicy.CollectorNumberScope.FAMILY,
        ) { emptyList<CardEmbeddingMatch>() to 0 }
        val accepted = familyScoped as DinoV2OcrRescueDecision.Accepted
        assertEquals(DinoV2OcrRescueDecision.Accepted.Reason.COLLECTOR_NUMBER, accepted.reason)
        assertEquals("c17-258", accepted.match.card.cardId)
        assertEquals("magic:visual:jwar", accepted.match.card.recognitionFamilyId)
    }

    @Test fun titleAgreeingWithTheVisualLeaderConfirmsAReprintedFamilyFromTheEvidenceFloor() {
        val leader = match("snc-352", "Racers' Ring", 0.79)
        val evidence = DinoV2OcrEvidence("Racers' Ring", listOf("Racers' Ring"), "")
        val ranked = { _: String -> listOf(leader) to 3 }

        val strict = DinoV2ManualOcrRescue.decide(
            evidence, listOf(leader),
            strongAcceptanceScore = 0.70, ambiguityMargin = 0.05, uniqueTitleEvidenceScore = 0.55,
            titleAgreementRescue = false, exactTitleMatches = ranked,
        )
        assertEquals(
            DinoV2OcrRescueDecision.Rejected.Reason.TITLE_PRINTING_UNRESOLVED,
            (strict as DinoV2OcrRescueDecision.Rejected).reason,
        )

        val agreeing = DinoV2ManualOcrRescue.decide(
            evidence, listOf(leader),
            strongAcceptanceScore = 0.70, ambiguityMargin = 0.05, uniqueTitleEvidenceScore = 0.55,
            titleAgreementRescue = true, exactTitleMatches = ranked,
        )
        assertEquals("snc-352", (agreeing as DinoV2OcrRescueDecision.Accepted).match.card.cardId)

        // The image preferred a different card: the title alone stays bounded.
        val swamp = match("basic-1", "Swamp", 0.68)
        val corpse = match("snc-302", "Corpse Appraiser", 0.67)
        val contradicted = DinoV2ManualOcrRescue.decide(
            DinoV2OcrEvidence("Corpse Appraiser", listOf("Corpse Appraiser"), ""),
            listOf(swamp, corpse),
            strongAcceptanceScore = 0.70, ambiguityMargin = 0.05, uniqueTitleEvidenceScore = 0.55,
            titleAgreementRescue = true,
        ) { listOf(corpse) to 3 }
        assertTrue(contradicted is DinoV2OcrRescueDecision.Rejected)
    }

    private fun match(id: String, name: String, score: Double) = CardEmbeddingMatch(
        index = 0,
        similarity = score,
        card = CardEmbeddingMetadata(0, id, name, game = "pokemon"),
    )
}
