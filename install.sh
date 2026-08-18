#!/usr/bin/env bash
set -e

echo "=== YourTube Native Client Installer ==="

# 1. Check prerequisites
if ! command -v git >/dev/null 2>&1; then
  echo "Error: 'git' is not installed. Please install it first."
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust is not installed. Installing Rust (cargo)..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
fi

# 2. Clone into temp directory
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

echo "Downloading YourTube..."
git clone --depth 1 https://github.com/shirushimori/YourTube.git
cd YourTube/rust-client

# 3. Build & Install
echo "Building client..."
cargo build --release

echo "Installing client and registering browser manifests..."
./target/release/yourtube-client --install

# 4. Cleanup
echo "Cleaning up..."
cd "$HOME"
rm -rf "$TEMP_DIR"

echo ""
echo "=== Done! ==="
echo "The native client is successfully installed."
echo "You can now install the YourTube extension from the Firefox Add-on Store or Chrome Web Store."
