# Offline catalog packs (generated — not committed)

This directory holds the per-game catalog packs used by the web app. Generated
`manifest.json`, `*.pack.json`, and `*.game-package.json` files are reproducible
and gitignored. The game-package files wrap each included catalog in the same
manifest format accepted from independent publishers.

## Regenerate

```bash
npm run catalogs:build
```

The canonical generated copies are written to `data/catalog/`; `--sync` refreshes
this directory and the iOS catalog resources together.

To regenerate only the package manifests from an existing catalog build:

```bash
npm run catalogs:packages
```

## Dragon Ball first build

Dragon Ball uses API TCG as its source. The provider requires an API key even
for catalog reads, so the first complete pack is generated with:

```bash
APITCG_API_KEY=... npm run catalogs:build:dragonball
```

That command writes and syncs the Dragon Ball catalog, adds it to the shared
catalog index, and emits `dragonball.game-package.json`. Once the catalog is in
`data/catalog`, `npm run catalogs:packages` can regenerate its package manifest
without contacting the provider.

## Production package signing

Signing is not required for local catalog development or the initial
TCGer-hosted store release. Official packages are discovered only through the
configured HTTPS catalog origin, and arbitrary URL installs cannot replace the
reserved TCGer package slots. Signing remains the planned stronger publisher
authentication mode. To enable it, keep an Ed25519 private key outside the
repository and run generation with both release variables set:

```bash
npm run game-packages:keygen -- \
  --out /secure/path/tcger-game-packages.pem \
  --key-id tcger-release-1

TCGER_GAME_PACKAGE_SIGNING_PRIVATE_KEY=/secure/path/tcger-game-packages.pem \
TCGER_GAME_PACKAGE_SIGNING_KEY_ID=tcger-release-1 \
npm run catalogs:packages

npm run assets:r2:publish-catalogs -- --check \
  --require-games pokemon,magic,yugioh,onepiece,lorcana,dragonball
```

The public key and detached signature are published with each package. The
private key is never copied into an app, catalog, or public asset directory.
The `--check` preflight requires valid signatures and validates every catalog
before the publishing command is allowed to update the store pointers.
Android enforcement can be enabled for a hardened build with
`-PtcgerRequireSignedOfficialGamePackages=true`; it defaults to `false` during
the initial hosted-store phase.

The manual `Publish catalog assets` GitHub Actions workflow defaults to the
current five-game, unsigned TCGer-hosted release and does not require these
credentials. When Dragon Ball and signing are ready, configure
`APITCG_API_KEY` and `TCGER_GAME_PACKAGE_SIGNING_PRIVATE_KEY_BASE64` as
repository secrets, set the public `TCGER_GAME_PACKAGE_SIGNING_KEY_ID`
repository variable, and select **Require Dragon Ball and valid signatures**
when dispatching the workflow.
