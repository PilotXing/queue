#!/bin/bash

# Use system esbuild binary (Termux-compatible)
export ESBUILD_BINARY_PATH=$(which esbuild)

# Obsidian plugin directory (from claude.md)
PLUGIN_DIR="~/storage/documents/Obsidian/.obsidian/plugins/queue"

# Expand tilde to home directory
PLUGIN_DIR="${PLUGIN_DIR/#\~/$HOME}"

echo "Building plugin..."
if npm run build; then
    echo "Build successful."
else
    echo "Build failed, but continuing with existing main.js file."
fi

echo "Creating target directory: $PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR"

echo "Copying essential plugin files..."
cp -v main.js manifest.json styles.css "$PLUGIN_DIR/"

echo "Deployment complete."