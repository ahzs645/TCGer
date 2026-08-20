import Foundation
import XCTest
@testable import TCGer

final class PricingSourcePreferencesTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "PricingSourcePreferencesTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func testPreferencesRoundTripByNormalizedGameName() {
        PricingSourcePreferences.save(
            [" Magic ": .justTCG, "POKEMON": .tcgDexCardmarket],
            to: defaults
        )

        XCTAssertEqual(
            PricingSourcePreferences.preferredSource(for: "magic", in: defaults),
            .justTCG
        )
        XCTAssertEqual(
            PricingSourcePreferences.preferredSource(for: " pokemon ", in: defaults),
            .tcgDexCardmarket
        )
    }

    func testPerGamePreferenceOverridesGlobalSource() {
        defaults.set(PricingSource.scryfall.rawValue, forKey: PricingSource.storageKey)
        PricingSourcePreferences.save([TCGGame.pokemon.rawValue: .tcgDexCardmarket], to: defaults)

        XCTAssertEqual(PricingSource.selected(for: "pokemon", in: defaults), .tcgDexCardmarket)
        XCTAssertEqual(PricingSource.selected(for: "magic", in: defaults), .scryfall)
    }

    func testJustTCGGlobalSourceSupportsPokemon() {
        defaults.set(PricingSource.justTCG.rawValue, forKey: PricingSource.storageKey)

        XCTAssertEqual(PricingSource.selected(for: "pokemon", in: defaults), .justTCG)
    }
}
