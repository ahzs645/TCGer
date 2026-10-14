package com.ahmadjalil.tcger.data.scanner

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScannerPreviewAnalysisThrottleTest {
    @Test fun onlyOneFrameIsConvertedUntilDeliveryCompletes() {
        val throttle = ScannerPreviewAnalysisThrottle()
        assertTrue(throttle.tryAcquire(1000, true, false, 500))
        assertFalse(throttle.tryAcquire(2000, true, false, 500))
        throttle.release()
        assertTrue(throttle.tryAcquire(2000, true, false, 500))
    }

    @Test fun inactiveAndBusyFramesDoNotConsumeTheNextSample() {
        val throttle = ScannerPreviewAnalysisThrottle()
        assertFalse(throttle.tryAcquire(1000, false, false, 500))
        assertFalse(throttle.tryAcquire(1000, true, true, 500))
        assertTrue(throttle.tryAcquire(1000, true, false, 500))
    }

    @Test fun samplingRespectsCadenceAfterConversionFinishes() {
        val throttle = ScannerPreviewAnalysisThrottle()
        assertTrue(throttle.tryAcquire(1000, true, false, 500))
        throttle.release()
        assertFalse(throttle.tryAcquire(1499, true, false, 500))
        assertTrue(throttle.tryAcquire(1500, true, false, 500))
    }
}
