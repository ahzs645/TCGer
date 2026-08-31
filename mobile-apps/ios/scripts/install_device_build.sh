#!/bin/zsh
# Build TCGer (Debug) for a connected iPhone with automatic signing and install it.
# usage: install-device.sh            (uses the first connected device)
set -eu
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
UDID=$(xcrun devicectl list devices --json-output /tmp/tcger-devices.json >/dev/null 2>&1; python3 -c "
import json; d=json.load(open('/tmp/tcger-devices.json'))
devs=[x for x in d['result']['devices'] if x.get('connectionProperties',{}).get('pairingState')=='paired']
print(devs[0]['identifier'] if devs else '')")
[ -n "$UDID" ] || { echo "no paired iPhone connected (plug in / trust the Mac, then re-run)"; exit 1; }
cd "$(dirname "$0")/../TCGer"
xcodebuild build -project TCGer.xcodeproj -scheme TCGer -configuration Debug \
  -destination "platform=iOS,id=$UDID" -derivedDataPath /tmp/tcger-dd-device -allowProvisioningUpdates \
  > /tmp/tcger-build-device-install.log 2>&1 || { grep -E "error:" /tmp/tcger-build-device-install.log | head -5; exit 1; }
APP=/tmp/tcger-dd-device/Build/Products/Debug-iphoneos/TCGer.app
xcrun devicectl device install app --device "$UDID" "$APP"
echo "installed $(defaults read "$APP/Info" CFBundleShortVersionString) ($(defaults read "$APP/Info" CFBundleVersion)) on $UDID"
