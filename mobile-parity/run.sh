#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
results_dir="${PARITY_RESULTS_DIR:-$repo_root/mobile-parity/results}"
flows_dir="$repo_root/mobile-parity/maestro"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

run_maestro() {
  local device_id="$1"
  local app_id="$2"
  local platform="$3"
  mkdir -p "$results_dir/$platform-artifacts"
  maestro --device "$device_id" test \
    --include-tags parity \
    --format junit \
    --output "$results_dir/$platform.xml" \
    --test-output-dir "$results_dir/$platform-artifacts" \
    -e "APP_ID=$app_id" \
    "$flows_dir"
}

cd "$repo_root"
node tools/mobile-parity/parity.mjs check

case "${1:-}" in
  web)
    require_command npm
    mkdir -p "$results_dir"
    web_raw_results="$results_dir/web-playwright.xml"
    web_results="$results_dir/web.xml"
    web_summary="$results_dir/web-summary.json"
    set +e
    (
      cd "$repo_root/frontend"
      PLAYWRIGHT_JUNIT_OUTPUT_FILE="$web_raw_results" npm exec -- playwright test \
        --config=playwright.parity.config.ts \
        --reporter=junit
    )
    playwright_status=$?
    set -e
    if [[ -f "$web_raw_results" ]]; then
      node tools/mobile-parity/web-parity.mjs normalize \
        --input "$web_raw_results" \
        --output "$web_results" \
        --summary "$web_summary"
    else
      echo "Playwright did not produce $web_raw_results" >&2
      exit 1
    fi
    exit "$playwright_status"
    ;;
  android)
    require_command adb
    require_command maestro
    mobile-apps/android/gradlew -p mobile-apps/android assembleDebug
    adb wait-for-device
    android_device="${MAESTRO_DEVICE_ID:-$(adb devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')}"
    if [[ -z "$android_device" ]]; then
      echo "No ready Android emulator or device was found." >&2
      exit 1
    fi
    adb -s "$android_device" install -r mobile-apps/android/app/build/outputs/apk/debug/app-debug.apk
    run_maestro "$android_device" "com.ahmadjalil.tcger" android
    ;;
  ios)
    require_command maestro
    require_command xcodebuild
    require_command xcrun
    ios_simulator="${IOS_SIMULATOR:-iPhone 17 Pro}"
    ios_derived_data="${IOS_DERIVED_DATA:-$repo_root/mobile-parity/build/ios-derived-data}"
    xcrun simctl boot "$ios_simulator" 2>/dev/null || true
    xcrun simctl bootstatus "$ios_simulator" -b
    xcodebuild \
      -quiet \
      -project mobile-apps/ios/TCGer/TCGer.xcodeproj \
      -scheme TCGer \
      -configuration Debug \
      -destination "platform=iOS Simulator,name=$ios_simulator,OS=latest" \
      -derivedDataPath "$ios_derived_data" \
      CODE_SIGNING_ALLOWED=NO \
      build
    xcrun simctl install booted "$ios_derived_data/Build/Products/Debug-iphonesimulator/TCGer.app"
    ios_device="${MAESTRO_DEVICE_ID:-$(xcrun simctl list devices booted | sed -n 's/.*(\([0-9A-Fa-f-]\{36\}\)) (Booted).*/\1/p' | head -n 1)}"
    if [[ -z "$ios_device" ]]; then
      echo "No booted iOS simulator was found." >&2
      exit 1
    fi
    run_maestro "$ios_device" "firstform.TCGer" ios
    ;;
  report)
    mkdir -p "$results_dir"
    report_args=(report --output "$results_dir/REPORT.md")
    [[ -f "$results_dir/web.xml" ]] && report_args+=(--web-results "$results_dir/web.xml")
    [[ -f "$results_dir/ios.xml" ]] && report_args+=(--ios-results "$results_dir/ios.xml")
    [[ -f "$results_dir/android.xml" ]] && report_args+=(--android-results "$results_dir/android.xml")
    node tools/mobile-parity/parity.mjs "${report_args[@]}"
    ;;
  *)
    echo "Usage: $0 {web|android|ios|report}" >&2
    exit 2
    ;;
esac
