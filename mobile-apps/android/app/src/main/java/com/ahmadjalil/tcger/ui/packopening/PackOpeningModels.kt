package com.ahmadjalil.tcger.ui.packopening

import com.ahmadjalil.tcger.domain.CatalogCard
import com.ahmadjalil.tcger.domain.SealedInventoryItem
import com.ahmadjalil.tcger.domain.SealedOpeningRecord
import java.util.concurrent.atomic.AtomicLong
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

@Serializable
enum class PackOpeningPhase {
    @SerialName("loading") LOADING,
    @SerialName("select") SELECT,
    @SerialName("tear") TEAR,
    @SerialName("opening") OPENING,
    @SerialName("reveal") REVEAL,
    @SerialName("summary") SUMMARY,
    @SerialName("final") FINAL,
}

@Serializable
enum class PackOpeningMode {
    @SerialName("normal") NORMAL,
    @SerialName("quick") QUICK,
}

@Serializable
data class PackOpeningPull(
    val cardId: String,
    val name: String,
    val rarity: String,
    val tier: String,
    val collectorNumber: String,
    val tcg: String,
    val setCode: String,
    val setName: String,
    val imageUrl: String,
    val imageUrlSmall: String,
) {
    val tierRank: Int
        get() = when (tier.lowercase()) {
            "chase" -> 5
            "ultra" -> 4
            "rare" -> 3
            "uncommon" -> 2
            else -> 1
        }
}

fun PackOpeningPull.toCatalogCard() = CatalogCard(
    id = cardId,
    name = name,
    tcg = tcg,
    setCode = setCode,
    setName = setName,
    rarity = rarity,
    collectorNumber = collectorNumber,
    imageUrl = imageUrl.ifBlank { imageUrlSmall },
)

@Serializable
data class PackOpeningPullSession(
    val id: String,
    val packLabel: String,
    val openedAt: String,
    val packs: List<List<PackOpeningPull>>,
) {
    val pulls: List<PackOpeningPull> get() = packs.flatten()
    val bestPull: PackOpeningPull? get() = pulls.maxByOrNull(PackOpeningPull::tierRank)
    val tcg: String? get() = pulls.map(PackOpeningPull::tcg).distinct().singleOrNull()
    val setCode: String? get() = pulls.map(PackOpeningPull::setCode).distinct().singleOrNull()
}

data class PackOpeningSaveCheckpoint(
    val savedPullCount: Int = 0,
    val collectionCopyIds: List<String> = emptyList(),
)

data class PackOpeningSaveOutcome(
    val checkpoint: PackOpeningSaveCheckpoint,
    val completed: Boolean,
    val sealedOpening: SealedOpeningRecord? = null,
    val error: Throwable? = null,
)

fun SealedInventoryItem.canRecordOpening(session: PackOpeningPullSession): Boolean {
    val productType = product.productType.lowercase()
    val sessionTcg = session.tcg ?: return false
    val sessionSetCode = session.setCode ?: return false
    return "booster" in productType && "box" !in productType &&
        product.tcg.equals(sessionTcg, ignoreCase = true) &&
        product.setCode?.equals(sessionSetCode, ignoreCase = true) == true &&
        quantity >= session.packs.size
}

@Serializable
data class PackOpeningOddsReference(
    val title: String,
    val url: String,
    val sampleSize: Int,
    val note: String,
)

@Serializable
data class PackOpeningPackOption(
    val id: String,
    val label: String,
    val setID: String? = null,
    val setLabel: String? = null,
    val variationLabel: String? = null,
    val packPoolID: String? = null,
    val oddsReference: PackOpeningOddsReference? = null,
) {
    val resolvedSetID: String get() = setID ?: id
    val resolvedSetLabel: String get() = setLabel ?: label
    val resolvedVariationLabel: String get() = variationLabel ?: label
}

data class PackOpeningPackSet(
    val id: String,
    val label: String,
    val options: List<PackOpeningPackOption>,
)

@Serializable
data class PackOpeningCardPool(
    val id: String,
    val label: String,
    val cards: List<PackOpeningPull>,
)

@Serializable
data class PackOpeningState(
    val phase: PackOpeningPhase,
    val selectedPackID: String,
    val selectedPackLabel: String,
    val packCount: Int,
    val openingMode: PackOpeningMode,
    val packBackwards: Boolean,
    val currentCardFaceUp: Boolean,
    val packOptions: List<PackOpeningPackOption>,
    val cardPools: List<PackOpeningCardPool> = emptyList(),
    val revealedCount: Int,
    val totalCards: Int,
    val currentPackNumber: Int,
    val totalPacks: Int,
    val canSave: Boolean,
    val warning: String? = null,
    val session: PackOpeningPullSession? = null,
) {
    val packSets: List<PackOpeningPackSet>
        get() = packOptions
            .groupBy(PackOpeningPackOption::resolvedSetID)
            .map { (id, options) ->
                PackOpeningPackSet(id, options.first().resolvedSetLabel, options)
            }

    val selectedPackOption: PackOpeningPackOption?
        get() = packOptions.firstOrNull { it.id == selectedPackID }

    val selectedCardPool: PackOpeningCardPool?
        get() {
            val poolID = selectedPackOption?.packPoolID ?: selectedPackOption?.resolvedSetID
            return cardPools.firstOrNull { it.id.equals(poolID, ignoreCase = true) }
        }

    val selectedOddsReference: PackOpeningOddsReference?
        get() = selectedPackOption?.oddsReference

    val selectedPackDisplayLabel: String
        get() = selectedPackOption?.let {
            "${it.resolvedSetLabel} · ${it.resolvedVariationLabel}"
        } ?: selectedPackLabel

    val showsNativeResults: Boolean
        get() = phase in setOf(PackOpeningPhase.SUMMARY, PackOpeningPhase.FINAL) && session != null

    companion object {
        val Loading = PackOpeningState(
            phase = PackOpeningPhase.LOADING,
            selectedPackID = "",
            selectedPackLabel = "Loading",
            packCount = 1,
            openingMode = PackOpeningMode.NORMAL,
            packBackwards = false,
            currentCardFaceUp = true,
            packOptions = emptyList(),
            revealedCount = 0,
            totalCards = 0,
            currentPackNumber = 0,
            totalPacks = 0,
            canSave = false,
        )
    }
}

