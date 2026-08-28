# Codex Critters import fixture

Codex Critters is intentionally fictional. It is a small but complete
`GamePackageManifest` used to test how a game unknown to TCGer is imported on
web, iOS, and Android. It is not built into any client.

## Import from GitHub Pages

Open **Settings > Community game libraries**, leave the initially empty URL
field unchanged until you are ready to paste, then use:

```text
https://tcger.ahmadjalil.com/game-packages/codex-critters/manifest.json
```

After installation, **Codex Critters** should show eight cards across two sets.
Browsing it exercises search plus multi-select, select, number-range, boolean,
and text filters. Removing it should delete only this downloaded fixture.

This package deliberately declares neither a scanner nor offline packs. It
tests the safe baseline for an unknown game: verified catalog download, offline
storage, browsing, search, and declarative filters.

## Test unpublished edits locally

From the repository root:

```bash
npm run game-packages:fixture
```

Then import this URL in the web client or iOS Simulator:

```text
http://127.0.0.1:4173/game-packages/codex-critters/manifest.json
```

Use the GitHub Pages HTTPS URL for an Android emulator or physical devices.
Their `localhost` is not the development Mac.

Whenever the catalog changes, update `catalog.asset.bytes`,
`catalog.asset.sha256`, `cardCount`, and `setCount` together. The fixture test
rejects drift before a client can install it.
