package com.ahmadjalil.tcger.data.scanner.binder

import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Emits current Matrix.setPolyToPoly crops for the shared parity scorer. */
@RunWith(AndroidJUnit4::class)
class CropParityExportInstrumentedTest {
    @Test fun exportCurrentAndroidCrops() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val assets = instrumentation.context.assets
        val root = "crop-parity.generated"
        val names = assets.list(root)?.toSet().orEmpty()
        assumeTrue("stage private crop-parity inputs into androidTest assets", "cases.json" in names)
        val document = JSONObject(assets.open("$root/cases.json").bufferedReader().readText())
        val output = File(instrumentation.targetContext.cacheDir, "crop-parity").apply { mkdirs() }
        val cases = document.getJSONArray("cases")
        val unsupportedCaseIds = mutableListOf<String>()
        var exported = 0
        repeat(cases.length()) { index ->
            val fixture = cases.getJSONObject(index)
            val caseId = fixture.getString("caseId")
            val sourcePath = fixture.getString("sourcePath")
            val sourceBytes = assets.open("$root/$sourcePath").readBytes()
            assertEquals(fixture.getString("sourceSha256"), sourceBytes.sha256())
            val source = BitmapFactory.decodeByteArray(sourceBytes, 0, sourceBytes.size)
            val points = fixture.getJSONArray("quad")
            fun point(position: Int): NormalizedPoint {
                val pair = points.getJSONArray(position)
                return NormalizedPoint(pair.getDouble(0).toFloat(), pair.getDouble(1).toFloat())
            }
            val quad = ScannerCropQuad(point(0), point(1), point(2), point(3))
            if (!quad.isValid) {
                unsupportedCaseIds += caseId
                source.recycle()
                return@repeat
            }
            val crop = PerspectiveCardCropper.crop(source, quad)
            File(output, "$caseId.png").outputStream().use {
                crop.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
            }
            source.recycle()
            crop.recycle()
            exported += 1
        }
        File(output, "export-summary.json").writeText(
            JSONObject()
                .put("exported", exported)
                .put("unsupportedCaseIds", JSONArray(unsupportedCaseIds))
                .toString(2) + "\n",
        )
        println("CROP_PARITY_OUTPUT=${output.absolutePath}")
    }

    private fun ByteArray.sha256(): String = MessageDigest.getInstance("SHA-256")
        .digest(this)
        .joinToString("") { "%02x".format(it) }
}
