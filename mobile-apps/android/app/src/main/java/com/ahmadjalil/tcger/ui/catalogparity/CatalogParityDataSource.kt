package com.ahmadjalil.tcger.ui.catalogparity

import com.ahmadjalil.tcger.data.preferences.normalizeServerUrl
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface CatalogParityDataSource {
    suspend fun sets(tcg: String? = null): SetCatalogResult
    suspend fun setCards(tcg: String, setCode: String): List<CatalogParityCard>
    suspend fun guides(): List<CollectionGuide>
    suspend fun guideCards(filters: GuideCardFilters = GuideCardFilters()): GuideCardSearchResponse
    suspend fun followGuide(slug: String, wishlistName: String? = null): FollowGuideResponse
}

data class SetCatalogResult(val sets: List<CatalogSet>, val failedProviders: List<String> = emptyList())

data class GuideCardFilters(
    val query: String = "",
    val tcg: String? = null,
    val guide: String? = null,
    val category: GuideCategory? = null,
    val ownership: String = "all",
    val limit: Int = 500,
)

@Serializable private data class SetCatalogResponse(
    val sets: List<CatalogSet> = emptyList(),
    val total: Int = 0,
    val failedProviders: List<String> = emptyList(),
)
@Serializable private data class CardCatalogResponse(
    val cards: List<CatalogParityCard> = emptyList(),
    val total: Int = 0,
)

private interface CatalogParityApi {
    @GET("cards/sets")
    suspend fun sets(
        @Header("Authorization") auth: String,
        @Query("tcg") tcg: String? = null,
    ): SetCatalogResponse

    @GET("cards/sets/{tcg}/{setCode}")
    suspend fun setCards(
        @Header("Authorization") auth: String,
        @Path("tcg") tcg: String,
        @Path("setCode") setCode: String,
    ): CardCatalogResponse

    @GET("guides") suspend fun guides(@Header("Authorization") auth: String): List<CollectionGuide>

    @GET("guides/cards")
    suspend fun guideCards(
        @Header("Authorization") auth: String,
        @Query("query") query: String,
        @Query("tcg") tcg: String?,
        @Query("guide") guide: String?,
        @Query("category") category: String?,
        @Query("ownership") ownership: String,
        @Query("limit") limit: Int,
    ): GuideCardSearchResponse

    @POST("guides/{slug}/follow")
    suspend fun followGuide(
        @Header("Authorization") auth: String,
        @Path("slug") slug: String,
        @Body request: FollowGuideRequest,
    ): FollowGuideResponse
}

class RemoteCatalogParityDataSource(
    rawServerUrl: String,
    token: String,
    client: OkHttpClient = OkHttpClient(),
) : CatalogParityDataSource {
    private val auth = "Bearer $token"
    private val api = Retrofit.Builder()
        .baseUrl(normalizeServerUrl(rawServerUrl))
        .client(client)
        .addConverterFactory(
            Json { ignoreUnknownKeys = true; explicitNulls = false }
                .asConverterFactory("application/json".toMediaType()),
        )
        .build()
        .create(CatalogParityApi::class.java)

    override suspend fun sets(tcg: String?): SetCatalogResult = api.sets(auth, tcg).let {
        SetCatalogResult(it.sets, it.failedProviders)
    }

    override suspend fun setCards(tcg: String, setCode: String): List<CatalogParityCard> =
        api.setCards(auth, tcg, setCode).cards

    override suspend fun guides(): List<CollectionGuide> = api.guides(auth)

    override suspend fun guideCards(filters: GuideCardFilters): GuideCardSearchResponse = api.guideCards(
        auth = auth,
        query = filters.query,
        tcg = filters.tcg,
        guide = filters.guide,
        category = filters.category?.let(::guideCategoryApiValue),
        ownership = filters.ownership,
        limit = filters.limit.coerceIn(1, 2_000),
    )

    override suspend fun followGuide(slug: String, wishlistName: String?): FollowGuideResponse =
        api.followGuide(auth, slug, FollowGuideRequest(wishlistName?.trim()?.ifBlank { null }))
}

