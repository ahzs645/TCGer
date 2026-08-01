#!/usr/bin/env bash

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SCAN_INDEX_DIR="${REPO_ROOT}/mobile-apps/ios/TCGer/TCGer/Resources/ScanIndex"
WEB_INDEX="${REPO_ROOT}/frontend/public/scan-index/pokemon-embeddings.json"
GATE_FIXTURE="${REPO_ROOT}/backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json"
GATE_DESTINATION="${SCAN_INDEX_DIR}/CardFaceGate.json"
TSX="${REPO_ROOT}/node_modules/.bin/tsx"

usage() {
  cat <<'EOF'
Usage: scripts/ios-assets.sh build|check

  build  Generate/sync catalogs and the iOS scanner assets, then validate them.
  check  Validate all catalog copies and required iOS scanner resources.
EOF
}

status() {
  printf '[ios-assets] %-7s %s\n' "$1" "$2"
}

print_coreml_instructions() {
  cat <<'EOF'
[ios-assets] Core ML conversion dependencies are unavailable. Install them with:
  python3.11 -m venv mobile-apps/ios/scripts/.venv-coreml
  mobile-apps/ios/scripts/.venv-coreml/bin/pip install coremltools torch transformers pillow
Then rerun:
  bash scripts/ios-assets.sh build
EOF
}

print_web_index_instructions() {
  cat <<'EOF'
[ios-assets] The source web embedding index is missing. With the catalog image API on 127.0.0.1:4040, generate it with:
  cd backend
  npx --no-install tsx src/scripts/build-embedding-index.ts \
    --tcg pokemon --api-url http://127.0.0.1:4040 \
    --model onnx-community/dinov2-small --encoder dinov2 \
    --out ../frontend/public/scan-index/pokemon-embeddings.json
Then return to the repo root and rerun:
  bash scripts/ios-assets.sh build
EOF
}

copy_gate() {
  if [[ ! -f "${GATE_FIXTURE}" ]]; then
    status "FAILED" "Card-face gate fixture is missing: ${GATE_FIXTURE}"
    return 1
  fi

  mkdir -p "${SCAN_INDEX_DIR}"
  if [[ -f "${GATE_DESTINATION}" ]] && node -e '
    const fs = require("node:fs");
    const [fixture, destination] = process.argv.slice(1).map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
    process.exit(JSON.stringify(fixture) === JSON.stringify(destination) ? 0 : 1);
  ' "${GATE_FIXTURE}" "${GATE_DESTINATION}" >/dev/null 2>&1; then
    status "CURRENT" "CardFaceGate.json already matches the tracked fixture"
    return 0
  fi

  cp "${GATE_FIXTURE}" "${GATE_DESTINATION}"
  status "COPIED" "CardFaceGate.json from backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json"
}

