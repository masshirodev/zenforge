#!/usr/bin/env bash
set -euo pipefail

# ZenForge version bump script
# Usage: ./scripts/bump-version.sh <major|minor|patch|x.y.z>

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Get current version from package.json
CURRENT=$(grep -oP '"version":\s*"\K[^"]+' "$ROOT/package.json" | head -1)

if [ -z "${1:-}" ]; then
  echo "Current version: $CURRENT"
  echo "Usage: $0 <major|minor|patch|x.y.z>"
  exit 1
fi

bump_type="$1"

IFS='.' read -r major minor patch <<< "$CURRENT"

case "$bump_type" in
  major) NEW="$((major + 1)).0.0" ;;
  minor) NEW="$major.$((minor + 1)).0" ;;
  patch) NEW="$major.$minor.$((patch + 1))" ;;
  *)
    if [[ "$bump_type" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      NEW="$bump_type"
    else
      echo "Error: invalid argument '$bump_type'. Use major, minor, patch, or x.y.z"
      exit 1
    fi
    ;;
esac

echo "Bumping version: $CURRENT -> $NEW"

# 1. package.json
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW\"/" "$ROOT/package.json"
echo "  Updated package.json"

# 2. src-tauri/tauri.conf.json
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW\"/" "$ROOT/src-tauri/tauri.conf.json"
echo "  Updated src-tauri/tauri.conf.json"

# 3. src-tauri/Cargo.toml (only the project version, not dependency versions)
sed -i "0,/^version = \"$CURRENT\"/s//version = \"$NEW\"/" "$ROOT/src-tauri/Cargo.toml"
echo "  Updated src-tauri/Cargo.toml"

# 4. package-lock.json (top-level version fields)
sed -i "0,/\"version\": \"$CURRENT\"/{s/\"version\": \"$CURRENT\"/\"version\": \"$NEW\"/}" "$ROOT/package-lock.json"
sed -i "0,/\"version\": \"$CURRENT\"/{s/\"version\": \"$CURRENT\"/\"version\": \"$NEW\"/}" "$ROOT/package-lock.json"
echo "  Updated package-lock.json"

echo ""
echo "Done! Version bumped to $NEW"
echo "Note: Run 'cargo build' in src-tauri/ to update Cargo.lock"
