// Countdown timer for OpenDeck (Stream Deck SDK v2 protocol).
//
// Key:   tap = start / pause, hold = reset, tap while ringing = dismiss + reset.
// Dial:  rotate = adjust duration (while stopped), press = start / pause, touch = reset.
//
// Zero dependencies: Node >= 22 ships a global WebSocket client.

const { spawn } = require("node:child_process");
const fs = require("node:fs");

const HOLD_MS = 600;
const TICK_MS = 200;
const FLASH_MS = 500;
const DEFAULT_SOUND = "/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga";

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^-+/, "")] = process.argv[i + 1];
}

const debug = !!process.env.COUNTDOWN_DEBUG;
const log = (...m) => debug && console.error("[countdown]", ...m);

// ---------- settings ----------

function num(v, fallback, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

function normalize(s = {}) {
  return {
    hours: num(s.hours, 0, 99),
    minutes: num(s.minutes, 5, 59),
    seconds: num(s.seconds, 0, 59),
    label: typeof s.label === "string" ? s.label.slice(0, 12) : "",
    sound: s.sound !== false,
    soundFile: typeof s.soundFile === "string" && s.soundFile ? s.soundFile : DEFAULT_SOUND,
    repeatSound: s.repeatSound === true,
    flash: s.flash !== false,
    overtime: s.overtime === true,
    dialStep: num(s.dialStep, 60, 3600) || 60,
  };
}

const durationMs = (s) => ((s.hours * 60 + s.minutes) * 60 + s.seconds) * 1000;

// ---------- timer state ----------

// context -> { settings, total, remaining, endAt, running, ringing, visible, controller,
//              pressedAt, holdTimer, lastImage, lastStrip, flashOn, soundProc }
const timers = new Map();

function get(context) {
  let t = timers.get(context);
  if (!t) {
    const settings = normalize();
    t = {
      settings, total: durationMs(settings), remaining: durationMs(settings),
      endAt: 0, running: false, ringing: false, visible: false, controller: "Keypad",
      pressedAt: 0, holdTimer: null, lastImage: null, lastStrip: null, flashOn: false,
      soundProc: null,
    };
    timers.set(context, t);
  }
  return t;
}

function remainingNow(t) {
  return t.running ? t.endAt - Date.now() : t.remaining;
}

function applySettings(t, raw) {
  const wasIdle = !t.running && !t.ringing && t.remaining === t.total;
  t.settings = normalize(raw);
  const total = durationMs(t.settings);
  if (wasIdle || total === 0) {
    t.total = total;
    t.remaining = total;
    delete t.nextTotal;
  } else {
    // Mid-run edit: keep current progress, new duration takes effect on reset.
    t.nextTotal = total;
  }
}

function start(t) {
  if (t.remaining <= 0) return;
  t.endAt = Date.now() + t.remaining;
  t.running = true;
}

function pause(t) {
  t.remaining = Math.max(0, t.endAt - Date.now());
  t.running = false;
}

function reset(t) {
  stopSound(t);
  if (t.nextTotal !== undefined) { t.total = t.nextTotal; delete t.nextTotal; }
  t.running = false;
  t.ringing = false;
  t.remaining = t.total;
}

function toggle(t) {
  if (t.ringing) return reset(t);
  if (t.running) pause(t);
  else start(t);
}

function finish(context, t) {
  t.ringing = true;
  if (!t.settings.overtime) {
    t.running = false;
    t.remaining = 0;
  }
  if (t.settings.sound) playSound(t);
  if (t.visible) send({ event: "showAlert", context });
  log("finished", context);
}

// ---------- sound ----------

function playSound(t) {
  stopSound(t);
  const file = t.settings.soundFile;
  if (!fs.existsSync(file)) { log("sound file missing", file); return; }
  const player = ["/usr/bin/pw-play", "/usr/bin/paplay"].find((p) => fs.existsSync(p));
  if (!player) return;
  const proc = spawn(player, [file], { stdio: "ignore" });
  t.soundProc = proc;
  proc.on("error", (e) => log("sound error", e.message));
  proc.on("exit", () => {
    if (t.soundProc !== proc) return;
    t.soundProc = null;
    if (t.ringing && t.settings.repeatSound) playSound(t);
  });
}

function stopSound(t) {
  const p = t.soundProc;
  t.soundProc = null;
  if (p) p.kill();
}

// ---------- rendering ----------

function fmt(ms) {
  const neg = ms < 0;
  // Round up while counting down so 0:00 only shows at the true end.
  const total = neg ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  const body = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return neg ? `+${body}` : body;
}

function ringColor(frac) {
  if (frac > 0.25) return "#3ddc84";
  if (frac > 0.1) return "#ffb020";
  return "#ff4d4d";
}

// Digits are drawn as seven-segment shapes, not SVG text: OpenDeck draws titles at
// the user's font size (14pt by default = unreadable on a key), and the rasterizer has
// no guaranteed fonts. Paths render the same everywhere.
const SEGMENTS = {
  0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc",
  5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcdfg",
};
const DIGIT_ASPECT = 0.56; // width / height
const THICK = 0.15; // stroke / height

function glyphWidth(ch, h) {
  if (ch === ":") return h * THICK * 2.2;
  if (ch === "+") return h * DIGIT_ASPECT * 0.8;
  if (ch === "1") return h * THICK; // just the right-hand bars, so "10:00" stays centred
  return h * DIGIT_ASPECT;
}

function measure(str, h) {
  const gap = h * 0.12;
  return [...str].reduce((w, ch) => w + glyphWidth(ch, h), 0) + gap * (str.length - 1);
}

function segRects(x, y, w, h, on, lit) {
  const th = h * THICK;
  const inset = th * 0.55;
  const half = h / 2;
  const vh = half - inset - th * 0.15;
  const geo = {
    a: [x + inset, y, w - 2 * inset, th],
    g: [x + inset, y + half - th / 2, w - 2 * inset, th],
    d: [x + inset, y + h - th, w - 2 * inset, th],
    f: [x, y + inset, th, vh],
    b: [x + w - th, y + inset, th, vh],
    e: [x, y + half + th * 0.15, th, vh],
    c: [x + w - th, y + half + th * 0.15, th, vh],
  };
  let out = "";
  for (const k of "abcdefg") {
    const [rx, ry, rw, rh] = geo[k].map((n) => n.toFixed(2));
    if (!on.includes(k)) continue;
    out += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${(th / 2).toFixed(2)}" fill="${lit}"/>`;
  }
  return out;
}

// Draw `str` centred on (cx, cy), fitting inside maxW with digit height up to maxH.
function drawDigits(str, cx, cy, maxW, maxH, lit) {
  let h = maxH;
  const w = measure(str, h);
  if (w > maxW) h *= maxW / w;
  const gap = h * 0.12;
  const th = h * THICK;
  let x = cx - measure(str, h) / 2;
  const y = cy - h / 2;
  let out = "";
  for (const ch of str) {
    const gw = glyphWidth(ch, h);
    if (ch === ":") {
      const dx = (x + (gw - th) / 2).toFixed(2);
      out += `<rect x="${dx}" y="${(y + h * 0.26).toFixed(2)}" width="${th.toFixed(2)}" height="${th.toFixed(2)}" rx="${(th / 3).toFixed(2)}" fill="${lit}"/>`;
      out += `<rect x="${dx}" y="${(y + h * 0.64).toFixed(2)}" width="${th.toFixed(2)}" height="${th.toFixed(2)}" rx="${(th / 3).toFixed(2)}" fill="${lit}"/>`;
    } else if (ch === "+") {
      const len = gw;
      const my = y + h / 2;
      out += `<rect x="${x.toFixed(2)}" y="${(my - th / 2).toFixed(2)}" width="${len.toFixed(2)}" height="${th.toFixed(2)}" rx="${(th / 2).toFixed(2)}" fill="${lit}"/>`;
      out += `<rect x="${(x + (len - th) / 2).toFixed(2)}" y="${(my - len / 2).toFixed(2)}" width="${th.toFixed(2)}" height="${len.toFixed(2)}" rx="${(th / 2).toFixed(2)}" fill="${lit}"/>`;
    } else {
      out += segRects(x, y, gw, h, SEGMENTS[ch] || "", lit);
    }
    x += gw + gap;
  }
  return out;
}

function palette(t, ms) {
  const frac = t.total > 0 ? Math.max(0, Math.min(1, ms / t.total)) : 0;
  if (t.ringing) {
    const on = t.settings.flash && t.flashOn;
    return { frac: 0, bg: on ? "#c4001f" : "#140a0c", fg: on ? "#ffffff" : "#ff4d4d", track: on ? "#e0405a" : "#3a1a20", arc: "#ff4d4d" };
  }
  if (t.running) {
    const arc = ringColor(frac);
    return { frac, bg: "#0d1014", fg: "#f2f5f9", track: "#222831", arc };
  }
  // Idle / paused: calm grey, full or partial ring.
  return { frac, bg: "#0d1014", fg: "#aeb7c4", track: "#222831", arc: "#5d6776" };
}

// base64 sidesteps any quoting question in the data URI (same as the OpenWave plugin).
const svgWrap = (w, h, time, body) =>
  "data:image/svg+xml;base64," + Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" data-time="${time}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
  ).toString("base64");

