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
echo "Checking for pre-built binaries..."
REPO="shirushimori/YourTube"
LATEST_RELEASE_URL="https://api.github.com/repos/$REPO/releases/latest"

DOWNLOAD_URL=$(curl -sL "$LATEST_RELEASE_URL" 2>/dev/null | grep -o '"browser_download_url": "[^"]*"' | grep -i "$OS_NAME" | head -n 1 | cut -d '"' -f 4 || true)

if [ -z "$DOWNLOAD_URL" ]; then
    if [ "$OS_NAME" = "linux" ]; then
        DOWNLOAD_URL=$(curl -sL "$LATEST_RELEASE_URL" 2>/dev/null | grep -o '"browser_download_url": "[^"]*"' | grep "yourtube-client" | head -n 1 | cut -d '"' -f 4 || true)
    fi
fi

if [ -n "$DOWNLOAD_URL" ]; then
    echo "Found pre-built binary: $DOWNLOAD_URL"
    TMP_BIN="/tmp/yourtube-client"
    curl -sSL "$DOWNLOAD_URL" -o "$TMP_BIN"
    chmod +x "$TMP_BIN"

    echo "Installing client and registering browser manifests..."
    "$TMP_BIN" --install

    echo "Cleaning up..."
    rm -f "$TMP_BIN"
else
    echo "Notice: Could not find a pre-built binary for your OS/Arch in GitHub Releases."
    echo "Falling back to building from source..."
    
    if ! command -v git >/dev/null 2>&1; then
      echo "Error: 'git' is not installed. Please install git first."
      exit 1
    fi

    if ! command -v cargo >/dev/null 2>&1; then
      echo "Rust is not installed. Installing Rust (cargo)..."
      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
      source "$HOME/.cargo/env"
    fi

    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"

    echo "Downloading source code..."
    git clone --depth 1 https://github.com/shirushimori/YourTube.git
    cd YourTube/rust-client

    echo "Building client (this might take a minute)..."
    cargo build --release

    echo "Installing client and registering browser manifests..."
    ./target/release/yourtube-client --install

    echo "Cleaning up..."
    cd "$HOME"
    rm -rf "$TEMP_DIR"
fi

echo ""
echo "=== Done! ==="
echo "The native client is successfully installed."
echo "You can now use the YourTube extension."
