# Artwork-family matching and Pokémon reprints

## Finding

There is no Pokémon equivalent to Scryfall's openly reusable
`illustration_id` in the provider data TCGer currently consumes. TCGdex card
briefs and the PokémonTCG data repository identify card printings and images,
but do not declare that two printings use the same illustration.

Existing projects still provide useful evidence:

- [Eyevo's Pokémon Reprints Database](https://eyevotcg.com/reprints/) reported
  631 same-art groups covering 1,421 cards when checked on 2026-08-28. It is a
  valuable independent benchmark, but no public export/API or reuse license
  was found. TCGer must not scrape or redistribute it without permission.
- [rarebox](https://github.com/novaoc/rarebox) is an open-source scanner that
  shortlists more than 30,000 reference images with pHash/dHash, then reranks
  with normalized cross-correlation and a name-band comparison. This is useful
  implementation evidence, not a curated family dataset.
- [pokemon-card-recognizer](https://github.com/prateekt/pokemon-card-recognizer)
  provides exact-card reference-building and recognition examples.
- [ImageHash](https://github.com/JohannesBuchner/imagehash) supplies maintained
  perceptual-hash implementations suitable for candidate generation.
- [PokeGallery](https://github.com/AyLoLo/PokeGallery) models relationships
  between artworks and cards, but is small/outdated and not a complete family
  source.

The [PokémonTCG data repository](https://github.com/PokemonTCG/pokemon-tcg-data)
and [TCGdex REST card schema](https://tcgdex.dev/rest/cards) remain the printing
catalog inputs. They should not be treated as artwork-family ground truth.

## Reproducible family builder

Pokémon scanner releases should build a reviewed overlay rather than modify the
general catalog:

1. Start from the physical-only 19,507-row catalog; fail if any `tcgp`/Pocket
   row is present.
2. Normalize orientation and crop the illustration window. Exclude borders,
   title, HP, weakness/resistance, footer, collector number, and set symbol so
   a reprint frame does not dominate the comparison.
3. Generate high-recall candidates using pHash/dHash plus an embedding nearest
   neighbor search. Restrict ordinary candidates to the same normalized card
   name; cross-name pairs require an explicit curated exception.
4. Confirm candidates with normalized cross-correlation on several small crop
   translations/scales. Do not merge on one threshold alone.
5. Produce a review queue containing side-by-side source images, similarity
   evidence, proposed family ID, exact printing IDs, and source revisions.
6. A reviewer accepts, splits, or rejects each proposed family. The accepted
   overlay is versioned and immutable; rejected pairs are retained as negative
   constraints so later incremental runs do not repeatedly propose them.
7. Join the overlay into normalized metadata as `recognitionFamilyId`; retain
   one gallery row and `exactPrintingId` per physical printing, plus
   `releaseDate` for deterministic Quick Scan fallback.

The artifact must report row count, family count, singleton count, reviewed
multi-print family count, rejected-pair count, input catalog hash, algorithm
version, and reviewer revision. A later release only compares new/changed
images against existing family representatives and a small nearest-neighbor
neighborhood; it does not require an all-pairs scan.

## Validation and release gate

Eyevo groups may be manually sampled as an external benchmark without copying
their database. Measure pair recall and false merges on that sample, then use a
separate TCGer-reviewed holdout for the release decision. At minimum, manually
review every multi-print family in the first release and every changed family
in incremental releases.

Do not publish a family-trained Pokémon model/index until:

- the overlay has zero Pocket rows and no cross-name merge without a reviewed
  exception;
- train/validation/test assignment is family-disjoint;
- Exact Printing mode never auto-adds an unresolved family;
- Quick Scan's selected row is the newest eligible dated printing and records
  `latest_fallback`;
- footer/set verification overrides that fallback and records `verified`;
- iOS, Android, and web pass the same resolver fixtures.

Until then, existing Pokémon artifacts remain exact-print-row artifacts. The
two-mode runtime safely treats missing family metadata as a singleton instead
of guessing that equal names share artwork.