class LocalCatalogParityDataSource(
    private val cards: List<CatalogParityCard>,
    private val localGuides: List<CollectionGuide> = BuiltInCollectionGuides.all,
    private val followedWishlistIds: MutableMap<String, String> = mutableMapOf(),
    private val onFollow: suspend (
        guide: CollectionGuide,
        wishlistName: String,
        cards: List<CatalogParityCard>,
    ) -> String = { guide, _, _ ->
        "local-guide-${guide.slug}"
    },
) : CatalogParityDataSource {
    override suspend fun sets(tcg: String?): SetCatalogResult {
        val scoped = cards.filter { tcg == null || it.tcg.equals(tcg, true) }
        val sets = scoped.filter { !it.setCode.isNullOrBlank() }.groupBy {
            "${it.tcg.lowercase()}::${it.setCode!!.lowercase()}"
        }.map { (_, setCards) ->
            val first = setCards.first()
            CatalogSet(
                code = requireNotNull(first.setCode),
                name = first.setName ?: first.setCode,
                tcg = first.tcg,
                totalCards = setCards.distinctBy(CatalogParityCard::id).size,
                standardCards = setCards.distinctBy(CatalogParityCard::collectorNumber).size,
            )
        }
        return SetCatalogResult(sets)
    }

    override suspend fun setCards(tcg: String, setCode: String): List<CatalogParityCard> = cards.filter {
        it.tcg.equals(tcg, true) && it.setCode.equals(setCode, true)
    }

    override suspend fun guides(): List<CollectionGuide> = localGuides.map { guide ->
        val wishlist = followedWishlistIds[guide.slug]
        guide.copy(followed = wishlist != null, wishlistId = wishlist)
    }

    override suspend fun guideCards(filters: GuideCardFilters): GuideCardSearchResponse {
        val selectedGuides = guides().filter { guide ->
            (filters.tcg == null || guide.tcg.equals(filters.tcg, true)) &&
                (filters.guide == null || guide.slug == filters.guide || guide.id == filters.guide) &&
                (filters.category == null || guide.category == filters.category)
        }
        val results = linkedMapOf<String, GuideCardResult>()
        selectedGuides.forEach { guide ->
            expand(guide).forEachIndexed { index, card ->
                val membership = GuideCardMembership(
                    guideId = guide.id,
                    slug = guide.slug,
                    title = guide.title,
                    category = guide.category,
                    tags = guide.tags,
                    position = index,
                )
                val key = "${card.tcg}:${card.id}"
                val old = results[key]
                results[key] = if (old == null) GuideCardResult(card, matchedGuides = listOf(membership))
                else old.copy(matchedGuides = old.matchedGuides + membership)
            }
        }
        val query = filters.query.trim()
        val filtered = results.values.filter { result ->
            query.isBlank() || listOfNotNull(
                result.card.name, result.card.setName, result.card.setCode,
                result.card.collectorNumber, result.card.artist,
            ).any { it.contains(query, true) } || result.matchedGuides.any {
                it.title.contains(query, true) || it.tags.any { tag -> tag.contains(query, true) }
            }
        }.take(filters.limit.coerceIn(1, 2_000))
        return GuideCardSearchResponse(filtered, filtered.size)
    }

    override suspend fun followGuide(slug: String, wishlistName: String?): FollowGuideResponse {
        val guide = localGuides.firstOrNull { it.slug == slug }
            ?: throw IllegalArgumentException("Collection guide not found")
        val existing = followedWishlistIds[slug]
        val id = existing ?: onFollow(
            guide,
            wishlistName?.trim()?.ifBlank { null } ?: guide.title,
            expand(guide),
        )
        followedWishlistIds[slug] = id
        return FollowGuideResponse(guide.copy(followed = true, wishlistId = id), id, existing == null)
    }

    private fun expand(guide: CollectionGuide): List<CatalogParityCard> = cards.filter { card ->
        if (!card.tcg.equals(guide.tcg, true)) return@filter false
        when (guide.rule.type.lowercase()) {
            "name" -> card.name.equals(guide.rule.query, true)
            "set" -> card.setCode.equals(guide.rule.setCode, true)
            "artist" -> card.artist?.contains(guide.rule.query.orEmpty(), true) == true
            "tag" -> card.rarity?.contains(guide.rule.query.orEmpty().substringAfterLast('.'), true) == true
            else -> false
        }
    }.ifEmpty {
        if (guide.slug == "pokemon-crown-zenith-connected-art") crownZenithConnectedArtCards else emptyList()
    }
}

