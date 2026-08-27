package com.ahmadjalil.tcger.data.scanner

import android.content.Context
import com.ahmadjalil.tcger.domain.CardScanCandidate
import com.ahmadjalil.tcger.domain.CardScanSource
import com.ahmadjalil.tcger.domain.CatalogCard
import java.time.Instant
import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

data class AutoScanConsensusUpdate(
    val candidateId: String?,
    val candidateName: String?,
    val count: Int,
    val required: Int,
    val confirmed: Boolean,
    val locked: Boolean,
)

/** Stable repeated matches confirm once; the same card must leave the frame before it can confirm again. */
class AutoScanConsensus(private val requiredMatches: Int = 2) {
    init { require(requiredMatches >= 2) }

    private var candidateId: String? = null
    private var candidateName: String? = null
    private var count = 0
    private var lockedCardId: String? = null

    fun observe(id: String?, name: String?): AutoScanConsensusUpdate {
        if (id == null) {
            resetCandidate()
            lockedCardId = null
            return status(confirmed = false, locked = false)
        }
        if (id == lockedCardId) {
            resetCandidate()
            return AutoScanConsensusUpdate(id, name, requiredMatches, requiredMatches, confirmed = false, locked = true)
        }
        if (id == candidateId) {
            count += 1
        } else {
            candidateId = id
            candidateName = name
            count = 1
        }
        val confirmed = count >= requiredMatches
        if (confirmed) {
            lockedCardId = id
            resetCandidate()
        }
        return AutoScanConsensusUpdate(id, name, if (confirmed) requiredMatches else count, requiredMatches, confirmed, locked = false)
    }

    fun reset() {
        resetCandidate()
        lockedCardId = null
    }

    private fun resetCandidate() {
        candidateId = null
        candidateName = null
        count = 0
    }

    private fun status(confirmed: Boolean, locked: Boolean) = AutoScanConsensusUpdate(
        candidateId, candidateName, count, requiredMatches, confirmed, locked,
    )
}

fun ScannerSessionOptions.boundedAutomaticIntervalMillis(serverConfigured: Boolean): Long {
    val requested = analysisIntervalMillis.coerceIn(500, 10_000)
    val minimum = when (recognitionEngine) {
        ScannerRecognitionEngine.SERVER_PHASH,
        ScannerRecognitionEngine.SERVER_EMBEDDING -> 2_500L
        ScannerRecognitionEngine.AUTOMATIC -> if (serverConfigured) 2_000L else 900L
        ScannerRecognitionEngine.ON_DEVICE_OCR -> 750L
    }
    return requested.coerceAtLeast(minimum)
}

@Serializable
data class ScannerSessionEntry(
    val id: String,
    val cardId: String,
    val name: String,
    val game: String,
    val setCode: String? = null,
    val setName: String? = null,
    val rarity: String? = null,
    val collectorNumber: String? = null,
    val imageUrl: String? = null,
    val confidence: Double? = null,
    val source: String,
    val scannedAt: String,
    val selected: Boolean = true,
    val price: Double? = null,
    val currency: String? = null,
    val priceSource: String? = null,
) {
    fun toCatalogCard() = CatalogCard(
        id = cardId,
        name = name,
        tcg = game,
        setCode = setCode,
        setName = setName,
        rarity = rarity,
        collectorNumber = collectorNumber,
        imageUrl = imageUrl,
    )

    companion object {
        fun from(
            candidate: CardScanCandidate,
            source: CardScanSource,
            id: String = UUID.randomUUID().toString(),
            scannedAt: String = Instant.now().toString(),
        ): ScannerSessionEntry {
            val card = candidate.card
            return ScannerSessionEntry(
                id = id,
                cardId = card.id,
                name = card.name,
                game = card.tcg,
                setCode = card.setCode,
                setName = card.setName,
                rarity = card.rarity,
                collectorNumber = card.collectorNumber,
                imageUrl = card.imageUrl,
                confidence = candidate.confidence,
                source = source.name,
                scannedAt = scannedAt,
            )
        }
    }
}

object ScannerSessionJson {
    private val codec = Json { encodeDefaults = true; ignoreUnknownKeys = true }
    fun encode(entries: List<ScannerSessionEntry>): String = codec.encodeToString(entries)
    fun decode(json: String): List<ScannerSessionEntry> = codec.decodeFromString(json)
}

class ScannerSessionStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun load(): List<ScannerSessionEntry> = preferences.getString(KEY, null)
        ?.let { runCatching { ScannerSessionJson.decode(it) }.getOrNull() }
        .orEmpty()

    fun save(entries: List<ScannerSessionEntry>) {
        preferences.edit().putString(KEY, ScannerSessionJson.encode(entries.takeLast(MAX_PERSISTED))).apply()
    }

    companion object {
        private const val FILE = "scanner-session"
        private const val KEY = "entries-json"
        private const val MAX_PERSISTED = 250
    }
}
