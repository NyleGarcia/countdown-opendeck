#!/bin/sh
# OpenDeck may launch plugins from inside an AppImage/Flatpak env whose library and
# path overrides break host binaries. Scrub them, find a Node >= 22 (native WebSocket),
# and hand over. stdin -> /dev/null so nothing ever blocks on it.
exec 0</dev/null
DIR="$(cd "$(dirname "$0")" && pwd)"

NODE="${COUNTDOWN_NODE:-}"
if [ -z "$NODE" ]; then
  for c in "$HOME/.local/node/bin/node" "$HOME/.volta/bin/node" /usr/local/bin/node /usr/bin/node; do
    [ -x "$c" ] && NODE="$c" && break
  done
fi
[ -z "$NODE" ] && NODE="$(command -v node 2>/dev/null)"
if [ -z "$NODE" ]; then
  echo "countdown: node not found (set COUNTDOWN_NODE)" >&2
  exit 1
fi

exec env \
  -u LD_LIBRARY_PATH -u LD_PRELOAD \
  -u GIO_EXTRA_MODULES -u GSETTINGS_SCHEMA_DIR -u GDK_PIXBUF_MODULE_FILE \
  -u APPDIR -u APPIMAGE -u ARGV0 -u NODE_OPTIONS \
  PATH=/usr/bin:/bin:/usr/local/bin \
  XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" \
  DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/bus}" \
  COUNTDOWN_DEBUG="${COUNTDOWN_DEBUG:-}" \
  COUNTDOWN_NOTIFY_CMD="${COUNTDOWN_NOTIFY_CMD:-}" \
  "$NODE" "$DIR/plugin.js" "$@"
