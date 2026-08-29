package com.ahmadjalil.tcger.ui.screens

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.exifinterface.media.ExifInterface
import com.ahmadjalil.tcger.data.scanner.binder.BinderPageGridExtractor
import com.ahmadjalil.tcger.data.scanner.binder.NormalizedPoint
import com.ahmadjalil.tcger.data.scanner.binder.PerspectiveCardCropper
import com.ahmadjalil.tcger.data.scanner.binder.ScannerCropQuad
import com.ahmadjalil.tcger.domain.CardScanCandidate
import com.ahmadjalil.tcger.domain.CatalogCard
import com.ahmadjalil.tcger.generated.ParityFeatureIDs
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

internal data class BinderPocketReview(
    val index: Int,
    val candidates: List<CardScanCandidate>,
    // Bulk binder import is precision-first: only a strong candidate starts
    // selected. Lower-confidence suggestions stay visible for one-tap review.
    val selectedCardId: String? = candidates.firstOrNull {
        (it.confidence ?: 0.0) >= BINDER_AUTO_SELECT_CONFIDENCE
    }?.card?.id,
) {
    val selectedCard: CatalogCard? get() = candidates.firstOrNull { it.card.id == selectedCardId }?.card
}

internal const val BINDER_AUTO_SELECT_CONFIDENCE = 0.82

internal fun selectedBinderCards(pockets: List<BinderPocketReview>): List<CatalogCard> =
    pockets.sortedBy(BinderPocketReview::index).mapNotNull(BinderPocketReview::selectedCard)

internal fun createBinderPocketJpegs(source: Bitmap, pageQuad: ScannerCropQuad): List<ByteArray> =
    BinderPageGridExtractor.pockets(pageQuad).map { quad ->
        PerspectiveCardCropper.crop(source, quad).toJpeg()
    }

internal fun Bitmap.toJpeg(quality: Int = 94): ByteArray = ByteArrayOutputStream().use { output ->
    check(compress(Bitmap.CompressFormat.JPEG, quality, output)) { "The corrected crop could not be encoded." }
    output.toByteArray()
}

internal fun decodeUprightScannerBitmap(bytes: ByteArray): Bitmap {
    val decoded = requireNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size)) {
        "The selected image could not be decoded."
    }
    val orientation = runCatching {
        ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(
            ExifInterface.TAG_ORIENTATION,
            ExifInterface.ORIENTATION_NORMAL,
        )
    }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    val matrix = Matrix().apply {
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { setRotate(90f); postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_90 -> setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> { setRotate(-90f); postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_270 -> setRotate(-90f)
        }
    }
    if (orientation == ExifInterface.ORIENTATION_NORMAL || orientation == ExifInterface.ORIENTATION_UNDEFINED) return decoded
    return Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true).also {
        if (it !== decoded) decoded.recycle()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ScannerQuadEditor(
    title: String,
    bitmap: Bitmap,
    initialQuad: ScannerCropQuad,
    confirmLabel: String,
    onDismiss: () -> Unit,
    onConfirm: (ScannerCropQuad) -> Unit,
) {
    var quad by remember(bitmap, initialQuad) { mutableStateOf(initialQuad) }
    Surface(
        Modifier.fillMaxSize().testTag(
            ParityFeatureIDs.screen(ParityFeatureIDs.SCANNER_RESULTS_CROP_CORRECTION),
        ),
    ) {
        Column(Modifier.fillMaxSize()) {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Close corner editor")
                    }
                },
            )
            Text(
                "Drag each corner onto the image corners. Reset restores the safe guide.",
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 8.dp),
                style = MaterialTheme.typography.bodyMedium,
            )
            QuadImageEditor(bitmap, quad, onQuadChanged = { quad = it })
            Spacer(Modifier.height(12.dp))
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 18.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedButton(onClick = { quad = initialQuad }, modifier = Modifier.weight(1f)) { Text("Reset") }
                Button(onClick = { onConfirm(quad) }, enabled = quad.isValid, modifier = Modifier.weight(1f)) {
                    Text(confirmLabel)
                }
            }
        }
    }
}

