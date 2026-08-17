#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.yourtube.client"
INSTALL_DIR="$HOME/.local/bin"
BINARY_NAME="yourtube-client"

echo "=== YourTube Installer ==="

# 1. Build Rust client
echo "[1/3] Building Rust client..."
cd "$(dirname "$0")/rust-client"
cargo build --release
mkdir -p "$INSTALL_DIR"
cp "target/release/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
chmod +x "$INSTALL_DIR/$BINARY_NAME"
echo "  Binary installed to $INSTALL_DIR/$BINARY_NAME"

# 2. Chrome native messaging host manifest
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
echo "  Chrome manifest: $CHROME_DIR/$HOST_NAME.json"

# 3. Chromium-based browsers (Brave, Vivaldi, etc.)
for BROWSER_DIR in "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" \
                    "$HOME/.config/vivaldi/NativeMessagingHosts" \
                    "$HOME/.config/chromium/NativeMessagingHosts"; do
  if [ -d "$(dirname "$BROWSER_DIR")" ]; then
    mkdir -p "$BROWSER_DIR"
    cp "$CHROME_DIR/$HOST_NAME.json" "$BROWSER_DIR/$HOST_NAME.json"
    echo "  Also installed to $BROWSER_DIR"
  fi
done

# 4. Firefox native messaging host manifest
FIREFOX_DIR="$HOME/.mozilla/native-messaging-hosts"
mkdir -p "$FIREFOX_DIR"
cat > "$FIREFOX_DIR/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "YourTube yt-dlp client",
  "path": "$INSTALL_DIR/$BINARY_NAME",
  "type": "stdio"
}
EOF
echo "  Firefox manifest: $FIREFOX_DIR/$HOST_NAME.json"

echo ""
echo "=== Done ==="
echo ""
echo "Next steps:"
echo "  1. Open Chrome/Firefox"
echo "  2. Go to chrome://extensions or about:debugging"
echo "  3. Enable Developer Mode"
echo "  4. Click 'Load unpacked' and select the extension/ folder"
echo "  5. The extension ID will appear - update allowed_origins in the manifest:"
echo "     $CHROME_DIR/$HOST_NAME.json"
echo "  6. Re-run this script after updating the extension ID"
