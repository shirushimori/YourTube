#!/usr/bin/env bash
set -e

if [ "${1:-}" = "--uninstall" ]; then
    echo "=== Uninstalling YourTube Native Client ==="
    echo "Removing binaries..."
    rm -f ~/.local/bin/yourtube-client ~/.local/bin/yt-dlp
    [ -f /usr/local/bin/yourtube-client ] && sudo rm -f /usr/local/bin/yourtube-client 2>/dev/null || true
    [ -f /usr/local/bin/yt-dlp ] && sudo rm -f /usr/local/bin/yt-dlp 2>/dev/null || true

    echo "Removing browser manifests..."
    rm -f ~/.config/google-chrome/NativeMessagingHosts/com.yourtube.client.json
    rm -f ~/.config/chromium/NativeMessagingHosts/com.yourtube.client.json
    rm -f ~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.yourtube.client.json
    rm -f ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.yourtube.client.json 2>/dev/null || true
    
    rm -f ~/.mozilla/native-messaging-hosts/com.yourtube.client.json
    rm -f ~/.config/mozilla/firefox/native-messaging-hosts/com.yourtube.client.json
    rm -f ~/Library/Application\ Support/Mozilla/NativeMessagingHosts/com.yourtube.client.json 2>/dev/null || true

    echo "Uninstall complete!"
    exit 0
fi

echo "=== YourTube Native Client Installer ==="

# 1. Detect OS and Architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)
    OS_NAME="linux"
    ;;
  Darwin)
    OS_NAME="macos"
    ;;
  *)
    echo "Error: Unsupported OS $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64)
    ARCH_NAME="amd64"
    ;;
  aarch64|arm64)
    ARCH_NAME="arm64"
    ;;
  *)
    echo "Error: Unsupported architecture $ARCH"
    exit 1
    ;;
esac

# 2. Fetch latest release info
echo "Fetching latest release information..."
REPO="shirushimori/YourTube"
LATEST_RELEASE_URL="https://api.github.com/repos/$REPO/releases/latest"

# Try to find an asset that matches the OS and ARCH
DOWNLOAD_URL=$(curl -sL "$LATEST_RELEASE_URL" | grep -o '"browser_download_url": "[^"]*"' | grep -i "$OS_NAME" | head -n 1 | cut -d '"' -f 4)

if [ -z "$DOWNLOAD_URL" ]; then
    # Fallback to the first asset if specific ones aren't found (assuming single linux binary uploaded)
    if [ "$OS_NAME" = "linux" ]; then
        DOWNLOAD_URL=$(curl -sL "$LATEST_RELEASE_URL" | grep -o '"browser_download_url": "[^"]*"' | grep "yourtube-client" | head -n 1 | cut -d '"' -f 4)
    fi

    if [ -z "$DOWNLOAD_URL" ]; then
        echo "Error: Could not find a pre-built binary in the latest release."
        echo "Please build from source."
        exit 1
    fi
fi

# 3. Download and install
TMP_BIN="/tmp/yourtube-client"
echo "Downloading YourTube client from: $DOWNLOAD_URL"
curl -sSL "$DOWNLOAD_URL" -o "$TMP_BIN"
chmod +x "$TMP_BIN"

echo "Installing client and registering browser manifests..."
"$TMP_BIN" --install

# 4. Cleanup
echo "Cleaning up..."
rm -f "$TMP_BIN"

echo ""
echo "=== Done! ==="
echo "The native client is successfully installed."
echo "You can now install the YourTube extension from the Firefox Add-on Store."
