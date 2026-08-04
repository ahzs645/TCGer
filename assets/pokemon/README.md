# Pokémon vector artwork

Run `node tools/pokemon/import-set-vectors.mjs --source <svg-directory>` after building the catalog packs. The importer validates the SVG subset, maps symbols to canonical TCGdex set IDs, and generates content-hashed SVGs plus the backend URL map. The iOS app falls back to TCGdex's raster set symbol when a vector cannot load.

The current source archive was supplied locally and contains no author or license notice. Confirm redistribution rights before committing the generated artwork or publishing it with `npm run assets:r2:publish-catalogs -- --pokemon-vectors`.

Pokémon rarity artwork in `rarity-symbols/` is generated from the sibling
`Rarities` folder with:

```sh
node tools/pokemon/import-rarity-vectors.mjs --source "/path/to/Pokémon TCG Vectors/Rarities"
```

The importer includes only exact rarity matches and rejects unsafe/non-vector
SVG features. Modern rarity labels without a matching source symbol remain
text-only. TCGdex does not expose rarity-symbol images, so there is no provider
raster to duplicate or cache for these badges.