enum class PackOpeningAction(val wireName: String) {
    SELECT_PACK("selectPack"),
    SET_PACK_COUNT("setPackCount"),
    SET_OPENING_MODE("setOpeningMode"),
    TOGGLE_PACK_ORIENTATION("togglePackOrientation"),
    OPEN_PACK("openPack"),
    BACK_TO_PACKS("backToPacks"),
    ADVANCE("advance"),
    SHOW_ALL("showAll"),
    SAVE_PULLS("savePulls"),
    UPLOAD_ARTWORK("uploadArtwork"),
}

data class PackOpeningCommand(
    val action: PackOpeningAction,
    val optionID: String? = null,
    val count: Int? = null,
    val mode: PackOpeningMode? = null,
    val dataURL: String? = null,
    val label: String? = null,
    val id: Long = nextCommandID.incrementAndGet(),
) {
    fun encode(): String = buildJsonObject {
        put("type", action.wireName)
        optionID?.let { put("id", it) }
        count?.let { put("count", it) }
        mode?.let { put("mode", it.name.lowercase()) }
        dataURL?.let { put("dataURL", it) }
        label?.let { put("label", it) }
    }.toString()

    companion object {
        private val nextCommandID = AtomicLong()

        fun selectPack(id: String) = PackOpeningCommand(PackOpeningAction.SELECT_PACK, optionID = id)
        fun setPackCount(count: Int) = PackOpeningCommand(PackOpeningAction.SET_PACK_COUNT, count = count)
        fun setOpeningMode(mode: PackOpeningMode) = PackOpeningCommand(PackOpeningAction.SET_OPENING_MODE, mode = mode)
        fun uploadArtwork(dataURL: String, label: String) = PackOpeningCommand(
            PackOpeningAction.UPLOAD_ARTWORK,
            dataURL = dataURL,
            label = label,
        )
    }
}

sealed interface PackOpeningBridgeEvent {
    data object Ready : PackOpeningBridgeEvent
    data class PhaseChanged(val phase: String) : PackOpeningBridgeEvent
    data class NativeState(val state: PackOpeningState) : PackOpeningBridgeEvent
    data class Haptic(val style: String) : PackOpeningBridgeEvent
    data class SaveRequested(val session: PackOpeningPullSession) : PackOpeningBridgeEvent
    data class InspectRequested(val pull: PackOpeningPull) : PackOpeningBridgeEvent
    data class Error(val message: String) : PackOpeningBridgeEvent
}

/** Decodes the JSON envelope emitted by the shared pack-core runtime. */
object PackOpeningBridgeDecoder {
    private val json = Json { ignoreUnknownKeys = true }

    @Serializable private data class StateEnvelope(val state: PackOpeningState)
    @Serializable private data class SessionEnvelope(val session: PackOpeningPullSession)
    @Serializable private data class PullEnvelope(val pull: PackOpeningPull)

    fun decode(payload: String): PackOpeningBridgeEvent? = runCatching {
        val root = json.parseToJsonElement(payload) as? JsonObject ?: return null
        when (root["type"]?.jsonPrimitive?.content) {
            "ready" -> PackOpeningBridgeEvent.Ready
            "phaseChanged" -> PackOpeningBridgeEvent.PhaseChanged(
                root["phase"]?.jsonPrimitive?.content.orEmpty(),
            )
            "nativeState" -> PackOpeningBridgeEvent.NativeState(
                json.decodeFromJsonElement(StateEnvelope.serializer(), root).state,
            )
            "haptic" -> PackOpeningBridgeEvent.Haptic(
                root["style"]?.jsonPrimitive?.content.orEmpty(),
            )
            "saveRequested" -> PackOpeningBridgeEvent.SaveRequested(
                json.decodeFromJsonElement(SessionEnvelope.serializer(), root).session,
            )
            "inspectRequested" -> PackOpeningBridgeEvent.InspectRequested(
                json.decodeFromJsonElement(PullEnvelope.serializer(), root).pull,
            )
            "error" -> PackOpeningBridgeEvent.Error(
                root["message"]?.jsonPrimitive?.content ?: "The pack renderer reported an error.",
            )
            else -> null
        }
    }.getOrNull()
}
