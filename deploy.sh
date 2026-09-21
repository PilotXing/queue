#!/bin/bash
set -euo pipefail

# Resolve repository directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Obsidian plugin directory default (MacMini vault), overridable via PLUGIN_DIR env var
DEFAULT_PLUGIN_DIR="/Users/xingzihui/Documents/obsidian/MacMini/.obsidian/plugins/queue"
TARGET_DIR="${PLUGIN_DIR:-$DEFAULT_PLUGIN_DIR}"

echo "Building plugin in $SCRIPT_DIR..."
npm run build

echo "Verifying runtime files exist..."
for file in main.js manifest.json styles.css; do
    if [ ! -f "$file" ]; then
        echo "Error: Required runtime file '$file' is missing." >&2
        exit 1
    fi
done

echo "Creating target directory: $TARGET_DIR"
mkdir -p "$TARGET_DIR"

echo "Copying essential plugin files to $TARGET_DIR..."
cp -v main.js manifest.json styles.css "$TARGET_DIR/"

echo "Deployment complete."