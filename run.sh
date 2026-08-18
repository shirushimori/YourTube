#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.yourtube.client"
INSTALL_DIR="$HOME/.local/bin"
BINARY_NAME="yourtube-client"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== YourTube ==="
echo ""

# 0. Check prerequisites
echo "[0/4] Checking prerequisites..."
for cmd in cargo curl zip; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: '$cmd' is not installed. Please install it first."
    exit 1
  fi
done
echo "  -> All prerequisites found."
echo ""

# 1. Build Rust client
echo "[1/4] Building..."
cd "$SCRIPT_DIR/rust-client"

if [ ! -f "yt-dlp" ]; then
  echo "  Downloading yt-dlp..."
  curl -L -o yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp
  chmod +x yt-dlp
fi

cargo build --release 2>&1 | tail -1
mkdir -p "$INSTALL_DIR"

# Kill Firefox if binary is locked
if fuser "$INSTALL_DIR/$BINARY_NAME" >/dev/null 2>&1; then
  echo "  Closing Firefox to update binary..."
  pkill -f firefox 2>/dev/null || true
  sleep 1
fi

cp "target/release/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
chmod +x "$INSTALL_DIR/$BINARY_NAME"
cp "yt-dlp" "$INSTALL_DIR/yt-dlp"
chmod +x "$INSTALL_DIR/yt-dlp"
echo "  -> $INSTALL_DIR/$BINARY_NAME"
echo "  -> $INSTALL_DIR/yt-dlp"

# 2. Chrome / Chromium
echo ""
echo "[2/4] Chrome manifest..."
CHROME_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
mkdir -p "$CHROME_DIR"
cat > "$CHROME_DIR/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "YourTube yt-dlp client",
  "path": "$INSTALL_DIR/$BINARY_NAME",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID/"
  ]
}
EOF
echo "  -> $CHROME_DIR/$HOST_NAME.json"

for DIR in "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" \
           "$HOME/.config/vivaldi/NativeMessagingHosts" \
           "$HOME/.config/chromium/NativeMessagingHosts"; do
  if [ -d "$(dirname "$DIR")" ]; then
    mkdir -p "$DIR"
    cp "$CHROME_DIR/$HOST_NAME.json" "$DIR/$HOST_NAME.json"
    echo "  -> $DIR/$HOST_NAME.json"
  fi
done

# 3. Firefox
echo ""
echo "[3/4] Firefox manifests..."
FIREFOX_DIR="$HOME/.mozilla/native-messaging-hosts"
mkdir -p "$FIREFOX_DIR"
cat > "$FIREFOX_DIR/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "YourTube yt-dlp client",
  "path": "$INSTALL_DIR/$BINARY_NAME",
  "type": "stdio",
  "allowed_extensions": ["yourtube@shirushimori"]
}
EOF
echo "  -> $FIREFOX_DIR/$HOST_NAME.json"

# System-wide Firefox locations
echo '````' | sudo -S cp "$FIREFOX_DIR/$HOST_NAME.json" /usr/lib/mozilla/native-messaging-hosts/$HOST_NAME.json 2>/dev/null || true
echo '````' | sudo -S cp "$FIREFOX_DIR/$HOST_NAME.json" /usr/lib64/mozilla/native-messaging-hosts/$HOST_NAME.json 2>/dev/null || true

PROFILE_DIR=$(find ~/.config/mozilla/firefox -name "prefs.js" -exec dirname {} \; 2>/dev/null | head -1 || true)
if [ -n "$PROFILE_DIR" ]; then
  mkdir -p "$PROFILE_DIR/native-messaging-hosts"
  cp "$FIREFOX_DIR/$HOST_NAME.json" "$PROFILE_DIR/native-messaging-hosts/$HOST_NAME.json"
  echo "  -> $PROFILE_DIR/native-messaging-hosts/$HOST_NAME.json"
fi

# 4. Test
echo ""
echo "[4/4] Testing..."
TEST_MSG='{"type":"fetch_metadata","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
TEST_LEN=${#TEST_MSG}
TEST_RESP=$(printf "\\x$(printf '%02x' $((TEST_LEN & 0xFF)))\\x$(printf '%02x' $(((TEST_LEN >> 8) & 0xFF)))\\x$(printf '%02x' $(((TEST_LEN >> 16) & 0xFF)))\\x$(printf '%02x' $(((TEST_LEN >> 24) & 0xFF)))" | cat - <(echo "$TEST_MSG") | timeout 15 "$INSTALL_DIR/$BINARY_NAME" 2>/dev/null || echo '{"type":"error","message":"test failed"}')

if echo "$TEST_RESP" | grep -q '"type":"metadata"'; then
  TEST_TITLE=$(echo "$TEST_RESP" | grep -o '"title":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "  -> OK: $TEST_TITLE"
else
  echo "  -> WARN: $TEST_RESP"
fi

echo ""
echo "=== Done ==="
echo ""
echo "Packaging extension for publishing..."
cd "$SCRIPT_DIR/extension"
zip -r ../yourtube-extension.zip * >/dev/null
echo "  -> Extension packaged as $SCRIPT_DIR/yourtube-extension.zip"
echo ""
echo "Usage:"
echo "  ./run.sh          Build + install everything"
echo "  ./run.sh --tui    Launch the TUI dashboard"
echo "  ./run.sh --ext    Open Firefox with extension loaded"
echo ""

# Handle flags
if [ "${1:-}" = "--tui" ]; then
  exec "$INSTALL_DIR/$BINARY_NAME" --tui
elif [ "${1:-}" = "--ext" ]; then
  firefox --new-tab "about:debugging#/runtime/this-firefox" &
fi