/** Uses the same resilient behavior as iOS: retain useful bundled content when the server is unavailable. */
class ResilientCatalogParityDataSource(
    private val remote: CatalogParityDataSource,
    private val fallback: CatalogParityDataSource,
) : CatalogParityDataSource {
    override suspend fun sets(tcg: String?) = runCatching { remote.sets(tcg) }.getOrElse { fallback.sets(tcg) }
    override suspend fun setCards(tcg: String, setCode: String) =
        runCatching { remote.setCards(tcg, setCode) }.getOrElse { fallback.setCards(tcg, setCode) }
    override suspend fun guides() = runCatching { remote.guides() }.getOrElse { fallback.guides() }
    override suspend fun guideCards(filters: GuideCardFilters) =
        runCatching { remote.guideCards(filters) }.getOrElse { fallback.guideCards(filters) }
    override suspend fun followGuide(slug: String, wishlistName: String?) = remote.followGuide(slug, wishlistName)
}

internal fun guideCategoryApiValue(category: GuideCategory): String = when (category) {
    GuideCategory.ART_STYLE -> "art-style"
    GuideCategory.ARTIST -> "artist"
    GuideCategory.SPECIES -> "species"
    GuideCategory.STORY -> "story"
    GuideCategory.CAMEO -> "cameo"
    GuideCategory.CUSTOM -> "custom"
}

object BuiltInCollectionGuides {
    val all = listOf(
        CollectionGuide(
            id = "local-guide-pokemon-clay-art", slug = "pokemon-clay-art", title = "Pokémon Clay Art",
            description = "English Pokémon cards illustrated with sculpted clay scenes.", tcg = "pokemon",
            category = GuideCategory.ART_STYLE, coverImageUrl = "https://assets.tcgdex.net/en/neo/neo2/37/low.webp",
            tags = listOf("Clay", "Sculpture", "Photography"), featured = true,
            rule = CollectionGuideRule("artist", "pokemon", query = "Yuka Morii"), cardCountHint = 224,
        ),
        CollectionGuide(
            id = "local-guide-every-ditto", slug = "every-ditto", title = "Every Ditto",
            description = "Every English Pokémon TCG printing named Ditto.", tcg = "pokemon",
            category = GuideCategory.SPECIES, coverImageUrl = "https://assets.tcgdex.net/en/base/base3/3/low.webp",
            tags = listOf("Ditto", "Species collection"), featured = true,
            rule = CollectionGuideRule("name", "pokemon", query = "Ditto"), cardCountHint = 30,
        ),
        CollectionGuide(
            id = "local-guide-pokemon-crown-zenith-connected-art", slug = "pokemon-crown-zenith-connected-art",
            title = "Crown Zenith Connected Art",
            description = "Nine Galarian Gallery cards by Kouki Saitou that assemble into one continuous scene.",
            tcg = "pokemon", category = GuideCategory.STORY,
            coverImageUrl = "https://images.pokemontcg.io/swsh12pt5gg/GG30.png",
            tags = listOf("Connected Art", "Panorama", "Crown Zenith", "Kouki Saitou"), featured = true,
            rule = CollectionGuideRule("manual", "pokemon", includeAllPrintings = false), cardCountHint = 9,
        ),
    )
}

private val crownZenithConnectedArtCards = listOf(
    "GG26" to "Riolu", "GG27" to "Swablu", "GG28" to "Duskull",
    "GG29" to "Bidoof", "GG30" to "Pikachu", "GG31" to "Turtwig",
    "GG32" to "Paras", "GG33" to "Poochyena", "GG34" to "Mareep",
).map { (number, name) ->
    CatalogParityCard(
        id = "swsh12.5gg-$number", name = name, tcg = "pokemon",
        setCode = "swsh12.5gg", setName = "Crown Zenith Galarian Gallery",
        rarity = "Rare", collectorNumber = number, artist = "Kouki Saitou",
        imageUrl = "https://images.pokemontcg.io/swsh12pt5gg/${number}_hires.png",
        imageUrlSmall = "https://images.pokemontcg.io/swsh12pt5gg/$number.png",
    )
}
