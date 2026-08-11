#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "package:mac must run on macOS" >&2
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$PROJECT_DIR/release"
APP_DIR="$RELEASE_DIR/Codex Lark.app"
MACOS_DIR="$APP_DIR/Contents/MacOS"
RESOURCES_DIR="$APP_DIR/Contents/Resources"
EXECUTABLE="$MACOS_DIR/codex-lark"
SEA_BLOB="$RELEASE_DIR/codex-lark.blob"
NODE_EXECUTABLE="$(node -p 'process.execPath')"

cd "$PROJECT_DIR"
mkdir -p "$RELEASE_DIR"
pnpm build
node --experimental-sea-config scripts/sea-config.json

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"
cp "$NODE_EXECUTABLE" "$EXECUTABLE"
cp scripts/macos/Info.plist "$APP_DIR/Contents/Info.plist"
cp LICENSE NOTICE README.zh-CN.md "$RESOURCES_DIR/"

codesign --remove-signature "$EXECUTABLE" 2>/dev/null || true
"$PROJECT_DIR/node_modules/.bin/postject" \
  "$EXECUTABLE" NODE_SEA_BLOB "$SEA_BLOB" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA
codesign --force --sign - --timestamp=none "$APP_DIR"

ARCHIVE="$RELEASE_DIR/codex-lark-macos-$(uname -m).zip"
rm -f "$ARCHIVE"
ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$ARCHIVE"
rm -f "$SEA_BLOB"

echo "Created: $APP_DIR"
echo "Created: $ARCHIVE"
