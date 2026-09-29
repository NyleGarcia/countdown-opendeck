#!/bin/sh
# Symlink the plugin into OpenDeck's plugin dir (dev install). Restart OpenDeck after.
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)/dev.countdown.sdPlugin"
DEST="${XDG_CONFIG_HOME:-$HOME/.config}/opendeck/plugins/dev.countdown.sdPlugin"
mkdir -p "$(dirname "$DEST")"
if [ -e "$DEST" ] && [ ! -L "$DEST" ]; then
  echo "refusing: $DEST exists and is not a symlink" >&2; exit 1
fi
ln -sfn "$SRC" "$DEST"
echo "linked $DEST -> $SRC"
echo "restart OpenDeck to load it"
