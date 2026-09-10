#!/usr/bin/env bash

set -euo pipefail

fail() {
  echo "error: $*" >&2
  exit 1
}

if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--validate-only" ) ]]; then
  fail "Usage: submit.sh [--validate-only]"
fi

[[ "${CI_XCODE_CLOUD:-}" == "TRUE" ]] || fail "Submission must run in Xcode Cloud."
[[ "${CI_WORKFLOW:-}" == "Submit Release" ]] || fail "Expected the Submit Release workflow."
[[ -z "${CI_PULL_REQUEST_NUMBER:-}" ]] || fail "Pull requests cannot submit App Store releases."
[[ "${CI_XCODEBUILD_ACTION:-}" == "build" ]] || fail "Submit Release requires exactly one Build action, not Archive or Test."
[[ "${CI_PRODUCT_PLATFORM:-}" == "iOS" ]] || fail "Submit Release requires an iOS Build action."

if [[ "${CI_TAG:-}" =~ ^ios-v([0-9]+\.[0-9]+\.[0-9]+)-b([0-9]+)$ ]]; then
  release_version="${BASH_REMATCH[1]}"
  build_number="${BASH_REMATCH[2]}"
else
  fail "Select an ios-v<version>-b<build> tag, for example ios-v1.0.1-b241. Branch builds cannot submit."
fi

support_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Xcode Cloud copies these symlinked resources into ci_scripts for later phases.
# Do not depend on the original repository or files created by another hook.
project_versions="$(sed -nE 's/^[[:space:]]*MARKETING_VERSION = ([0-9]+(\.[0-9]+){1,2});$/\1/p' "$support_dir/project.pbxproj" | sort -u)"
[[ "$project_versions" == "$release_version" ]] || fail "Tag version $release_version must match every app/widget MARKETING_VERSION; found ${project_versions:-none}."

notes="$support_dir/fastlane/metadata/en-US/release_notes.txt"
[[ -f "$notes" ]] && LC_ALL=C grep -q '[^[:space:]]' "$notes" || fail "Customer-facing release notes must not be empty."

for secret_name in APP_STORE_CONNECT_ISSUER_ID APP_STORE_CONNECT_KEY_ID APP_STORE_CONNECT_PRIVATE_KEY_BASE64; do
  [[ -n "${!secret_name:-}" ]] || fail "Configure $secret_name as a secret in the Submit Release Xcode Cloud workflow."
done

echo "Validated App Store release $release_version ($build_number) from $CI_TAG."
if [[ "${1:-}" == "--validate-only" ]]; then
  exit 0
fi

[[ "${CI_XCODEBUILD_EXIT_CODE:-}" == "0" ]] || fail "Submission requires a successful Build action."

# macOS's system Ruby is too old for the pinned Fastlane. Install a supported
# Ruby through Xcode Cloud's Homebrew, without sudo or changes to system Ruby.
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1
if ! brew list --versions ruby@3.3 >/dev/null 2>&1; then
  brew install ruby@3.3
fi
ruby_prefix="$(brew --prefix ruby@3.3)"
export PATH="$ruby_prefix/bin:$PATH"

bundle_dir="$(mktemp -d "${TMPDIR:-/tmp}/tcger-app-store.XXXXXX")"
trap 'rm -rf "$bundle_dir"' EXIT
export BUNDLE_PATH="$bundle_dir/gems"
export BUNDLE_APP_CONFIG="$bundle_dir/config"
export BUNDLE_GEMFILE="$support_dir/Gemfile"
export BUNDLE_FROZEN=true
export FASTLANE_DISABLE_COLORS=1
export FASTLANE_SKIP_UPDATE_CHECK=1
export FASTLANE_SKIP_PLUGINS_UPDATE_CHECK=1
export FASTLANE_OPT_OUT_USAGE=1

cd "$support_dir"
bundle install --jobs 4 --retry 3
bundle exec fastlane ios submit_release "version:$release_version" "build_number:$build_number"
