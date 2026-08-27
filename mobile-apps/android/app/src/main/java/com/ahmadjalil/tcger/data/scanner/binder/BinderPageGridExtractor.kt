package com.ahmadjalil.tcger.data.scanner.binder

/**
 * Produces reading-order pocket quads inside a user-confirmed binder-page quad.
 *
 * This is deliberately not a detector. It is the deterministic substrate for
 * a guided 3x3 binder-page mode and must not make binder capture available by
 * itself. PerspectiveCardCropper can crop each returned pocket independently.
 */
object BinderPageGridExtractor {
    fun pockets(
        page: ScannerCropQuad,
        columns: Int = 3,
        rows: Int = 3,
        gapFraction: Float = 0.04f,
    ): List<ScannerCropQuad> {
        require(page.isValid) { "page quad is invalid" }
        require(columns > 0 && rows > 0) { "grid dimensions must be positive" }
        require(gapFraction in 0f..<0.5f) { "gap fraction must be in [0, 0.5)" }

        return buildList(columns * rows) {
            repeat(rows) { row ->
                repeat(columns) { column ->
                    val left = (column + gapFraction) / columns
                    val right = (column + 1f - gapFraction) / columns
                    val top = (row + gapFraction) / rows
                    val bottom = (row + 1f - gapFraction) / rows
                    add(
                        ScannerCropQuad(
                            interpolate(page, left, top),
                            interpolate(page, right, top),
                            interpolate(page, right, bottom),
                            interpolate(page, left, bottom),
                        ),
                    )
                }
            }
        }
    }

    private fun interpolate(quad: ScannerCropQuad, horizontal: Float, vertical: Float): NormalizedPoint {
        fun lerp(first: NormalizedPoint, second: NormalizedPoint, amount: Float) = NormalizedPoint(
            first.x + (second.x - first.x) * amount,
            first.y + (second.y - first.y) * amount,
        )
        val top = lerp(quad.topLeft, quad.topRight, horizontal)
        val bottom = lerp(quad.bottomLeft, quad.bottomRight, horizontal)
        return lerp(top, bottom, vertical)
    }
}
