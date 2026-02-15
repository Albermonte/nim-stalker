#!/bin/sh
set -e

GENESIS_FILE="nimiq-genesis-main-albatross.toml"
GENESIS_URL="https://ipfs.nimiq.io/ipfs/QmWcRRRw4FaKRrznMFt6KemAM35uo9QknMkDaeBzTod33R"

# Resolve project root (script lives in scripts/)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/$GENESIS_FILE"

if [ -f "$TARGET" ]; then
  echo "Genesis file already exists at $TARGET"
  exit 0
fi

echo "Downloading Nimiq mainnet genesis file..."
curl -fL -o "$TARGET" "$GENESIS_URL"
echo "Downloaded to $TARGET"
