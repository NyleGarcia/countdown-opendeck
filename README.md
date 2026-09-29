# Countdown for OpenDeck

[![CI](https://github.com/NyleGarcia/countdown-opendeck/actions/workflows/ci.yml/badge.svg)](https://github.com/NyleGarcia/countdown-opendeck/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/NyleGarcia/countdown-opendeck?sort=semver)](https://github.com/NyleGarcia/countdown-opendeck/releases/latest)
[![License: MIT](https://img.shields.io/github/license/NyleGarcia/countdown-opendeck)](LICENSE)

Timers for Stream Deck keys and Stream Deck+ dials, built for
[OpenDeck](https://github.com/nekename/OpenDeck) on Linux. The plugin has four actions:

- **Countdown Timer:** counts down a duration you set per key.
- **Countdown to Date:** counts down to a date and time, or to a time every day.
- **Stopwatch:** counts up, with an optional lap mode. It keeps running across page changes and
  OpenDeck restarts.
- **Pomodoro:** focus and break cycles, with a long break every few rounds.

Each key shows big digits inside a progress ring. When an alarm goes off, the key flashes, a sound
plays, and a desktop notification appears with **Dismiss** and **Snooze** buttons.

![Row 1: the timer idle, running with a label, nearly done, paused and ringing. Row 2: a date twelve days away, a daily 17:00 target showing its day, a date seven minutes away, the stopwatch running, and a snoozed alarm. Row 3: pomodoro focus, break and paused long break, then a finished lap and a live lap. Row 4: the touch strip for the timer, a date countdown and the pomodoro.](.github/preview.png)

## Features

- **Configurable duration:** hours, minutes and seconds, plus one-click presets (1m, 5m, 10m, 15m, 25m, 1h).
- **Count down to a moment:** a fixed date and time, or a time of day that repeats every day. More
  than a day away shows days, with hours and minutes underneath (`12d` over `03:59`).
- **Stopwatch:** the ring sweeps once a minute, like a second hand.
- **Lap mode:** tap for a lap. The key shows the live lap with the total underneath, and each
  finished lap briefly shows its time to a tenth of a second. The dial scrolls back through laps,
  and the settings panel lists them all, fastest in green and slowest in amber.
- **Pomodoro:** focus, break, focus, … with a long break after a set number of rounds. The ring is
  red for focus, green for a break and blue for a long break. Phases can start automatically.
- **Snooze:** hold a ringing key to snooze it (1, 5, 10 or 15 minutes). It shows a purple
  "Snoozed" countdown, then rings again.
- **Desktop notifications:** each alarm also sends a notification whose **Dismiss** and **Snooze**
  buttons act on the key. Dismissing from the key closes the notification.
- **Readable at a glance:** seven-segment digits are drawn into the key image, so they don't depend
  on OpenDeck's title font size.
- **Progress ring:** on the timer it goes green, then amber under 25%, then red under 10%. On a date
  countdown it shows progress since you set the target, going amber under an hour and red under
  10 minutes. It turns grey with pause bars when paused.
- **Stream Deck+ touch strip:** large digits over a progress bar.
- **Finish alarm:** the key flashes red and plays a sound. The sound can repeat until you dismiss it.
- **Overtime (optional):** keeps counting up after zero, for example `+0:12`.
- **Optional label:** a short name drawn above the time, like "Tea" or "Pomodoro".
- **Runs in the background:** timers keep going when you switch pages or profiles.
- **No dependencies:** plain Node.js, no `npm install`.

## Controls

| | Countdown Timer | Countdown to Date | Stopwatch | Pomodoro |
|---|---|---|---|---|
| Tap | Start / pause | Show the target date for a moment | Start / pause | Start / pause |
| Hold (≥ 0.6 s) | Reset | Same as tap | Reset | Restart the cycle |
| Dial: rotate | Change the duration (while stopped) | n/a | n/a | n/a |
| Dial: press | Start / pause | Show the target | Start / pause | Start / pause |
| Touch the strip | Reset | Show the target | Reset | Skip to the next phase |

**While an alarm is ringing**, every action behaves the same:

| Input | Does |
|---|---|
| Tap, or press the dial | Dismiss. A timer resets, and a pomodoro starts its next phase. |
| Hold, or touch the strip | Snooze. If snooze is off, this dismisses instead. |
| Notification buttons | Dismiss or Snooze, same as on the key |

While snoozed, tapping cancels the snooze and dismisses.

**Stopwatch in lap mode:**

| Input | Does |
|---|---|
| Tap, or press the dial | Start, then record a lap each time |
| Hold, or touch the strip | Pause while running; reset when stopped |
| Dial: rotate | Scroll back through laps |

If you change a timer's duration while it's running, the new value takes effect on the next reset.

## Settings

Select the key in OpenDeck to open its settings panel.

### Countdown Timer

| Setting | Default | Notes |
|---|---|---|
| Duration | 5:00 | Up to 99:59:59 |
| Label | *(none)* | Up to 12 characters, shown above the time |
| Flash key when done | On | |
| Play sound when done | On | Uses `pw-play`, falling back to `paplay` |
| Repeat sound until dismissed | Off | |
| Keep counting up after zero | Off | Shows `+M:SS` |
| Desktop notification | On | Uses `notify-send`. Use **Test notification** to check it. |
| Snooze | 5 minutes | 1, 5, 10 or 15 minutes, or Off (holding a ringing key then dismisses it) |
| Sound file | `/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga` | Any file your player can read. Use **Test sound** to check it. |
| Dial step | 1 minute | 1 s, 5 s, 15 s, 30 s, 1 min or 5 min per click |

### Countdown to Date

| Setting | Default | Notes |
|---|---|---|
| Count down to | A date & time | Or **A time every day**, which rings daily and then counts down to the next day |
| Date and time | *(none)* | Quick picks: in 1 hour, tomorrow 09:00, New Year |
| Time of day | *(none)* | Daily mode only |
| Label | *(none)* | Up to 12 characters |
| Flash / sound / repeat / notification / snooze / sound file | Same as the timer | |
| Count up after the date passes | On | Date mode only. Shows `+M:SS`, or `+Nd` over `HH:MM` |

The key shows `--:--` until you pick a target. If the target passes while OpenDeck isn't running, the
key shows it as done when it starts, without ringing late.

### Stopwatch

| Setting | Default | Notes |
|---|---|---|
| Label | *(none)* | Up to 12 characters. In lap mode the label shows the lap number instead. |
| Lap mode | Off | Also shows the list of laps in the settings panel |

Laps are saved with the stopwatch, up to 99, so they survive an OpenDeck restart.

### Pomodoro

| Setting | Default | Notes |
|---|---|---|
| Focus / break / long break | 25 / 5 / 15 min | Presets: 25/5/15, 50/10/30, 90/20/30 |
| Long break after | 4 focus rounds | 2 to 6 |
| Start the next phase automatically | Off | When on, phases flow into each other with a chime and a short notification, without ringing |
| Flash / sound / repeat / notification / snooze / sound file | Same as the timer | |

## Requirements

- Linux with [OpenDeck](https://github.com/nekename/OpenDeck) (tested with 7.1.0)
- [Node.js](https://nodejs.org) **22 or newer** (it has the built-in WebSocket client the plugin uses)
- For sound: PipeWire (`pw-play`) or PulseAudio (`paplay`)
- For desktop notifications: `notify-send` (libnotify) and a notification service, as on any
  standard Linux desktop

## Install

### From a release

1. Download `countdown-opendeck-X.Y.Z.zip` from the
   [latest release](https://github.com/NyleGarcia/countdown-opendeck/releases/latest).
   You can check it against the `.sha256` file with `sha256sum -c`.
2. Install it with OpenDeck's install-from-file option in the Plugins view. Or install it by hand:
   ```sh
   unzip countdown-opendeck-*.zip -d ~/.config/opendeck/plugins/
   ```
3. Restart OpenDeck and drag **Countdown → Countdown Timer** onto a key or dial.

### From source (development)

```sh
git clone https://github.com/NyleGarcia/countdown-opendeck.git
cd countdown-opendeck
scripts/install.sh   # symlinks the plugin into ~/.config/opendeck/plugins
```

Restart OpenDeck after installing. Because it's a symlink, edits take effect on the next OpenDeck restart.

### Uninstall

```sh
rm -rf ~/.config/opendeck/plugins/dev.countdown.sdPlugin
```

## Troubleshooting

**The key stays blank or never shows a time.** The plugin probably couldn't find Node. OpenDeck
starts plugins with a minimal `PATH`, so `run.sh` looks for Node in these places, in order:

1. `$COUNTDOWN_NODE`
2. `~/.local/node/bin/node`
3. `~/.volta/bin/node`
4. `/usr/local/bin/node`
5. `/usr/bin/node`
6. whatever `node` is on `PATH`

If your Node lives somewhere else (nvm, fnm, asdf, …), set `COUNTDOWN_NODE` in the environment
OpenDeck starts with. Another option is to symlink your Node binary to `/usr/local/bin/node`.

**Where are the logs?** OpenDeck writes the plugin's output to
`~/.local/share/opendeck/logs/plugins/dev.countdown.sdPlugin.log`. For more detail, start OpenDeck
with `COUNTDOWN_DEBUG=1`.

**No sound.** Press **Test sound** in the settings. Check that the sound file exists and that
`pw-play <file>` plays it from a terminal.

**No notification.** Press **Test notification** in the settings, and check that
`notify-send test` shows something from a terminal. Whether the **Dismiss** and **Snooze** buttons
appear depends on your notification service; the key controls always work.

## Development

### Test

```sh
node --test test/*.test.js     # unit tests
node scripts/smoke-test.js     # end-to-end test
```

The **unit tests** use Node's built-in test runner, so there's nothing to install. They cover time
formatting, the timer, date and daily countdowns, the stopwatch and laps, pomodoro phases, snooze
and dismiss, and the SVG rendering. One test checks that the plugin only loads Node's built-in
modules, so it can never quietly gain a dependency.

The **smoke test** stands in for OpenDeck with a small WebSocket server. It starts the plugin through
`run.sh` and drives all four actions over the real Stream Deck SDK protocol, including the
touch-strip layout, snoozing, and clicking a notification's **Dismiss** button. It swaps
`notify-send` for a stand-in, so no real notifications pop up.

**CI** runs on every push and pull request. It syntax-checks the JavaScript, validates the manifest
and the files it points to, runs `shellcheck` on the shell scripts, and runs the smoke test.

### Releasing

Releases follow [semantic versioning](https://semver.org). The `Version` field in
`dev.countdown.sdPlugin/manifest.json` is the source of truth.

```sh
scripts/release.sh patch            # 0.1.0 -> 0.1.1
scripts/release.sh minor            # 0.1.1 -> 0.2.0
scripts/release.sh major            # 0.2.0 -> 1.0.0
scripts/release.sh 1.1.0-rc.1       # explicit version / prerelease
scripts/release.sh patch --push     # also push the commit and tag
```

The script bumps `Version`, commits `Release vX.Y.Z` and creates the tag `vX.Y.Z`. It refuses to run
with uncommitted changes, reuse an existing tag, or go to a lower version. Bumping a prerelease
finalises it, so `1.0.0-rc.1` becomes `1.0.0`.

Pushing the tag starts the **Release** workflow. It checks that the tag matches the manifest
version, runs the smoke test, and publishes `countdown-opendeck-X.Y.Z.zip` plus its `.sha256`
checksum as a GitHub Release with generated notes. Tags with a suffix, like `-rc.1`, are published
as prereleases.

### Project layout

```
dev.countdown.sdPlugin/     the plugin (this folder is what ships in the zip)
  manifest.json             the four actions, with key and dial definitions
  run.sh                    cleans up the launcher environment and finds Node
  plugin.js                 the four actions, alarm, snooze, notifications, SVG rendering
  pi/                       settings panels: timer, deadline, stopwatch, pomodoro + shared JS/CSS
  layouts/strip.json        touch-strip layout: one full-size image
  icons/                    SVG icons
scripts/
  install.sh                symlink into OpenDeck (development)
  smoke-test.js             end-to-end protocol test
  release.sh                semver bump and tag
test/                       unit tests (node --test)
.github/workflows/          CI and Release
LICENSE                     MIT
```

### Design notes

- **Digits are drawn shapes, not text.** OpenDeck draws titles at the user's font size, which
  defaults to 14 and is too small to read on a key. Drawing the digits in the image keeps them large.
  The OpenDeck title is always left empty.
- **The touch strip uses a custom layout.** The built-in `$A0` layout has a second image area that
  OpenDeck shows as a checkerboard when it's empty. It also falls back to the action name when the
  title is empty. A layout with a single full-size image avoids both.
- **What survives a restart.** Restarting OpenDeck resets a running countdown timer, but its
  settings are kept. A date countdown is worked out from its target, so it's always correct. The
  stopwatch saves its state in its settings. The plugin's in-memory copy wins over a save from the
  settings panel, so an old value there can't stop or rewind a running stopwatch.

## License

[MIT](LICENSE) © 2026 Nyle Garcia
