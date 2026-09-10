#!/usr/bin/env bash

set -euo pipefail

if [[ "${CI_WORKFLOW:-}" != "Submit Release" ]]; then
  echo "App Store submission is only enabled in the Submit Release workflow."
  exit 0
fi

# This workflow has one Build action, never Archive. It promotes an existing
# TestFlight upload, so it does not wait for this workflow's own upload.
if [[ "${CI_XCODEBUILD_EXIT_CODE:-}" != "0" ]]; then
  echo "error: refusing App Store submission because the build did not succeed." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$script_dir/app_store_release/submit.sh"
