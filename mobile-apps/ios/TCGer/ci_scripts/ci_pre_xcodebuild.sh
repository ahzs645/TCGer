#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -n "${CI_XCODEBUILD_ACTION:-}" && "$CI_XCODEBUILD_ACTION" != "archive" ]]; then
  echo "Skipping the App Store version guard for Xcode Cloud action: $CI_XCODEBUILD_ACTION"
  exit 0
fi

exec "$script_dir/../../scripts/validate-app-store-version.sh"