// OpenDeck's resvg renders SVG text with system fonts; the label lives in the image so
// no OpenDeck-drawn title (size 14 default, falls back to the action name) sits on top.
const FONT = "Liberation Sans, DejaVu Sans, Helvetica, Arial, sans-serif";
const esc = (str) => String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (str, x, y, size, fill, anchor = "middle") =>
  `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-family="${FONT}" ` +
  `font-weight="700" text-anchor="${anchor}">${esc(str)}</text>`;

function keyImage(t, ms, time) {
  const p = palette(t, ms);
  const r = 64;
  const c = 2 * Math.PI * r;
  const frac = Math.round(p.frac * 200) / 200; // only redraw when the arc visibly moves
  const paused = !t.running && !t.ringing && t.remaining < t.total && t.remaining > 0;
  const label = t.settings.label;
  const cy = label ? 80 : 72;
  let body =
    `<rect width="144" height="144" fill="${p.bg}"/>` +
    `<circle cx="72" cy="72" r="${r}" fill="none" stroke="${p.track}" stroke-width="7"/>`;
  if (frac > 0) {
    body += `<circle cx="72" cy="72" r="${r}" fill="none" stroke="${p.arc}" stroke-width="7" ` +
      `stroke-linecap="round" stroke-dasharray="${(c * frac).toFixed(2)} ${c.toFixed(2)}" ` +
      `transform="rotate(-90 72 72)"/>`;
  }
  if (label) body += text(label, 72, 52, Math.min(17, Math.floor(160 / label.length)), p.arc === "#5d6776" ? p.fg : p.arc);
  body += drawDigits(time, 72, cy, label ? 88 : 96, label ? 36 : time.length <= 4 ? 44 : 36, p.fg);
  if (paused) {
    body += `<rect x="63" y="${cy + 26}" width="6" height="14" rx="2" fill="${p.arc}"/>` +
      `<rect x="75" y="${cy + 26}" width="6" height="14" rx="2" fill="${p.arc}"/>`;
  }
  return svgWrap(144, 144, time, body);
}

