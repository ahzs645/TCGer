# OpenYuGi adaptation status

TCGer borrows OpenYuGi's domain ideas while keeping TCGer's TypeScript,
Postgres/Convex, REST, Next.js, and per-physical-copy architecture.

## Domain model

The collection hierarchy is now:

1. `CardIdentity`: the stable base/game identity.
2. `Card`: an exact catalog printing linked to an identity.
3. `Collection`: one physical owned copy and its manufactured variant fields.
4. `Binder`: the storage/presentation container.

Existing rows remain valid because the new identity and printing fields are
nullable. New or refreshed Yu-Gi-Oh records populate `baseExternalId`,
`printingKey`, `artworkId`, and `collectorNumber`.

Yu-Gi-Oh printing keys are reversible structured v1 identifiers:

```text
yugioh:print:v1:<base-id>:<canonical-set-code>:<normalized-rarity>:<artwork-id>
```

Each component is URI encoded. The standard YGOPRODeck response does not prove
which alternate artwork belongs to each set printing, so TCGer only associates
artwork when the upstream record supplies `card_image_id`; it does not invent a
set/artwork cross product.

## Adapted workflows

- Exact Yu-Gi-Oh printings, requested-set mapping, alternate-art-safe images,
  and set-code language/region compatibility.
- Set browser with owned/missing exact printings and both unique-card and
  printing completion.
- Main, Extra, and Side deck zones; searchable pool; ownership/missing counts;
  YDK import/export; classical banlists; and Genesys points.
- Transactional two-pane Bulk Add with defaults, row overrides, filtered batch
  edits, preview, exact-print snapshots, and one atomic commit.
- CSV, JSON, and Cardmarket text collection imports with preview, stable
  failure codes, exact-print ambiguity resolution, and one atomic audited
  commit.
- Immutable collection mutation history and divergence-safe, idempotent undo.
- Binder/container type, cover image URL, and optional game/set association.
- Dashboard completion for unique identities and exact printings in the most
  represented sets.

## Import limitation

PDF sources are detected, but direct PDF text extraction is intentionally not
bundled because the repository has no vetted PDF parser. PDF preview returns
`PDF_TEXT_EXTRACTION_REQUIRED`; users can paste or export the Cardmarket order
text without losing structured failure reporting or ambiguity resolution.

## Rollout

1. Apply the additive Prisma migrations.
2. Deploy the Convex schema/functions when Convex collections are enabled.
3. Refresh catalog records so new printings receive identity links and
   structured printing keys.
4. Backfill legacy Yu-Gi-Oh rows in batches before relying on collection-wide
   identity completion metrics.
5. Keep the compatibility fields (`externalId`, `isFoil`) until all clients
   read the new printing and finish fields.

