# Version Bump Script

Bumps the ZenForge version across all project files in one command.

## Usage

```bash
./scripts/bump-version.sh <major|minor|patch|x.y.z>
```

## Examples

```bash
# Bump patch: 1.2.0 -> 1.2.1
./scripts/bump-version.sh patch

# Bump minor: 1.2.0 -> 1.3.0
./scripts/bump-version.sh minor

# Bump major: 1.2.0 -> 2.0.0
./scripts/bump-version.sh major

# Set explicit version
./scripts/bump-version.sh 2.5.0

# Check current version (no args)
./scripts/bump-version.sh
```

## Files Updated

| File | Field |
|------|-------|
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` |
| `package-lock.json` | top-level `"version"` (×2) |

`src-tauri/Cargo.lock` is not updated directly — run `cargo build` in `src-tauri/` to regenerate it.
