#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-false}" == "true" ]]; then
  echo "iOS verification runs locally only." >&2
  exit 1
fi
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
npm run parity:check
simulator_id="${MAESTRO_DEVICE_ID:-$(xcrun simctl list devices available -j | node tools/mobile-parity/select-ios-simulator.mjs)}"
export MAESTRO_DEVICE_ID="$simulator_id"
export IOS_DERIVED_DATA="${IOS_DERIVED_DATA:-$repo_root/mobile-parity/build/ios-derived-data}"
export API_CONTRACT_IOS_DERIVED_DATA="$IOS_DERIVED_DATA"
export API_CONTRACT_IOS_DESTINATION="platform=iOS Simulator,id=$simulator_id"
export API_CONTRACT_IOS_EXTRA_TESTS="${API_CONTRACT_IOS_EXTRA_TESTS:-DeviceAuthenticationTests,DeepLinkRoutingTests,LocalAPIRepositoryInjectionTests,PackageScannerDownloadTests}"
# XCTest (including the regression classes) must finish before Maestro on this UUID.
npm run api-contracts:ios
npm run parity:ios