// Touch strip segment ($A0 full-canvas): big digits over a horizontal progress bar.
function stripImage(t, ms, time) {
  const p = palette(t, ms);
  const frac = Math.round(p.frac * 400) / 400;
  const paused = !t.running && !t.ringing && t.remaining < t.total && t.remaining > 0;
  const barX = 16, barW = 168, barY = 80, barH = 8;
  let body =
    `<rect width="200" height="100" fill="${p.bg}"/>` +
    (t.settings.label ? text(t.settings.label, 16, 22, 15, p.arc === "#5d6776" ? p.fg : p.arc, "start") : "") +
    drawDigits(time, paused ? 92 : 100, t.settings.label ? 50 : 42, paused ? 150 : 172, t.settings.label ? 40 : 52, p.fg) +
    `<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="4" fill="${p.track}"/>`;
  if (frac > 0) {
    body += `<rect x="${barX}" y="${barY}" width="${Math.max(barH, barW * frac).toFixed(2)}" height="${barH}" rx="4" fill="${p.arc}"/>`;
  }
  if (paused) {
    body += `<rect x="172" y="30" width="6" height="22" rx="2" fill="${p.arc}"/>` +
      `<rect x="182" y="30" width="6" height="22" rx="2" fill="${p.arc}"/>`;
  }
  return svgWrap(200, 100, time, body);
}

function render(context, t, force = false) {
  if (!t.visible) return;
  const ms = remainingNow(t);
  const time = t.ringing && !t.settings.overtime ? "0:00" : fmt(ms);
  if (force) send({ event: "setTitle", context, payload: { title: "", target: 0 } });
  // Encoders get both: the strip is what the hardware shows, the key image is what
  // OpenDeck's editor draws for the dial.
  const image = keyImage(t, ms, time);
  if (force || image !== t.lastImage) {
    t.lastImage = image;
    send({ event: "setImage", context, payload: { image, target: 0 } });
  }
  if (t.controller === "Encoder") {
    const strip = stripImage(t, ms, time);
    if (force || strip !== t.lastStrip) {
      t.lastStrip = strip;
      send({ event: "setFeedback", context, payload: { canvas: strip } });
    }
  }
}

