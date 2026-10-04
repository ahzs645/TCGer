#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
output="${TCGER_IOS_RELEASE_OUTPUT:-$repo_root/mobile-parity/results/release/ios}"
mkdir -p "$output"
xcodebuild -project "$repo_root/mobile-apps/ios/TCGer/TCGer.xcodeproj" -scheme TCGer -configuration Release -destination 'generic/platform=iOS' -archivePath "$output/TCGer.xcarchive" archive
xcodebuild -exportArchive -archivePath "$output/TCGer.xcarchive" -exportOptionsPlist "$repo_root/mobile-apps/ios/release/ExportOptions.plist" -exportPath "$output/export"
