package com.ahmadjalil.tcger.data.scanner.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Declarative, per-game acceptance policy for the embedding scanner
 * (`tcger-scanner-acceptance-policy-v1`).
 *
 * Every game runtime is its own encoder/index pair with its own score
 * distribution, so the rules that turn a similarity ranking plus printed
 * evidence into an accept/abstain decision are data, not `game == "magic"`
 * branches. Publishers embed the entry from `tools/scanner-acceptance-policies.json`
 * as the optional `acceptancePolicy` object of each game's scanner manifest.
 * Resolution order: a valid declared policy from the installed manifest,
 * else the built-in profile for the game, else [fallback] for any game the
 * client has never heard of. A future game therefore needs no client code to
 * get a scanner: its manifest declares the policy its replay evidence supports.
 */
@Serializable
data class ScannerAcceptancePolicy(
    val schema: String? = null,
    /** Cosine similarity at which a visual top-1 is accepted with no other evidence. */
    val strongAcceptanceScore: Double = 0.70,
    /** Minimum top-1 minus top-2 (different family) similarity before abstaining. */
    val ambiguityMargin: Double = 0.05,
    /** Lowest similarity at which printed evidence may confirm a candidate. */
    val evidenceFloor: Double = 0.55,
    val titleGate: TitleGate = TitleGate.NEVER,
    /** An exact, catalog-unique title confirms its visual neighbour from [evidenceFloor]. */
    val uniqueTitleRescue: Boolean = true,
    /**
     * An exact title naming the same card the image ranked first (no
     * different-name rival inside [ambiguityMargin]) confirms the visual
     * family from [evidenceFloor]; the printing is then resolved normally.
     */
    val titleAgreementRescue: Boolean = true,
    val collectorNumberScope: CollectorNumberScope = CollectorNumberScope.FAMILY,
    /**
     * Hub rejection: abstain when at least [hubDistinctNames] DIFFERENT card
     * names sit at or above [hubSimilarity] among the top [hubTopK]
     * neighbours. Genuine matches never look like that; degenerate crops
     * (blank, glare-saturated, mis-rectified) do. 0 disables.
     */
    val hubSimilarity: Double = 0.90,
    val hubDistinctNames: Int = 2,
    val hubTopK: Int = 5,
    /**
     * Colour normalization applied to every query crop before the encoder's
     * resize contract ([QueryColorNormalization]). Per game because it depends
     * on what the encoder was trained on: the catalog-only Magic encoder gains
     * (108 labeled frames: correct family first on 79 raw vs 104 normalized
     * crops), the Pokémon encoder trained toward camera captures loses.
     */
    val queryNormalization: QueryNormalization = QueryNormalization.NONE,
) {
    @Serializable
    enum class QueryNormalization {
        @SerialName("none") NONE,
        @SerialName("grey-world-autocontrast") GREY_WORLD_AUTOCONTRAST,
    }

    @Serializable
    enum class TitleGate {
        @SerialName("never") NEVER,
        @SerialName("binderPage") BINDER_PAGE,
        @SerialName("intentionalCaptures") INTENTIONAL_CAPTURES,
    }

    @Serializable
    enum class CollectorNumberScope {
        /** Only the family row's representative printing (legacy behaviour). */
        @SerialName("representative") REPRESENTATIVE,
        /** Every printing the family row represents. */
        @SerialName("family") FAMILY,
    }

    /** Structural validity; a broken publish falls back to the built-in profile. */
    val isValid: Boolean
        get() = (schema == null || schema == SCHEMA) &&
            strongAcceptanceScore in 0.0..1.0 &&
            ambiguityMargin in 0.0..1.0 &&
            evidenceFloor in 0.0..1.0 &&
            evidenceFloor <= strongAcceptanceScore &&
            hubSimilarity in 0.0..1.0 && hubDistinctNames >= 0 && hubTopK >= 1

    /** Hub collapse over ranked (name, similarity) pairs; see [hubDistinctNames]. */
    fun isHubCollapse(candidates: List<Pair<String, Double>>): Boolean {
        if (hubDistinctNames <= 0) return false
        val names = candidates.take(hubTopK)
            .filter { it.second >= hubSimilarity }
            .map { normalizedScannerCardName(it.first) }
            .toSet()
        return names.size >= hubDistinctNames
    }

    /** Whether any bounded OCR rescue is enabled for intentional captures. */
    val permitsManualOcrRescue: Boolean
        get() = uniqueTitleRescue || titleAgreementRescue || titleGate != TitleGate.NEVER

    companion object {
        const val SCHEMA = "tcger-scanner-acceptance-policy-v1"

        /**
         * Conservative profile for a game with no replay evidence: the highest
         * measured strong-accept point, visual-first, bounded OCR rescues.
         */
        val fallback = ScannerAcceptancePolicy()

        /**
         * Built-in profiles mirroring `tools/scanner-acceptance-policies.json`
         * for the shipped games; they serve manifests that predate the field.
         */
        fun builtin(game: String): ScannerAcceptancePolicy = when (normalizeScannerGame(game)) {
            "pokemon", "yugioh" -> ScannerAcceptancePolicy(
                strongAcceptanceScore = ArcFaceModelContract.strongAcceptanceScore,
                ambiguityMargin = ArcFaceModelContract.ambiguityMargin,
            )
            // 49 labeled frames (2026-08-27 + 2026-08-29): plain-visual 0.65
            // admitted three wrong accepts at 0.64–0.69, 0.70 admitted none.
            "magic" -> ScannerAcceptancePolicy(
                strongAcceptanceScore = 0.70,
                ambiguityMargin = ArcFaceModelContract.ambiguityMargin,
                titleGate = TitleGate.BINDER_PAGE,
                queryNormalization = QueryNormalization.GREY_WORLD_AUTOCONTRAST,
            )
            else -> fallback
        }

        /** A valid declared policy wins; anything else resolves to the built-in profile. */
        fun resolve(game: String, declared: ScannerAcceptancePolicy?): ScannerAcceptancePolicy =
            declared?.takeIf { it.isValid } ?: builtin(game)
    }
}
