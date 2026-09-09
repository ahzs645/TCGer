# Grading and pricing parity implementation

Scope: the grading/pricing gaps identified in the September 7 comparison with The Tin. TCGer uses an original implementation, shared wire contracts, and native SwiftUI/Compose views. No source was copied from The Tin.

## Implemented on web, iOS, and Android

| Capability | Behavior |
| --- | --- |
| Entry points | Prices → Grading planner; collection/library operations also exposes the planner, including offline native mode. |
| Card lookup | Search Pokémon by name, choose the exact card, or supply a TCGplayer product ID; English/Japanese selection. |
| Grader options | PSA, BGS, CGC, SGC, ACE, TAG, HGA, ARS, plus returned provider graders. BGS/CGC half grades and specialty outcomes remain distinct. Availability varies by provider and card. |
| Decision | Raw versus graded net proceeds, per-grade gain/loss, expected value, expected gain, and lowest priced grade that beats raw. |
| Costs | Grading quote, service-tier/reference label, round-trip shipping, insurance, potential upcharges, and separate raw/graded selling percentages and fixed costs. No current service fee is hardcoded. |
| Population | Per-grade counts/weights, submitted-population warning, provider gem rate, and low-data notice. Users can edit scenario weights. |
| Missing data | Unknown prices remain blank. Expected-value verdicts require prices for every weighted outcome, including auth/qualifier/unclassified population. |
| Estimates | Optional log interpolation strictly between positive numeric price anchors. No extrapolation; interpolated prices are visibly marked. |
| History | Dated per-grade eBay average sale prices in USD. No fabricated history; unavailable data has an explicit empty state. |
| Raw prices | Printing × condition prices returned by the provider, explicitly selected by the user. No automatic near-mint assumption. |
| Provenance | Provider, source link, retrieval timestamp, graded source update timestamp when available, lifetime sales count, and returned confidence. Saved snapshots retain provenance. |
| Offline | Manual calculator and saved scenario work without a server. Saved live snapshots remain available offline. |
| Actual expenses | Local receipt per named card/copy records grader, service, payment date, grading/shipping/insurance/upcharge breakdown, and total; receipts can be deleted. |

## Data boundary

`POST /grading/search` and `POST /grading/snapshot` require the existing authenticated server session. The server holds the provider key. Snapshot requests use an exact product ID and reject mismatched results. One snapshot collects all grades; partial population failures preserve usable prices. Snapshots are cached in memory for six hours, coalesced while in flight, and bounded to 200 entries.

The provider is Pokémon Price Tracker: [API reference](https://www.pokemonpricetracker.com/api-reference). Population data requires the provider's Business/Enterprise plan. Existing `POKEMON_PRICE_TRACKER_API_KEY` and `POKEMON_PRICE_TRACKER_LICENSE_ACK` settings remain required. No subscription, credential, or deployment settings were changed.

## Deliberate limits

- Population is the distribution of submitted cards, not a physical condition assessment of this copy. Grader selection does not imply that live quotes exist for that grader.
- Fee amounts are user-entered quotes, not an automatically maintained PSA/BGS/CGC service-fee directory.
- Receipt and scenario storage is local to each device/browser. Receipts are separate from collection acquisition cost and sale cost basis; there is no automatic portfolio or insurance-value adjustment and no cross-device receipt sync.
- This adds parity for the grading workspace, not a claim that every unrelated feature in The Tin or every existing TCGer screen is identical across platforms.

## Verification

Shared economic fixtures: `mobile-parity/fixtures/grading-calculations.json`, exercised by backend Jest, iOS XCTest, and Android JUnit. They cover all cost components, asymmetric selling fees, incomplete coverage, interpolation, no extrapolation, explicit zero, no population, and losses.

Provider tests cover half-grade joins, specialty/unclassified population, gem-rate units, exact product matching, partial population failure, and cache reuse. Web Playwright exercises economics, changing fees, grader switching, saved scenarios, population/history states, and receipt creation/restoration/deletion.

The parity manifest records source and test evidence separately from execution. See the completion report for commands and their actual results.
