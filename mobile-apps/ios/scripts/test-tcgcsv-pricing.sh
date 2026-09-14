#!/bin/bash
set -euo pipefail
# Run the Foundation-only client tests without launching a simulator.
root="$(cd "$(dirname "$0")/../../.." && pwd)"
package="$(mktemp -d)"
trap 'rm -rf "$package"' EXIT
mkdir -p "$package/Sources/TCGer" "$package/Tests/TCGerTests"
cp "$root/mobile-apps/ios/TCGer/TCGer/Services/TCGCSVPriceClient.swift" "$package/Sources/TCGer/"
cp "$root/mobile-apps/ios/TCGer/TCGerTests/TCGCSVPriceClientTests.swift" "$package/Tests/TCGerTests/"
cat > "$package/Package.swift" <<'SWIFT'
// swift-tools-version: 6.2
import PackageDescription
let package = Package(name: "TCGCSVPriceTests", platforms: [.macOS(.v14)], targets: [.target(name: "TCGer"), .testTarget(name: "TCGerTests", dependencies: ["TCGer"])])
SWIFT
swift test --package-path "$package"