// One loop for every instance: cheap, and keeps all keys in lockstep.
let flashAt = 0;
setInterval(() => {
  const now = Date.now();
  const flip = now - flashAt >= FLASH_MS;
  if (flip) flashAt = now;
  for (const [context, t] of timers) {
    if (t.running && !t.ringing && t.endAt - now <= 0) finish(context, t);
    if (t.ringing && flip) t.flashOn = !t.flashOn;
    if (t.running || t.ringing) render(context, t);
  }
}, TICK_MS);

// ---------- socket ----------

let ws;
const queue = [];

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else queue.push(msg);
}

function onKeyDown(context, t) {
  t.pressedAt = Date.now();
  clearTimeout(t.holdTimer);
  // Reset fires while still held, so the key reacts without waiting for release.
  t.holdTimer = setTimeout(() => {
    t.holdTimer = null;
    t.pressedAt = 0;
    reset(t);
    render(context, t, true);
    send({ event: "showOk", context });
  }, HOLD_MS);
}

function onKeyUp(context, t) {
  if (!t.pressedAt) return; // hold already handled it
  clearTimeout(t.holdTimer);
  t.holdTimer = null;
  t.pressedAt = 0;
  toggle(t);
  render(context, t, true);
}

function onDialRotate(context, t, ticks) {
  if (t.running || t.ringing) return;
  const step = t.settings.dialStep * 1000;
  const total = Math.max(0, Math.min(t.total + ticks * step, 99 * 3600 * 1000 + 59 * 60 * 1000 + 59000));
  const secs = Math.round(total / 1000);
  const next = {
    ...t.settings,
    hours: Math.floor(secs / 3600),
    minutes: Math.floor((secs % 3600) / 60),
    seconds: secs % 60,
  };
  t.total = t.remaining = total;
  delete t.nextTotal;
  t.settings = normalize(next);
  send({ event: "setSettings", context, payload: t.settings });
  render(context, t, true);
}

function handle(msg) {
  const { event, context, payload = {} } = msg;
  if (!context) return;
  const t = get(context);

  switch (event) {
    case "willAppear":
      t.visible = true;
      t.controller = payload.controller || "Keypad";
      applySettings(t, payload.settings);
      // $A0 would paint its unset second canvas as a checkerboard and fall back to the
      // action name for an empty title; a one-pixmap layout has neither.
      if (t.controller === "Encoder") {
        send({ event: "setFeedbackLayout", context, payload: { layout: "layouts/strip.json" } });
      }
      render(context, t, true);
      break;
    case "willDisappear":
      // Keep ticking in the background: a timer should not stop because you switched page.
      t.visible = false;
      t.lastImage = t.lastStrip = null;
      break;
    case "didReceiveSettings":
      applySettings(t, payload.settings);
      render(context, t, true);
      break;
    case "keyDown":
      onKeyDown(context, t);
      break;
    case "keyUp":
      onKeyUp(context, t);
      break;
    case "dialDown":
      toggle(t);
      render(context, t, true);
      break;
    case "touchTap":
      reset(t);
      render(context, t, true);
      break;
    case "dialRotate":
      onDialRotate(context, t, Number(payload.ticks) || 0);
      break;
    case "sendToPlugin":
      if (payload.command === "reset") { reset(t); render(context, t, true); }
      if (payload.command === "toggle") { toggle(t); render(context, t, true); }
      if (payload.command === "testSound") playSound({ ...t, settings: t.settings, ringing: false });
      break;
  }
}

function connect() {
  if (!args.port || !args.pluginUUID || !args.registerEvent) {
    console.error("countdown: missing -port / -pluginUUID / -registerEvent");
    process.exit(1);
  }
  ws = new WebSocket(`ws://127.0.0.1:${args.port}`);
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ event: args.registerEvent, uuid: args.pluginUUID }));
    while (queue.length) ws.send(JSON.stringify(queue.shift()));
    log("registered");
  });
  ws.addEventListener("message", (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    try { handle(msg); } catch (err) { console.error("countdown:", err); }
  });
  // OpenDeck owns our lifetime: when it goes, we go.
  ws.addEventListener("close", () => {
    for (const t of timers.values()) stopSound(t);
    process.exit(0);
  });
  ws.addEventListener("error", (e) => log("ws error", e.message || e));
}

if (require.main === module) connect();

module.exports = { normalize, durationMs, fmt, keyImage, stripImage, get, toggle, reset, start, pause, applySettings, timers };
