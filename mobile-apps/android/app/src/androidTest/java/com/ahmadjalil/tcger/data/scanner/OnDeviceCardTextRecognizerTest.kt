package com.ahmadjalil.tcger.data.scanner

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.ahmadjalil.tcger.data.scanner.binder.BinderPageGridExtractor
import com.ahmadjalil.tcger.data.scanner.binder.PerspectiveCardCropper
import com.ahmadjalil.tcger.data.scanner.binder.ScannerCropQuad
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OnDeviceCardTextRecognizerTest {
    @Test
    fun readsTitleFromSharedIosPokemonFixture() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().context
        val bytes = context.assets.open("BossOrders.imageset/swsh9-132.png").use { it.readBytes() }

        val recognizedText = OnDeviceCardTextRecognizer().recognize(bytes)
        val queries = CardTitleExtractor.candidateQueries(recognizedText)

        assertTrue(
            "Expected Boss's Orders in recognized text, got: $recognizedText",
            recognizedText.contains("Boss", ignoreCase = true),
        )
        assertTrue(queries.any { it.contains("Boss", ignoreCase = true) })
    }

    @Test
    fun deterministicDemoCardIsReadableByProductionOcr() = runBlocking {
        val recognizedText = OnDeviceCardTextRecognizer().recognize(ScannerDemoInputs.jpeg(ScannerCaptureMode.CARD))

        assertTrue(
            "Expected Pikachu in demo-card OCR, got: $recognizedText",
            recognizedText.contains("Pikachu", ignoreCase = true),
        )
    }

    @Test
    fun deterministicDemoBinderPageProducesNineReadablePocketInputs() = runBlocking {
        val pageBytes = ScannerDemoInputs.jpeg(ScannerCaptureMode.BINDER)
        val page = requireNotNull(BitmapFactory.decodeByteArray(pageBytes, 0, pageBytes.size))
        val pockets = BinderPageGridExtractor.pockets(ScannerCropQuad.fromBounds(0.035f, 0.035f, 0.965f, 0.965f))
        assertEquals(9, pockets.size)

        val firstAndLast = listOf(0, 8).map { index ->
            val crop = PerspectiveCardCropper.crop(page, pockets[index])
            try {
                OnDeviceCardTextRecognizer().recognize(crop.toTestJpeg())
            } finally {
                crop.recycle()
            }
        }
        page.recycle()

        assertTrue("Expected Pikachu in first demo pocket, got: ${firstAndLast[0]}", firstAndLast[0].contains("Pikachu", true))
        assertTrue("Expected Dragonite in last demo pocket, got: ${firstAndLast[1]}", firstAndLast[1].contains("Dragonite", true))
    }

    private fun Bitmap.toTestJpeg(): ByteArray = ByteArrayOutputStream().use { output ->
        check(compress(Bitmap.CompressFormat.JPEG, 94, output))
        output.toByteArray()
    }
}
