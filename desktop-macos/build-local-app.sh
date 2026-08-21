#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
APP_DIR=${1:-"$REPOSITORY_DIR/dist/Arkme DSH.app"}
CONTENTS_DIR="$APP_DIR/Contents"
MODULE_CACHE=/private/tmp/arkme-dsh-swift-module-cache

mkdir -p "$CONTENTS_DIR/MacOS" "$CONTENTS_DIR/Resources" "$MODULE_CACHE"
cp "$SCRIPT_DIR/Info.plist" "$CONTENTS_DIR/Info.plist"
cp "$REPOSITORY_DIR/assets/branding/arkme-mark.png" "$CONTENTS_DIR/Resources/ArkmeIcon.png"

CLANG_MODULE_CACHE_PATH="$MODULE_CACHE" \
SWIFT_MODULECACHE_PATH="$MODULE_CACHE" \
xcrun swiftc \
  -O \
  -target arm64-apple-macos13.0 \
  "$SCRIPT_DIR/ArkmeDSHApp.swift" \
  -framework Cocoa \
  -framework WebKit \
  -o "$CONTENTS_DIR/MacOS/Arkme DSH"

codesign --force --deep --sign - "$APP_DIR"
codesign --verify --deep --strict "$APP_DIR"

echo "$APP_DIR"