find_coreml_python() {
  local candidate
  local candidates=(
    "${REPO_ROOT}/mobile-apps/ios/scripts/.venv-coreml/bin/python"
    "python3.11"
    "python3"
  )

  for candidate in "${candidates[@]}"; do
    if [[ "${candidate}" == */* ]]; then
      [[ -x "${candidate}" ]] || continue
    elif ! command -v "${candidate}" >/dev/null 2>&1; then
      continue
    fi
    if "${candidate}" -c 'import coremltools, torch, transformers, PIL' >/dev/null 2>&1; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

check_assets() {
  if ! command -v node >/dev/null 2>&1; then
    status "FAILED" "Node.js is required to validate JSON, hashes, and binary index headers"
    return 1
  fi

  node - "${REPO_ROOT}" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2];
const games = ['pokemon', 'magic', 'yugioh'];
const failures = [];
const successes = [];

function relative(file) {
  return path.relative(root, file) || '.';
}

function fail(file, message) {
  failures.push(`${relative(file)} — ${message}`);
}

function readJson(file, label) {
  let contents;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch (error) {
    fail(file, error.code === 'ENOENT' ? `missing ${label}` : error.message);
    return null;
  }
  try {
    return { value: JSON.parse(contents), contents };
  } catch (error) {
    fail(file, `invalid JSON: ${error.message}`);
    return null;
  }
}

function validatePack(packFile, game, manifestEntry) {
  const parsed = readJson(packFile, `${game} catalog pack`);
  if (!parsed) return;
  const pack = parsed.value;

  if (pack.formatVersion !== 1) fail(packFile, `formatVersion must be 1, got ${pack.formatVersion}`);
  if (pack.tcg !== game) fail(packFile, `tcg must be ${game}, got ${pack.tcg}`);
  if (!Array.isArray(pack.cards)) fail(packFile, 'cards must be an array');
  if (!Array.isArray(pack.sets)) fail(packFile, 'sets must be an array');

  if (!manifestEntry) return;
  const byteCount = Buffer.byteLength(parsed.contents);
  const digest = crypto.createHash('sha256').update(parsed.contents).digest('hex');
  if (manifestEntry.file !== `${game}.pack.json`) {
    fail(packFile, `manifest file must be ${game}.pack.json, got ${manifestEntry.file}`);
  }
  if (manifestEntry.bytes !== byteCount) {
    fail(packFile, `manifest bytes ${manifestEntry.bytes} != actual ${byteCount}`);
  }
  if (manifestEntry.sha256 !== digest) {
    fail(packFile, `manifest sha256 ${manifestEntry.sha256} != actual ${digest}`);
  }
  if (Array.isArray(pack.cards) && manifestEntry.cardCount !== pack.cards.length) {
    fail(packFile, `manifest cardCount ${manifestEntry.cardCount} != actual ${pack.cards.length}`);
  }
  if (Array.isArray(pack.sets) && manifestEntry.setCount !== pack.sets.length) {
    fail(packFile, `manifest setCount ${manifestEntry.setCount} != actual ${pack.sets.length}`);
  }
  if (manifestEntry.version !== pack.version) {
    fail(packFile, `manifest version ${manifestEntry.version} != pack version ${pack.version}`);
  }
}

function validateCatalogDirectory(directory) {
  const before = failures.length;
  const manifestFile = path.join(directory, 'manifest.json');
  const parsed = readJson(manifestFile, 'catalog manifest');
  const manifest = parsed?.value;

  if (manifest) {
    if (manifest.formatVersion !== 1) {
      fail(manifestFile, `formatVersion must be 1, got ${manifest.formatVersion}`);
    }
    if (!manifest.games || typeof manifest.games !== 'object' || Array.isArray(manifest.games)) {
      fail(manifestFile, 'games must be an object');
    }
  }

  for (const game of games) {
    const entry = manifest?.games?.[game];
    if (manifest && !entry) fail(manifestFile, `missing games.${game}`);
    validatePack(path.join(directory, `${game}.pack.json`), game, entry);
  }

  if (failures.length === before) {
    successes.push(`${relative(directory)} — manifest, counts, byte sizes, and SHA-256 hashes valid`);
  }
}

validateCatalogDirectory(path.join(root, 'data/catalog'));
validateCatalogDirectory(path.join(root, 'frontend/public/catalog'));
validateCatalogDirectory(path.join(root, 'mobile-apps/ios/TCGer/TCGer/Resources/Catalogs'));

const scanDirectory = path.join(root, 'mobile-apps/ios/TCGer/TCGer/Resources/ScanIndex');

const modelDirectory = path.join(scanDirectory, 'CardEmbeddings.mlpackage');
const modelBefore = failures.length;
try {
  if (!fs.statSync(modelDirectory).isDirectory()) fail(modelDirectory, 'must be an .mlpackage directory');
} catch (error) {
  fail(modelDirectory, error.code === 'ENOENT' ? 'missing Core ML package' : error.message);
}
if (failures.length === modelBefore) {
  readJson(path.join(modelDirectory, 'Manifest.json'), 'Core ML package manifest');
}
if (failures.length === modelBefore) successes.push(`${relative(modelDirectory)} — valid Core ML package`);

const metadataFile = path.join(scanDirectory, 'CardsIndexMetadata.json');
const vectorsFile = path.join(scanDirectory, 'CardsIndexVectors.bin');
const indexBefore = failures.length;
const metadataParsed = readJson(metadataFile, 'scanner index metadata');
let vectorCount = null;
let vectorDimension = null;
if (metadataParsed && !Array.isArray(metadataParsed.value)) {
  fail(metadataFile, 'metadata root must be an array');
}
try {
  const vectors = fs.readFileSync(vectorsFile);
  if (vectors.length < 8) {
    fail(vectorsFile, `binary index is too short (${vectors.length} bytes)`);
  } else {
    vectorCount = vectors.readInt32LE(0);
    vectorDimension = vectors.readInt32LE(4);
    if (vectorCount <= 0 || vectorDimension <= 0) {
      fail(vectorsFile, `invalid header count=${vectorCount}, dimension=${vectorDimension}`);
    } else {
      const expectedBytes = 8 + vectorCount * vectorDimension;
      if (vectors.length !== expectedBytes) {
        fail(vectorsFile, `size ${vectors.length} != header-implied ${expectedBytes}`);
      }
    }
  }
} catch (error) {
  fail(vectorsFile, error.code === 'ENOENT' ? 'missing scanner index vectors' : error.message);
}
if (metadataParsed && Array.isArray(metadataParsed.value) && vectorCount !== null) {
  if (metadataParsed.value.length !== vectorCount) {
    fail(metadataFile, `metadata rows ${metadataParsed.value.length} != vector count ${vectorCount}`);
  }
  const invalidRow = metadataParsed.value.findIndex((row, index) => row?.annIndex !== index);
  if (invalidRow >= 0) fail(metadataFile, `annIndex is not contiguous at row ${invalidRow}`);
}
if (failures.length === indexBefore) {
  successes.push(`${relative(vectorsFile)} + CardsIndexMetadata.json — ${vectorCount} vectors x ${vectorDimension} dimensions valid`);
}

const gateFixture = path.join(root, 'backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json');
const gateFile = path.join(scanDirectory, 'CardFaceGate.json');
const gateBefore = failures.length;
const gateParsed = readJson(gateFile, 'card-face rejection gate');
const fixtureParsed = readJson(gateFixture, 'tracked card-face rejection gate fixture');
if (gateParsed) {
  const gate = gateParsed.value;
  if (gate.kind !== 'tcger-card-face-rejection-gate') fail(gateFile, `unexpected kind ${gate.kind}`);
  if (!Number.isInteger(gate.dimension) || gate.dimension <= 0) fail(gateFile, 'dimension must be a positive integer');
  if (!Array.isArray(gate.weights) || gate.weights.length !== gate.dimension) {
    fail(gateFile, `weights length must equal dimension ${gate.dimension}`);
  }
  if (typeof gate.bias !== 'number' || typeof gate.recommendedThreshold !== 'number') {
    fail(gateFile, 'bias and recommendedThreshold must be numbers');
  }
}
if (gateParsed && fixtureParsed) {
  if (JSON.stringify(gateParsed.value) !== JSON.stringify(fixtureParsed.value)) {
    fail(gateFile, 'does not match the tracked backend fixture');
  }
}
if (failures.length === gateBefore) successes.push(`${relative(gateFile)} — valid and matches tracked fixture`);

for (const message of successes) console.log(`[ios-assets] OK      ${message}`);
if (failures.length) {
  console.error(`[ios-assets] FAILED  ${failures.length} asset validation issue(s):`);
  for (const message of failures) console.error(`[ios-assets] MISSING ${message}`);
  process.exit(1);
}
console.log('[ios-assets] READY   all required iOS assets and synchronized catalogs are valid');
NODE
}

build_assets() {
  local generation_failed=0
  local coreml_python=""

  status "BUILD" "offline catalog packs (canonical + web/iOS synchronized copies)"
  if [[ ! -x "${TSX}" ]]; then
    status "FAILED" "tsx is unavailable at node_modules/.bin/tsx (restore the repository dependencies without using this script)"
    generation_failed=1
  elif (cd "${REPO_ROOT}/backend" && "${TSX}" src/scripts/build-catalog-packs.ts --sync); then
    status "BUILT" "offline catalog packs"
  else
    status "FAILED" "offline catalog generator"
    generation_failed=1
  fi

  if [[ -f "${WEB_INDEX}" ]]; then
    status "BUILD" "iOS embedding index from frontend/public/scan-index/pokemon-embeddings.json"
    if (cd "${REPO_ROOT}/backend" && "${TSX}" src/scripts/build-ios-index.ts --index "${WEB_INDEX}"); then
      status "BUILT" "CardsIndexVectors.bin and CardsIndexMetadata.json"
    else
      status "FAILED" "iOS embedding index generator"
      generation_failed=1
    fi
  else
    status "SKIPPED" "iOS embedding index (source web index is absent)"
    print_web_index_instructions
  fi

  if coreml_python="$(find_coreml_python)"; then
    status "BUILD" "CardEmbeddings.mlpackage with ${coreml_python}"
    if "${coreml_python}" "${REPO_ROOT}/mobile-apps/ios/scripts/convert-dinov2-coreml.py"; then
      status "BUILT" "CardEmbeddings.mlpackage"
    else
      status "FAILED" "Core ML conversion"
      generation_failed=1
    fi
  else
    status "SKIPPED" "Core ML conversion (required Python dependencies are absent)"
    print_coreml_instructions
  fi

  copy_gate || generation_failed=1

  status "CHECK" "validating generated assets"
  if ! check_assets; then
    return 1
  fi
  return "${generation_failed}"
}

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 2
fi

case "$1" in
  build)
    build_assets
    ;;
  check)
    check_assets
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
