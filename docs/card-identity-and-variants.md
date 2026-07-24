# Card identity, printings, variants, and owned copies

## Purpose

TCGer receives rich card-catalog records from several upstream services. A
catalog record, however, is not the same thing as the physical object a
collector owns. This document defines where each class of data belongs and how
the API remains compatible while the persistence model evolves.

## Domain layers

1. **Functional identity** describes how a card plays. It includes normalized
   rules, attacks, abilities, HP, subtype, and an optional stable functional
   key. Functionally equivalent reprints may share this identity.
2. **Printing** describes a catalog release: game, set, collector number,
   language, artwork, release date, regulation mark, legality, and source IDs.
3. **Collectible variant** describes a manufactured version of a printing:
   finish, edition, stamp, sealed-promo state, oversized state, and peel-off
   construction.
4. **Owned copy** describes one collector's object: condition, grading,
   certification, signed/altered state, photos, acquisition data, notes, tags,
   and price.
5. **Container** groups owned copies for presentation and organization. A
   container can be a binder, box, album, deck box, case, or another open-ended
   type, and may have a cover image and optional game/set association.

The database represents this incrementally. `CardIdentity` stores the stable
base identity and `Card` stores an exact printing, linked through
`Card.identityId`. Rich printing metadata remains on the card snapshot, while
collectible-variant and ownership data is stored with each collection copy.
Older card rows can remain unlinked until they are refreshed or backfilled.
A dedicated collectible-variant table can still be introduced later without
changing the API vocabulary.

## Field ownership

| Field | Layer | Notes |
| --- | --- | --- |
| `functionalIdentity` | Functional identity | Computed by a game adapter; never inferred from finish |
| `name`, `supertype`, attacks, abilities | Functional identity / printing snapshot | Preserve source data and normalized key separately |
| `setCode`, `collectorNumber`, `releasedAt` | Printing | A printing identifier must not depend on finish |
| `language`, `regulationMark`, legality | Printing | Legality may include current status and historical periods |
| `provenance` | Printing | Source, source record ID, fetch time, and schema version |
| `finishCode`, `finishLabel` | Collectible variant | Code is stable; label is reader-facing and extensible |
| `edition`, `stamp` | Collectible variant | Strings remain open to older and regional products |
| `isSealedPromo`, `isOversized`, `isPeelOff` | Collectible variant | These describe the manufactured object |
| `condition`, grading, signed, altered | Owned copy | These can differ between copies of the same variant |
| price and acquisition data | Owned copy | Catalog market prices remain separate |
| `containerType`, container image | Container | Presentation metadata; never part of card identity |
| associated game/set | Container | Optional organizational hint, not ownership or printing identity |

## Finish codes

Finish values are intentionally open strings rather than a closed enum.
Upstream catalogs commonly expose only `normal`, `reverse`, and `holo`, plus a
separate `firstEdition` flag, while physical releases include named processes such as Cosmos,
Cracked Ice, Confetti, Mirror, Water Web, Crosshatch, and stamped variants.

Clients should:

- preserve an unknown `finishCode`;
- show `finishLabel` when present;
- fall back to a title-cased code;
- treat legacy `isFoil: true` as a generic `holo` only when no finish exists;
- derive `isFoil` from any non-normal foil finish when serving older clients.

Edition flags such as `firstEdition` belong in `edition`, not `finishCode`.

## Legality history

Current legality and historical legality answer different questions.

- Current legality is a quick `standard` / `expanded` status from the upstream
  catalog.
- Historical periods preserve a format or rotation label, validity dates when
  known, and whether the printing was legal during that period.

An absent historical record means "unknown", not "illegal".

## Evolution relationships

Pokémon evolution data is directional:

- `evolvesFrom` names the immediate predecessor printed on the card.
- `evolvesTo` contains known immediate successors when a source provides them.

Relationships are catalog hints, not foreign keys. Names can differ by region
or language, and a later catalog service may resolve them to stable identities.

## Provenance and refresh behavior

Rich metadata must retain its source. Refresh jobs may update catalog fields,
but must not overwrite owned-copy fields. An adapter should populate source,
source record ID, fetch timestamp, and schema version when available.

When two sources are combined, the primary printing record identifies its
source and enrichment-specific IDs remain inside the relevant metadata object
(for example, a TCGdex ID inside Pokémon print metadata).

## Compatibility policy

The migration is additive:

- all new database fields are nullable or optional;
- older `isFoil` requests continue to work;
- newer clients send both a canonical finish and the compatibility boolean
  while mixed server versions are supported;
- unknown rich metadata is passed through rather than discarded;
- collection exports include both canonical variant fields and `isFoil` during
  the compatibility window.
