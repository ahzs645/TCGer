package com.ahmadjalil.tcger.data.scanner.binder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScannerCropQuadTest {
    @Test fun centeredCardIsValidAndUsesTradingCardAspect() {
        val quad = ScannerCropQuad.centered(900, 1200)
        assertTrue(quad.isValid)
        val width = quad.topRight.x - quad.topLeft.x
        val height = quad.bottomLeft.y - quad.topLeft.y
        assertEquals(63f / 88f, width * (900f / 1200f) / height, 0.001f)
    }

    @Test fun crossedOrTinyQuadsAreRejected() {
        assertFalse(
            ScannerCropQuad(
                NormalizedPoint(0.1f, 0.1f), NormalizedPoint(0.9f, 0.9f),
                NormalizedPoint(0.9f, 0.1f), NormalizedPoint(0.1f, 0.9f),
            ).isValid,
        )
        assertFalse(ScannerCropQuad.fromBounds(0.1f, 0.1f, 0.2f, 0.2f).isValid)
    }

    @Test fun expansionClampsCornersAndIncreasesArea() {
        val quad = ScannerCropQuad.fromBounds(0.02f, 0.02f, 0.98f, 0.98f)
        val expanded = quad.expandedOutward(0.2f)
        assertTrue(expanded.isValid)
        assertTrue(expanded.area > quad.area)
        assertTrue(expanded.corners.all { it.x in 0.005f..0.995f && it.y in 0.005f..0.995f })
    }

    @Test fun binderGridReturnsNineValidPocketsInReadingOrder() {
        val page = ScannerCropQuad.fromBounds(0.05f, 0.05f, 0.95f, 0.95f)
        val pockets = BinderPageGridExtractor.pockets(page)
        assertEquals(9, pockets.size)
        assertTrue(pockets.all(ScannerCropQuad::isValid))
        assertTrue(pockets[0].topLeft.x < pockets[1].topLeft.x)
        assertTrue(pockets[2].topLeft.y < pockets[3].topLeft.y)
    }
}
