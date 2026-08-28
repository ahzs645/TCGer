package com.ahmadjalil.tcger.data.scanner.model

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PackedCardEmbeddingIndexTest {
    @Test
    fun `decodes packed int8 rows and ranks by cosine similarity`() {
        val index = PackedCardEmbeddingIndex.decode(
            packed(rows = listOf(byteArrayOf(127, 0), byteArrayOf(0, 127), byteArrayOf(90, 90))),
            metadata(),
        )

        val matches = index.nearest(floatArrayOf(1f, 0f), limit = 3, physicalPokemonOnly = false)

        assertEquals(listOf("first", "diagonal", "second"), matches.map { it.card.cardId })
        assertEquals(1.0, matches.first().similarity, 0.000_001)
    }

    @Test
    fun `physical search excludes pocket cards`() {
        val metadata = """[
          {"annIndex":0,"cardId":"physical","name":"Physical","game":"pokemon"},
          {"annIndex":1,"cardId":"pocket","name":"Pocket","game":"pokemon","format":"pocket"}
        ]""".encodeToByteArray()
        val index = PackedCardEmbeddingIndex.decode(
            packed(rows = listOf(byteArrayOf(100, 0), byteArrayOf(127, 0))),
            metadata,
        )

        val matches = index.nearest(floatArrayOf(1f, 0f), limit = 2)

        assertEquals(listOf("physical"), matches.map { it.card.cardId })
    }

    @Test
    fun `explicit game search cannot return another games rows`() {
        val metadata = """[
          {"annIndex":0,"cardId":"pokemon","name":"Pokemon","game":"pokemon"},
          {"annIndex":1,"cardId":"yugioh","name":"Yu-Gi-Oh!","game":"yugioh"}
        ]""".encodeToByteArray()
        val index = PackedCardEmbeddingIndex.decode(
            packed(rows = listOf(byteArrayOf(127, 0), byteArrayOf(120, 0))),
            metadata,
        )

        val matches = index.nearest(
            floatArrayOf(1f, 0f),
            limit = 2,
            physicalPokemonOnly = false,
            game = "yugioh",
        )

        assertEquals(listOf("yugioh"), matches.map { it.card.cardId })
        assertEquals(1, index.cardCountForGame("yu-gi-oh!"))
    }

    @Test
    fun `rejects metadata and vector count mismatch`() {
        assertThrows(IllegalArgumentException::class.java) {
            PackedCardEmbeddingIndex.decode(
                packed(rows = listOf(byteArrayOf(127, 0))),
                metadata(),
            )
        }
    }

    private fun packed(rows: List<ByteArray>): ByteArray {
        val dimension = rows.first().size
        val buffer = ByteBuffer.allocate(8 + rows.size * dimension).order(ByteOrder.LITTLE_ENDIAN)
        buffer.putInt(rows.size)
        buffer.putInt(dimension)
        rows.forEach(buffer::put)
        return buffer.array()
    }

    private fun metadata(): ByteArray = """[
      {"annIndex":0,"cardId":"first","name":"First","game":"pokemon"},
      {"annIndex":1,"cardId":"second","name":"Second","game":"pokemon"},
      {"annIndex":2,"cardId":"diagonal","name":"Diagonal","game":"pokemon"}
    ]""".encodeToByteArray()
}
