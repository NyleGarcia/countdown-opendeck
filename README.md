# Countdown — OpenDeck plugin

Countdown timer key for [OpenDeck](https://github.com/nekename/OpenDeck) (Stream Deck SDK v2).
Node, zero dependencies (needs Node >= 22 for the built-in WebSocket client).

## Features
- Configurable duration (h/m/s) + presets (1m, 5m, 10m, 15m, 25m, 1h)
- Big seven-segment digits drawn into the key image (no reliance on OpenDeck title size)
- Progress ring: green → amber (<25%) → red (<10%); grey + pause bars when paused
- Touch strip (Stream Deck+): large digits + progress bar via a one-pixmap custom layout
- Optional label above the time
- On finish: flashing key, alert, sound (`pw-play`/`paplay`), optional repeat until dismissed
- Optional overtime: keeps counting up (`+0:12`)
- Keeps running when you switch pages
- Stream Deck+ dials: rotate = adjust (configurable step), press = start/pause, touch = reset

## Controls
| Input | Action |
|---|---|
| Tap | start / pause |
| Hold (≥600 ms) | reset |
| Tap while ringing | dismiss + reset |

Duration edits while a timer is running apply on the next reset.

## Install
```sh
scripts/install.sh   # symlinks into ~/.config/opendeck/plugins, then restart OpenDeck
```

`run.sh` finds Node at `~/.local/node/bin/node`, `~/.volta/bin/node`, `/usr/local/bin/node`,
`/usr/bin/node`, then `$PATH`. Override with `COUNTDOWN_NODE=/path/to/node`.
Debug logging: `COUNTDOWN_DEBUG=1`.

## Test
```sh
node scripts/smoke-test.js
```
Fake OpenDeck WebSocket server; launches the plugin via `run.sh` and drives
start/pause/finish/reset/settings/dial/overtime through the real protocol.

## Releases
Semver, driven by git tags. `manifest.json` `Version` is the source of truth.

```sh
scripts/release.sh patch|minor|major|X.Y.Z[-rc.N] [--push]
```
Bumps `Version`, commits `Release vX.Y.Z`, tags `vX.Y.Z` (refuses dirty tree, existing
tag, or going backwards; bumping a prerelease finalises it). Pushing the tag runs the
**Release** workflow: checks tag == manifest version, runs the smoke test, uploads
`countdown-opendeck-X.Y.Z.zip` (+ sha256) to a GitHub Release. `-suffix` tags become
prereleases. Install the zip in OpenDeck via *Plugins → Install from file*.

**CI** runs on every push/PR: syntax check, manifest/asset validation, shellcheck, smoke test.

## Layout
```
dev.countdown.sdPlugin/
  manifest.json   action + encoder definition
  run.sh          env scrub + node lookup
  plugin.js       timer logic, SVG key rendering
  pi/timer.html   property inspector
  layouts/        touch-strip layout (single full-canvas pixmap)
  icons/          SVG icons
scripts/          install + smoke test
```