@Composable
private fun QuadImageEditor(
    bitmap: Bitmap,
    quad: ScannerCropQuad,
    onQuadChanged: (ScannerCropQuad) -> Unit,
) {
    var size by remember { mutableStateOf(IntSize.Zero) }
    Box(
        Modifier.fillMaxWidth().aspectRatio(bitmap.width.toFloat() / bitmap.height)
            .background(Color.Black).onSizeChanged { size = it },
    ) {
        Image(bitmap.asImageBitmap(), contentDescription = "Source image", modifier = Modifier.fillMaxSize())
        Canvas(Modifier.fillMaxSize()) {
            val points = quad.corners.map { Offset(it.x * this.size.width, it.y * this.size.height) }
            val path = Path().apply {
                moveTo(points.first().x, points.first().y)
                points.drop(1).forEach { lineTo(it.x, it.y) }
                close()
            }
            drawPath(path, Color(0xFFFFC107), style = Stroke(width = 4.dp.toPx()))
        }
        quad.corners.forEachIndexed { index, point ->
            Box(
                Modifier
                    .size(34.dp)
                    .align(Alignment.TopStart)
                    .then(
                        if (size.width > 0) Modifier.offsetNormalized(point, size) else Modifier,
                    )
                    .background(Color(0xFFFFC107), CircleShape)
                    .pointerInput(index, size) {
                        detectDragGestures { change, drag ->
                            change.consume()
                            if (size.width == 0 || size.height == 0) return@detectDragGestures
                            val updated = NormalizedPoint(
                                (quad.corners[index].x + drag.x / size.width).coerceIn(0.005f, 0.995f),
                                (quad.corners[index].y + drag.y / size.height).coerceIn(0.005f, 0.995f),
                            )
                            onQuadChanged(quad.withCorner(index, updated))
                        }
                    },
            )
        }
    }
}

private fun Modifier.offsetNormalized(point: NormalizedPoint, size: IntSize) = this.then(
    Modifier.offset {
        IntOffset(
            (point.x * size.width).roundToInt() - 17.dp.roundToPx(),
            (point.y * size.height).roundToInt() - 17.dp.roundToPx(),
        )
    },
)

internal fun ScannerCropQuad.withCorner(index: Int, point: NormalizedPoint): ScannerCropQuad = when (index) {
    0 -> copy(topLeft = point)
    1 -> copy(topRight = point)
    2 -> copy(bottomRight = point)
    3 -> copy(bottomLeft = point)
    else -> error("Corner index must be in 0..3")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun BinderPageReviewPanel(
    pockets: List<BinderPocketReview>,
    isRecognizing: Boolean,
    processedCount: Int,
    onChooseCandidate: (Int, String?) -> Unit,
    onSave: () -> Unit,
    onClose: () -> Unit,
) {
    var editingPocket by remember { mutableStateOf<Int?>(null) }
    Surface(
        Modifier.fillMaxSize().testTag(
            ParityFeatureIDs.screen(ParityFeatureIDs.SCANNER_CAPTURE_BINDER_PAGE),
        ),
    ) {
        Column(Modifier.fillMaxSize()) {
            TopAppBar(
                title = { Text(if (isRecognizing) "Scanning pocket ${processedCount + 1} of 9" else "Review binder page") },
                navigationIcon = {
                    IconButton(onClick = onClose, enabled = !isRecognizing) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Close binder review")
                    }
                },
            )
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                items(pockets, key = BinderPocketReview::index) { pocket ->
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(
                            checked = pocket.selectedCard != null,
                            onCheckedChange = {
                                onChooseCandidate(pocket.index, if (it) pocket.candidates.firstOrNull()?.card?.id else null)
                            },
                            enabled = pocket.candidates.isNotEmpty(),
                        )
                        Column(Modifier.weight(1f)) {
                            Text("Pocket ${pocket.index + 1}", style = MaterialTheme.typography.labelMedium)
                            Text(pocket.selectedCard?.name ?: "No confirmed match")
                        }
                        TextButton(onClick = { editingPocket = pocket.index }, enabled = pocket.candidates.isNotEmpty()) {
                            Text("Correct")
                        }
                    }
                }
            }
            Button(
                onClick = onSave,
                enabled = !isRecognizing && selectedBinderCards(pockets).isNotEmpty(),
                modifier = Modifier.fillMaxWidth().padding(16.dp),
            ) { Text("Add selected cards to binder") }
        }
    }

    editingPocket?.let { index ->
        val pocket = pockets.firstOrNull { it.index == index } ?: return@let
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { editingPocket = null },
            title = { Text("Correct pocket ${index + 1}") },
            text = {
                Column {
                    TextButton(onClick = { onChooseCandidate(index, null); editingPocket = null }) { Text("No card / skip") }
                    pocket.candidates.forEach { candidate ->
                        TextButton(onClick = { onChooseCandidate(index, candidate.card.id); editingPocket = null }) {
                            Text(candidate.card.name)
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { editingPocket = null }) { Text("Cancel") } },
        )
    }
}
