#!/bin/bash
# Deploy texboard to Raspberry Pi
# Usage: bash deploy.sh
#
# Override defaults with environment variables:
#   PI_HOST=pi@mypi.local bash deploy.sh

PI="${PI_HOST:-texjer@texboard.local}"
REMOTE_DIR="${PI_DIR:-~/texboard}"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Syncing files to Pi ($PI)..."
rsync -av \
  --exclude node_modules \
  --exclude .weather-usage.json \
  --exclude 'texboard.db*' \
  --exclude .google-tokens.json \
  --exclude .DS_Store \
  --exclude .claude \
  --exclude photos \
  "$LOCAL_DIR/" "$PI:$REMOTE_DIR/"

echo "Syncing photos (deleting removed photos on Pi)..."
rsync -av --delete \
  "$LOCAL_DIR/photos/" "$PI:$REMOTE_DIR/photos/"

echo "Restarting server..."
ssh "$PI" "sudo systemctl restart texboard"

echo "Done! Dashboard will auto-reload in ~5 seconds."
