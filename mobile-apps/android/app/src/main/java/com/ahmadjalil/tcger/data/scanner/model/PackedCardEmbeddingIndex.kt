package com.ahmadjalil.tcger.data.scanner.model

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.PriorityQueue
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.math.sqrt

@Serializable
data class CardEmbeddingMetadata(
    val annIndex: Int,
    val cardId: String,
    val name: String,
    val game: String? = null,
    val format: String? = null,
    val setCode: String? = null,
    val setName: String? = null,
    val rarity: String? = null,
    val imageURL: String? = null,
    val price: Double? = null,
) {
    val isPhysicalPokemonCard: Boolean
        get() = (game == null || game.equals("pokemon", ignoreCase = true)) &&
            !format.equals("pocket", ignoreCase = true) &&
            imageURL?.contains("/tcgp/", ignoreCase = true) != true

    fun isEligibleForGame(requestedGame: String): Boolean = when (normalizeScannerGame(requestedGame)) {
        "pokemon" -> isPhysicalPokemonCard
        else -> game?.let(::normalizeScannerGame) == normalizeScannerGame(requestedGame)
    }
}

data class CardEmbeddingMatch(
    val index: Int,
    val similarity: Double,
    val card: CardEmbeddingMetadata,
)

class PackedCardEmbeddingIndex private constructor(
    val count: Int,
    val dimension: Int,
    private val vectors: ByteArray,
    private val rowNorms: FloatArray,
    private val metadata: Array<CardEmbeddingMetadata>,
) {
    fun nearest(
        query: FloatArray,
        limit: Int,
        physicalPokemonOnly: Boolean = true,
        game: String? = null,
        setCode: String? = null,
        normalizedCardName: String? = null,
    ): List<CardEmbeddingMatch> {
        require(query.size == dimension) { "query dimension ${query.size}; expected $dimension" }
        require(limit > 0) { "limit must be positive" }
        val queryNorm = sqrt(query.fold(0.0) { total, value -> total + value * value })
        require(queryNorm > 0.0) { "query must have a non-zero norm" }

        val top = PriorityQueue<ScoredRow>(compareBy { it.similarity })
        for (row in 0 until count) {
            val card = metadata[row]
            if (physicalPokemonOnly && !card.isPhysicalPokemonCard) continue
            if (game != null && !card.isEligibleForGame(game)) continue
            if (setCode != null && !card.setCode.equals(setCode, ignoreCase = true)) continue
            if (normalizedCardName != null && normalizedScannerCardName(card.name) != normalizedCardName) continue
            val rowNorm = rowNorms[row]
            if (rowNorm <= 0f) continue

            var dot = 0.0
            val offset = row * dimension
            for (column in 0 until dimension) {
                dot += query[column] * vectors[offset + column].toDouble()
            }
            val similarity = (dot / (queryNorm * rowNorm)).coerceIn(-1.0, 1.0)
            if (top.size < limit) {
                top += ScoredRow(row, similarity)
            } else if (similarity > top.peek()!!.similarity) {
                top.poll()
                top += ScoredRow(row, similarity)
            }
        }

        return top.sortedByDescending { it.similarity }.map { scored ->
            CardEmbeddingMatch(scored.index, scored.similarity, metadata[scored.index])
        }
    }

    fun physicalPokemonCardCount(normalizedCardName: String): Int = metadata.count { card ->
        card.isPhysicalPokemonCard && normalizedScannerCardName(card.name) == normalizedCardName
    }

    fun cardCountForGame(game: String): Int = metadata.count { it.isEligibleForGame(game) }

    private data class ScoredRow(val index: Int, val similarity: Double)

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        fun decode(vectorBytes: ByteArray, metadataBytes: ByteArray): PackedCardEmbeddingIndex {
            require(vectorBytes.size >= 8) { "packed embedding index has no header" }
            val header = ByteBuffer.wrap(vectorBytes, 0, 8).order(ByteOrder.LITTLE_ENDIAN)
            val count = header.int
            val dimension = header.int
            require(count > 0 && dimension > 0) { "packed embedding index has an invalid header" }
            val expectedSize = 8L + count.toLong() * dimension
            require(vectorBytes.size.toLong() == expectedSize) {
                "packed embedding index is ${vectorBytes.size} bytes; expected $expectedSize"
            }

            val cards = json.decodeFromString<List<CardEmbeddingMetadata>>(metadataBytes.decodeToString())
            require(cards.size == count) { "metadata count ${cards.size}; vector count $count" }
            val byIndex = arrayOfNulls<CardEmbeddingMetadata>(count)
            cards.forEach { card ->
                require(card.annIndex in 0 until count) { "metadata annIndex ${card.annIndex} is out of range" }
                require(byIndex[card.annIndex] == null) { "duplicate metadata annIndex ${card.annIndex}" }
                byIndex[card.annIndex] = card
            }
            require(byIndex.all { it != null }) { "metadata has missing annIndex rows" }

            val packed = vectorBytes.copyOfRange(8, vectorBytes.size)
            val rowNorms = FloatArray(count)
            for (row in 0 until count) {
                var sum = 0.0
                val offset = row * dimension
                for (column in 0 until dimension) {
                    val value = packed[offset + column].toDouble()
                    sum += value * value
                }
                rowNorms[row] = sqrt(sum).toFloat()
            }
            @Suppress("UNCHECKED_CAST")
            return PackedCardEmbeddingIndex(count, dimension, packed, rowNorms, byIndex as Array<CardEmbeddingMetadata>)
        }
    }
}
