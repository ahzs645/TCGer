package com.ahmadjalil.tcger.data.scanner

import android.content.Context
import android.content.pm.PackageManager
import com.ahmadjalil.tcger.data.scanner.model.ArcFaceCardRecognizer
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
                "ArcFace game packages",
                ScannerDiagnosticStatus.INFO,
                "Delivered per game on first use; installed packages are checksum-validated before activation.",
            ),
            ScannerAssetDiagnosticItem(
                "dinov2-runtime",
                "Historical DINOv2 evaluation runtime",
                ScannerDiagnosticStatus.INFO,
                "Intentionally excluded from the APK/AAB and retained outside production assets for evaluation.",
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
