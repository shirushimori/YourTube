#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== YourTube Setup ==="
echo ""

# 0. Check prerequisites
echo "[0/3] Checking prerequisites..."
for cmd in cargo zip; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: '$cmd' is not installed. Please install it first."
    exit 1
  fi
done
echo "  -> All prerequisites found."
echo ""

# 1. Build & Install Rust client
echo "[1/3] Building & Installing..."
cd "$SCRIPT_DIR/rust-client"
cargo build --release 2>&1 | tail -1

echo ""
echo "Running client installer..."
# The client will automatically download yt-dlp and register browser manifests
./target/release/yourtube-client --install

# 2. Package Extension
echo ""
echo "[2/3] Packaging extension..."
cd "$SCRIPT_DIR/extension"
zip -r ../yourtube-extension.zip * >/dev/null
echo "  -> Extension packaged as $SCRIPT_DIR/yourtube-extension.zip"

echo ""
echo "=== Done ==="
echo ""
echo "Usage:"
echo "  ./run.sh          Build + install everything"
echo "  ./run.sh --tui    Launch the TUI dashboard"
echo "  ./run.sh --ext    Open Firefox with extension loaded"
echo ""

# Handle flags
if [ "${1:-}" = "--tui" ]; then
  exec ~/.local/bin/yourtube-client --tui
elif [ "${1:-}" = "--ext" ]; then
  firefox --new-tab "about:debugging#/runtime/this-firefox" &
fi
