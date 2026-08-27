package com.ahmadjalil.tcger.data.scanner

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import java.io.ByteArrayOutputStream

/** Deterministic, offline scanner inputs that exercise the production Android capture path. */
object ScannerDemoInputs {
    private val binderTitles = listOf(
        "Pikachu",
        "Charizard",
        "Bulbasaur",
        "Squirtle",
        "Eevee",
        "Mewtwo",
        "Snorlax",
        "Gengar",
        "Dragonite",
    )

    fun jpeg(captureMode: ScannerCaptureMode): ByteArray = when (captureMode) {
        ScannerCaptureMode.CARD -> cardBitmap("Pikachu", "58 / 102").toJpeg()
        ScannerCaptureMode.BINDER -> binderBitmap().toJpeg()
    }

    internal fun binderLabels(): List<String> = binderTitles

    private fun binderBitmap(): Bitmap {
        val width = 1_400
        val height = 1_980
        val page = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(page)
        canvas.drawColor(Color.rgb(9, 14, 20))
        val inset = 48f
        val gutter = 20f
        val cardWidth = (width - inset * 2 - gutter * 2) / 3f
        val cardHeight = cardWidth * 1.395f
        binderTitles.forEachIndexed { index, title ->
            val left = inset + (index % 3) * (cardWidth + gutter)
            val top = inset + (index / 3) * (cardHeight + gutter)
            val pocket = RectF(left - 6, top - 6, left + cardWidth + 6, top + cardHeight + 6)
            canvas.drawRoundRect(pocket, 14f, 14f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.rgb(62, 73, 87)
            })
            val card = cardBitmap(title, "${index + 1} / 9")
            canvas.drawBitmap(card, null, RectF(left, top, left + cardWidth, top + cardHeight), null)
            card.recycle()
        }
        return page
    }

    private fun cardBitmap(title: String, number: String): Bitmap {
        val width = 500
        val height = 698
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val background = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(248, 244, 225) }
        canvas.drawRoundRect(RectF(0f, 0f, width.toFloat(), height.toFloat()), 24f, 24f, background)
        canvas.drawRoundRect(
            RectF(22f, 22f, width - 22f, height - 22f),
            18f,
            18f,
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.rgb(244, 201, 67)
                style = Paint.Style.STROKE
                strokeWidth = 14f
            },
        )
        canvas.drawRect(
            RectF(42f, 122f, width - 42f, 470f),
            Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(114, 174, 209) },
        )
        // Keep the title below the guided binder grid's small pocket-edge crop so
        // every row exercises the same production OCR path reliably.
        canvas.drawText(title, 42f, 112f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = 43f
            isFakeBoldText = true
        })
        canvas.drawText(number, 42f, 635f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.DKGRAY
            textSize = 29f
        })
        return bitmap
    }

    private fun Bitmap.toJpeg(): ByteArray = try {
        ByteArrayOutputStream().use { output ->
            check(compress(Bitmap.CompressFormat.JPEG, 94, output)) { "Could not encode scanner demo input" }
            output.toByteArray()
        }
    } finally {
        recycle()
    }
}
