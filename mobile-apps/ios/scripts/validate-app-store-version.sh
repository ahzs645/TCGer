#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ios_root="$(cd "$script_dir/.." && pwd)"
repo_root="$(git -C "$ios_root" rev-parse --show-toplevel)"
project_relative_path="mobile-apps/ios/TCGer/TCGer.xcodeproj/project.pbxproj"
project_file="$repo_root/$project_relative_path"
live_version_file="$ios_root/APP_STORE_LIVE_VERSION"

extract_project_versions() {
  sed -nE 's/^[[:space:]]*MARKETING_VERSION = ([0-9]+(\.[0-9]+){1,2});$/\1/p' | sort -u
}

validate_version_format() {
  local version="$1"
  local label="$2"

  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]; then
    echo "error: $label must contain a two- or three-part numeric version; found '$version'." >&2
    exit 1
  fi
}

version_is_greater() {
  local candidate="$1"
  local floor="$2"
  local candidate_major candidate_minor candidate_patch
  local floor_major floor_minor floor_patch

  IFS=. read -r candidate_major candidate_minor candidate_patch <<< "$candidate"
  IFS=. read -r floor_major floor_minor floor_patch <<< "$floor"
  candidate_patch="${candidate_patch:-0}"
  floor_patch="${floor_patch:-0}"

  if (( candidate_major != floor_major )); then
    (( candidate_major > floor_major ))
    return
  fi
  if (( candidate_minor != floor_minor )); then
    (( candidate_minor > floor_minor ))
    return
  fi
  (( candidate_patch > floor_patch ))
}

project_versions="$(extract_project_versions < "$project_file")"
project_version_count="$(printf '%s\n' "$project_versions" | sed '/^$/d' | wc -l | tr -d ' ')"

if [[ "$project_version_count" -ne 1 ]]; then
  echo "error: every app and widget configuration must use one MARKETING_VERSION; found: ${project_versions:-none}." >&2
  exit 1
fi

current_version="$project_versions"
validate_version_format "$current_version" "MARKETING_VERSION"

live_version="${TCGER_APP_STORE_LIVE_VERSION:-$(sed -nE '/^[[:space:]]*(#|$)/d; s/^[[:space:]]*([^[:space:]]+).*$/\1/p' "$live_version_file" | head -1)}"
validate_version_format "$live_version" "APP_STORE_LIVE_VERSION"

release_floor="$live_version"
while IFS= read -r release_tag; do
  if [[ "$release_tag" =~ ^ios-v([0-9]+\.[0-9]+\.[0-9]+)-b[0-9]+$ ]]; then
    tag_version="${BASH_REMATCH[1]}"
    if version_is_greater "$tag_version" "$release_floor"; then
      release_floor="$tag_version"
    fi
  fi
done < <(git -C "$repo_root" tag --list 'ios-v*-b*')

if ! version_is_greater "$current_version" "$release_floor"; then
  echo "error: MARKETING_VERSION $current_version is not newer than the released/submitted version $release_floor." >&2
  echo "error: bump MARKETING_VERSION for both the TCGer app and widget before archiving." >&2
  exit 1
fi

if git -C "$repo_root" rev-parse --verify HEAD^ >/dev/null 2>&1 && \
   git -C "$repo_root" cat-file -e "HEAD^:$project_relative_path" 2>/dev/null; then
  previous_versions="$(git -C "$repo_root" show "HEAD^:$project_relative_path" | extract_project_versions)"
  previous_version_count="$(printf '%s\n' "$previous_versions" | sed '/^$/d' | wc -l | tr -d ' ')"

  if [[ "$previous_version_count" -eq 1 ]]; then
    previous_version="$previous_versions"
    validate_version_format "$previous_version" "the previous commit's MARKETING_VERSION"
    if version_is_greater "$previous_version" "$current_version"; then
      echo "error: MARKETING_VERSION decreased from $previous_version to $current_version." >&2
      echo "error: restore the newer version before Xcode Cloud archives the app." >&2
      exit 1
    fi
  fi
fi

echo "App Store version guard passed: $current_version is newer than $release_floor."
