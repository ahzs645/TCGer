package com.ahmadjalil.tcger.data.scanner

import android.content.Context
import android.content.pm.PackageManager
import com.ahmadjalil.tcger.data.scanner.model.ArcFaceCardRecognizer
import com.ahmadjalil.tcger.data.scanner.model.DinoV2CardRecognizer
import com.ahmadjalil.tcger.data.scanner.model.ScannerModelAvailability
import java.io.File

enum class ScannerDiagnosticStatus { PASS, FAIL, INFO }

data class ScannerAssetDiagnosticItem(
    val id: String,
    val name: String,
    val status: ScannerDiagnosticStatus,
    val detail: String,
)

object AndroidScannerAssetDiagnostics {
    fun run(context: Context, serverConfigured: Boolean): List<ScannerAssetDiagnosticItem> {
        val app = context.applicationContext
        val model = runCatching { ArcFaceCardRecognizer.load(app).use { } }
        val dinoV2Model = runCatching { DinoV2CardRecognizer.load(app).use { } }
        val mlKitPresent = runCatching { Class.forName("com.google.mlkit.vision.text.TextRecognition") }.isSuccess
        val packageManager = app.packageManager
        val hasCamera = packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        val hasFlash = packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_FLASH)
        val recordingDirectory = File(app.filesDir, "scanner-recordings")
        val recordingWritable = runCatching { recordingDirectory.mkdirs() || recordingDirectory.isDirectory }
            .getOrDefault(false) && recordingDirectory.canWrite()
        return listOf(
            ScannerAssetDiagnosticItem(
                "arcface-runtime",
                "ArcFace model + calibrated index",
                if (model.isSuccess) ScannerDiagnosticStatus.PASS else ScannerDiagnosticStatus.FAIL,
                model.exceptionOrNull()?.message ?: "ONNX session, 21,828-card index, dimensions, sizes, and SHA-256 checks passed.",
            ),
            ScannerAssetDiagnosticItem(
                "dinov2-runtime",
                "DINOv2 model + calibrated index",
                if (dinoV2Model.isSuccess) ScannerDiagnosticStatus.PASS else ScannerDiagnosticStatus.FAIL,
                dinoV2Model.exceptionOrNull()?.message
                    ?: "ONNX session, index dimensions, model/index/gate/metadata sizes, and SHA-256 checks passed.",
            ),
            ScannerAssetDiagnosticItem(
                "mlkit-ocr",
                "Bundled ML Kit OCR",
                if (mlKitPresent) ScannerDiagnosticStatus.PASS else ScannerDiagnosticStatus.FAIL,
                if (mlKitPresent) "Bundled Latin text-recognition runtime is present." else "ML Kit text-recognition class is missing.",
            ),
            ScannerAssetDiagnosticItem(
                "camera",
                "CameraX camera hardware",
                if (hasCamera) ScannerDiagnosticStatus.PASS else ScannerDiagnosticStatus.INFO,
                if (hasCamera) "Camera present; flashlight ${if (hasFlash) "present" else "not reported"}." else "No camera hardware reported; photo import remains available.",
            ),
            ScannerAssetDiagnosticItem(
                "recording-storage",
                "Recording storage",
                if (recordingWritable) ScannerDiagnosticStatus.PASS else ScannerDiagnosticStatus.FAIL,
                if (recordingWritable) "Private scanner-recordings directory is writable." else "Private recording directory is unavailable.",
            ),
            ScannerAssetDiagnosticItem(
                "server",
                "Server scanner",
                if (serverConfigured) ScannerDiagnosticStatus.PASS else ScannerDiagnosticStatus.INFO,
                if (serverConfigured) "Configured and authenticated for pHash/embedding requests." else "Not configured; offline ArcFace/OCR remain available.",
            ),
        )
    }

    fun arcFaceAvailable(context: Context): Boolean =
        ArcFaceCardRecognizer.availability(context.applicationContext) is ScannerModelAvailability.Available
}
