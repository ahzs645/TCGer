import UIKit
import XCTest
@testable import TCGer

final class PokemonRarityArtworkTests: XCTestCase {
    func testMapsKnownLabelsToStableAssetNamesAndPNGFallbacks() throws {
        let expectedAssets = [
            "Amazing Rare": "PokemonRarityAmazingRare",
            "Common": "PokemonRarityCommon",
            "Uncommon": "PokemonRarityUncommon",
            "Rare": "PokemonRarityRare",
            "Rare Holo": "PokemonRarityRareHolo",
            "Shiny Rare": "PokemonRarityShinyRare",
            "Shiny Ultra Rare": "PokemonRarityShinyUltraRare",
            "Ultra Rare": "PokemonRarityUltraRare",
            "Promo": "PokemonRarityPromo"
        ]

        for (rarity, expectedAssetName) in expectedAssets {
            let artwork = try XCTUnwrap(PokemonRarityArtworkCatalog.artwork(for: rarity))
            XCTAssertEqual(artwork.assetName, expectedAssetName, rarity)
            XCTAssertTrue(artwork.fallbackFilename.hasSuffix(".png"), rarity)
        }

        XCTAssertEqual(
            PokemonRarityArtworkCatalog.artwork(for: "Holo Rare")?.assetName,
            "PokemonRarityRareHolo"
        )
        XCTAssertNil(PokemonRarityArtworkCatalog.artwork(for: "Illustration Rare"))
    }

    @MainActor
    func testEveryMappedImageExistsInTheCompiledAssetCatalog() throws {
        let rarities = [
            "Amazing Rare",
            "Common",
            "Uncommon",
            "Rare",
            "Rare Holo",
            "Shiny Rare",
            "Shiny Ultra Rare",
            "Ultra Rare",
            "Promo"
        ]

        for rarity in rarities {
            let artwork = try XCTUnwrap(PokemonRarityArtworkCatalog.artwork(for: rarity))
            XCTAssertNotNil(
                UIImage(named: artwork.assetName),
                "Missing compiled vector asset \(artwork.assetName) for \(rarity)"
            )
        }
    }
}
