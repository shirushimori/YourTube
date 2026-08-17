#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.yourtube.client"
INSTALL_DIR="$HOME/.local/bin"
BINARY_NAME="yourtube-client"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== YourTube Installer ==="
echo ""

# 1. Build Rust client
echo "[1/4] Building Rust client..."
cd "$SCRIPT_DIR/rust-client"
cargo build --release 2>&1 | tail -1
mkdir -p "$INSTALL_DIR"
cp "target/release/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
chmod +x "$INSTALL_DIR/$BINARY_NAME"
cp "yt-dlp" "$INSTALL_DIR/yt-dlp"
chmod +x "$INSTALL_DIR/yt-dlp"
echo "  -> $INSTALL_DIR/$BINARY_NAME"
echo "  -> $INSTALL_DIR/yt-dlp"

# 2. Chrome / Chromium
echo ""
echo "[2/4] Registering native messaging host for Chrome..."
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
echo "[3/4] Registering native messaging host for Firefox..."
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

# 4. Test the client
echo ""
echo "[4/4] Testing native messaging client..."
TEST_MSG='{"type":"fetch_metadata","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
TEST_LEN=${#TEST_MSG}
TEST_RESP=$(printf "\\x$(printf '%02x' $((TEST_LEN & 0xFF)))\\x$(printf '%02x' $(((TEST_LEN >> 8) & 0xFF)))\\x$(printf '%02x' $(((TEST_LEN >> 16) & 0xFF)))\\x$(printf '%02x' $(((TEST_LEN >> 24) & 0xFF)))" | cat - <(echo "$TEST_MSG") | timeout 15 "$INSTALL_DIR/$BINARY_NAME" 2>/dev/null || echo '{"type":"error","message":"test failed"}')

if echo "$TEST_RESP" | grep -q '"type":"metadata"'; then
  TEST_TITLE=$(echo "$TEST_RESP" | grep -o '"title":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "  -> OK: $TEST_TITLE"
else
  echo "  -> WARN: client responded with: $TEST_RESP"
fi

echo ""
echo "=== Installed ==="
echo ""
echo "To use:"
echo "  1. Load extension/ in your browser"
echo "     Chrome:  chrome://extensions -> Load unpacked -> select extension/"
echo "     Firefox: about:debugging -> Load Temporary Add-on -> select extension/manifest.json"
echo ""
echo "  2. Open a YouTube video and click the YourTube button"
