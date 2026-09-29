// Countdown, deadline and stopwatch keys for OpenDeck (Stream Deck SDK v2 protocol).
//
// Timer     key: tap = start / pause, hold = reset, tap while ringing = dismiss + reset.
//           dial: rotate = adjust duration (while stopped), press = start / pause, touch = reset.
// Deadline  counts down to a date/time (or a time every day). Tap = peek at the target,
//           or dismiss while ringing.
// Stopwatch tap = start / pause, hold = reset. State survives OpenDeck restarts.
//
// Zero dependencies: Node >= 22 ships a global WebSocket client.

const { spawn } = require("node:child_process");
const fs = require("node:fs");

const HOLD_MS = 600;
const TICK_MS = 200;
const FLASH_MS = 500;
const PEEK_MS = 2500;
const DAY_MS = 86400000;
const MAX_TIMER_MS = (99 * 3600 + 59 * 60 + 59) * 1000;
const DEFAULT_SOUND = "/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga";

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^-+/, "")] = process.argv[i + 1];
}

const debug = !!process.env.COUNTDOWN_DEBUG;
const log = (...m) => debug && console.error("[countdown]", ...m);

// ---------- settings helpers ----------

function num(v, fallback, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

// Label + alarm options shared by the timer and the deadline.
function alarmSettings(s, overtimeDefault) {
  return {
    label: str(s.label, 12),
    sound: bool(s.sound, true),
    soundFile: typeof s.soundFile === "string" && s.soundFile ? s.soundFile : DEFAULT_SOUND,
    repeatSound: bool(s.repeatSound, false),
    flash: bool(s.flash, true),
    overtime: bool(s.overtime, overtimeDefault),
  };
}

// ---------- formatting ----------

const pad = (n) => String(n).padStart(2, "0");

function clock(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Countdown format: rounds up so 0:00 only shows at the true end; negative = overtime.
function fmt(ms) {
  if (ms < 0) return "+" + clock(Math.floor(-ms / 1000));
  return clock(Math.ceil(ms / 1000));
}

// Long spans: "12d" over "04:31" (hours:minutes left). Under a day: plain clock.
function span(ms) {
  const abs = Math.abs(ms);
  if (abs < DAY_MS) return { main: fmt(ms), sub: "" };
  const secs = Math.floor(abs / 1000);
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return { main: `${ms < 0 ? "+" : ""}${d}d`, sub: `${pad(h)}:${pad(m)}` };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function describeTarget(at, now) {
  const d = new Date(at);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (at - now < 6 * DAY_MS && at > now) return `${DAYS[d.getDay()]} ${hm}`;
  const year = d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}

// ---------- shared alarm ----------

function finish(context, t) {
  t.ringing = true;
  if (t.settings.sound) playSound(t);
  if (t.visible) send({ event: "showAlert", context });
  log("finished", context);
}

function silence(t) {
  stopSound(t);
  t.ringing = false;
}

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

function saveSettings(context, t) {
  send({ event: "setSettings", context, payload: t.settings });
}

// ---------- kind: countdown timer ----------

const timer = {
  normalize(s = {}) {
    return {
      hours: num(s.hours, 0, 99),
      minutes: num(s.minutes, 5, 59),
      seconds: num(s.seconds, 0, 59),
      dialStep: num(s.dialStep, 60, 3600) || 60,
      ...alarmSettings(s, false),
    };
  },
  durationMs: (s) => ((s.hours * 60 + s.minutes) * 60 + s.seconds) * 1000,
  init(t) {
    t.total = t.remaining = timer.durationMs(t.settings);
    t.endAt = 0;
    t.running = false;
  },
  apply(t, raw) {
    const wasIdle = !t.running && !t.ringing && t.remaining === t.total;
    t.settings = timer.normalize(raw);
    const total = timer.durationMs(t.settings);
    if (wasIdle || total === 0) {
      t.total = t.remaining = total;
      delete t.nextTotal;
    } else {
      // Mid-run edit: keep current progress, new duration takes effect on reset.
      t.nextTotal = total;
    }
  },
  remaining: (t, now) => (t.running ? t.endAt - now : t.remaining),
  start(t, now) {
    if (t.remaining <= 0) return;
    t.endAt = now + t.remaining;
    t.running = true;
  },
  pause(t, now) {
    t.remaining = Math.max(0, t.endAt - now);
    t.running = false;
  },
  reset(context, t) {
    silence(t);
    if (t.nextTotal !== undefined) { t.total = t.nextTotal; delete t.nextTotal; }
    t.running = false;
    t.remaining = t.total;
  },
  toggle(context, t, now) {
    if (t.ringing) return timer.reset(context, t);
    if (t.running) timer.pause(t, now);
    else timer.start(t, now);
  },
  press: (c, t, now) => timer.toggle(c, t, now),
  hold: (c, t) => { timer.reset(c, t); return true; },
  dialDown: (c, t, now) => timer.toggle(c, t, now),
  touch: (c, t) => timer.reset(c, t),
  rotate(context, t, ticks) {
    if (t.running || t.ringing) return;
    const total = Math.max(0, Math.min(t.total + ticks * t.settings.dialStep * 1000, MAX_TIMER_MS));
    const secs = Math.round(total / 1000);
    t.settings = timer.normalize({
      ...t.settings,
      hours: Math.floor(secs / 3600),
      minutes: Math.floor((secs % 3600) / 60),
      seconds: secs % 60,
    });
    t.total = t.remaining = total;
    delete t.nextTotal;
    saveSettings(context, t);
  },
  tick(context, t, now) {
    if (!t.running || t.ringing || t.endAt > now) return;
    finish(context, t);
    if (!t.settings.overtime) {
      t.running = false;
      t.remaining = 0;
    }
  },
  active: (t) => t.running,
  view(t, now) {
    const ms = timer.remaining(t, now);
    const frac = t.total > 0 ? Math.max(0, Math.min(1, ms / t.total)) : 0;
    return {
      main: t.ringing && !t.settings.overtime ? "0:00" : fmt(ms),
      sub: "",
      frac,
      state: t.running ? "active" : "idle",
      arc: ringColor(frac),
      label: t.settings.label,
      paused: !t.running && !t.ringing && t.remaining < t.total && t.remaining > 0,
    };
  },
};

// ---------- kind: countdown to a date / daily time ----------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

const deadline = {
  normalize(s = {}) {
    return {
      mode: s.mode === "daily" ? "daily" : "date",
      target: typeof s.target === "string" && DATE_RE.test(s.target) ? s.target : "",
      time: typeof s.time === "string" && TIME_RE.test(s.time) ? s.time : "",
      setAt: Number.isFinite(Number(s.setAt)) ? Number(s.setAt) : 0,
      ...alarmSettings(s, true),
    };
  },
  // Next moment to count down to, in local time; null when not configured.
  compute(s, now) {
    if (s.mode === "daily") {
      const m = TIME_RE.exec(s.time);
      if (!m) return null;
      const d = new Date(now);
      d.setHours(+m[1], +m[2], +(m[3] || 0), 0);
      if (d.getTime() <= now) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    const m = DATE_RE.exec(s.target);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
  },
  init(t) {
    t.at = null;
    t.fired = true;
    t.peekUntil = 0;
  },
  apply(t, raw, now = Date.now()) {
    t.settings = deadline.normalize(raw);
    silence(t);
    t.at = deadline.compute(t.settings, now);
    // A target already in the past (e.g. OpenDeck was off) shows as done; it never rings late.
    t.fired = t.at === null || t.at <= now;
  },
  dismissOrPeek(context, t, now) {
    if (t.ringing) silence(t);
    else t.peekUntil = now + PEEK_MS;
  },
  press: (c, t, now) => deadline.dismissOrPeek(c, t, now),
  hold: (c, t, now) => { deadline.dismissOrPeek(c, t, now); return false; },
  dialDown: (c, t, now) => deadline.dismissOrPeek(c, t, now),
  touch: (c, t, now) => deadline.dismissOrPeek(c, t, now),
  tick(context, t, now) {
    if (t.fired || t.at === null || now < t.at) return;
    finish(context, t);
    t.fired = true;
    if (t.settings.mode === "daily") {
      t.at = deadline.compute(t.settings, now + 1000);
      t.fired = false;
    }
  },
  active: (t) => t.at !== null,
  view(t, now) {
    const s = t.settings;
    if (t.at === null) {
      return { main: "--:--", sub: "", frac: 0, state: "idle", arc: "", paused: false,
        label: s.label || (s.mode === "daily" ? "Set a time" : "Set a date") };
    }
    const ms = t.at - now;
    let frac;
    if (s.mode === "daily") frac = Math.max(0, Math.min(1, ms / DAY_MS));
    else if (s.setAt && t.at > s.setAt) frac = Math.max(0, Math.min(1, ms / (t.at - s.setAt)));
    else frac = ms > 0 ? 1 : 0;

    let shown;
    if (t.ringing) shown = { main: "0:00", sub: "" };
    else if (ms < 0) shown = s.overtime ? span(ms) : { main: "0:00", sub: "" };
    else shown = span(ms);

    const peek = now < t.peekUntil;
    return {
      ...shown,
      frac,
      state: ms > 0 || t.ringing || s.overtime ? "active" : "idle",
      // By time left, not fraction: an hour before a daily alarm is not an emergency.
      arc: ms > 3600000 ? "#3ddc84" : ms > 600000 ? "#ffb020" : "#ff4d4d",
      label: peek ? describeTarget(t.at, now) : s.label,
      paused: false,
    };
  },
};

// ---------- kind: stopwatch ----------

// Running state lives in settings (swAccum / swStart / swRunning) so it survives an
// OpenDeck restart. In memory it is authoritative: a settings save from the inspector
// carries the values it loaded, which may be stale by now.
const stopwatch = {
  normalize(s = {}) {
    const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
    return {
      label: str(s.label, 12),
      swAccum: n(s.swAccum),
      swStart: n(s.swStart),
      swRunning: s.swRunning === true,
    };
  },
  init(t) {
    t.sw = null;
  },
  apply(t, raw, now, context) {
    const incoming = stopwatch.normalize(raw);
    if (!t.sw) {
      t.sw = { accum: incoming.swAccum, start: incoming.swStart, running: incoming.swRunning };
      if (t.sw.running && (!t.sw.start || t.sw.start > now)) t.sw = { accum: 0, start: 0, running: false };
    }
    t.settings = { ...incoming, swAccum: t.sw.accum, swStart: t.sw.start, swRunning: t.sw.running };
    const stale = incoming.swAccum !== t.sw.accum || incoming.swStart !== t.sw.start ||
      incoming.swRunning !== t.sw.running;
    if (stale && context) saveSettings(context, t);
  },
  elapsed: (t, now) => t.sw.accum + (t.sw.running ? now - t.sw.start : 0),
  persist(context, t) {
    Object.assign(t.settings, { swAccum: t.sw.accum, swStart: t.sw.start, swRunning: t.sw.running });
    saveSettings(context, t);
  },
  toggle(context, t, now) {
    if (t.sw.running) t.sw = { accum: stopwatch.elapsed(t, now), start: 0, running: false };
    else t.sw = { accum: t.sw.accum, start: now, running: true };
    stopwatch.persist(context, t);
  },
  reset(context, t) {
    t.sw = { accum: 0, start: 0, running: false };
    stopwatch.persist(context, t);
  },
  press: (c, t, now) => stopwatch.toggle(c, t, now),
  hold: (c, t) => { stopwatch.reset(c, t); return true; },
  dialDown: (c, t, now) => stopwatch.toggle(c, t, now),
  touch: (c, t) => stopwatch.reset(c, t),
  active: (t) => t.sw.running,
  view(t, now) {
    const el = stopwatch.elapsed(t, now);
    return {
      main: clock(Math.floor(el / 1000)),
      sub: "",
      // One sweep of the ring per minute, like a second hand.
      frac: el > 0 ? (el % 60000) / 60000 : 0,
      state: t.sw.running ? "active" : "idle",
      arc: "#3ba7f0",
      label: t.settings.label,
      paused: !t.sw.running && el > 0,
    };
  },
};

const KINDS = { timer, deadline, stopwatch };

function kindOf(action) {
  const k = String(action || "").split(".").pop();
  return KINDS[k] ? k : "timer";
}

// ---------- instance state ----------

// context -> { kind, settings, visible, controller, ringing, flashOn, soundProc,
//              pressedAt, holdTimer, lastImage, lastStrip, ...kind state }
const instances = new Map();

function get(context, kind = "timer") {
  let t = instances.get(context);
  if (!t || t.kind !== kind) {
    t = {
      kind, settings: KINDS[kind].normalize(), visible: false, controller: "Keypad",
      ringing: false, flashOn: false, soundProc: null, pressedAt: 0, holdTimer: null,
      lastImage: null, lastStrip: null,
    };
    KINDS[kind].init(t);
    instances.set(context, t);
  }
  return t;
}

// ---------- rendering ----------

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
  d: "bcdeg", "-": "g", " ": "",
};
const DIGIT_ASPECT = 0.56; // width / height
const THICK = 0.15; // stroke / height

function glyphWidth(ch, h) {
  if (ch === ":") return h * THICK * 2.2;
  if (ch === "+") return h * DIGIT_ASPECT * 0.8;
  if (ch === " ") return h * DIGIT_ASPECT * 0.4;
  if (ch === "1") return h * THICK; // just the right-hand bars, so "10:00" stays centred
  return h * DIGIT_ASPECT;
}

function measure(s, h) {
  const gap = h * 0.12;
  return [...s].reduce((w, ch) => w + glyphWidth(ch, h), 0) + gap * (s.length - 1);
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
    if (!on.includes(k)) continue;
    const [rx, ry, rw, rh] = geo[k].map((n) => n.toFixed(2));
    out += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${(th / 2).toFixed(2)}" fill="${lit}"/>`;
  }
  return out;
}

// Draw `s` centred on (cx, cy), fitting inside maxW with digit height up to maxH.
function drawDigits(s, cx, cy, maxW, maxH, lit) {
  let h = maxH;
  const w = measure(s, h);
  if (w > maxW) h *= maxW / w;
  const gap = h * 0.12;
  const th = h * THICK;
  let x = cx - measure(s, h) / 2;
  const y = cy - h / 2;
  let out = "";
  for (const ch of s) {
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

const IDLE_ARC = "#5d6776";

function palette(view, t) {
  if (t.ringing) {
    const on = t.settings.flash && t.flashOn;
    return { bg: on ? "#c4001f" : "#140a0c", fg: on ? "#ffffff" : "#ff4d4d",
      track: on ? "#e0405a" : "#3a1a20", arc: "#ff4d4d", frac: 0 };
  }
  if (view.state === "active") {
    return { bg: "#0d1014", fg: "#f2f5f9", track: "#222831", arc: view.arc, frac: view.frac };
  }
  return { bg: "#0d1014", fg: "#aeb7c4", track: "#222831", arc: IDLE_ARC, frac: view.frac };
}

// base64 sidesteps any quoting question in the data URI (same as the OpenWave plugin).
const svgWrap = (w, h, shown, body) =>
  "data:image/svg+xml;base64," + Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" data-time="${shown}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
  ).toString("base64");

// OpenDeck's resvg renders SVG text with system fonts; the label lives in the image so
// no OpenDeck-drawn title (size 14 default, falls back to the action name) sits on top.
const FONT = "Liberation Sans, DejaVu Sans, Helvetica, Arial, sans-serif";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (s, x, y, size, fill, anchor = "middle") =>
  `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-family="${FONT}" ` +
  `font-weight="700" text-anchor="${anchor}">${esc(s)}</text>`;

const shownText = (view) => (view.sub ? `${view.main} ${view.sub}` : view.main);
const labelColor = (p) => (p.arc === IDLE_ARC ? p.fg : p.arc);

function keyImage(view, t) {
  const p = palette(view, t);
  const r = 64;
  const c = 2 * Math.PI * r;
  const frac = Math.round(p.frac * 200) / 200; // only redraw when the arc visibly moves
  const { label, sub } = view;
  let body =
    `<rect width="144" height="144" fill="${p.bg}"/>` +
    `<circle cx="72" cy="72" r="${r}" fill="none" stroke="${p.track}" stroke-width="7"/>`;
  if (frac > 0) {
    body += `<circle cx="72" cy="72" r="${r}" fill="none" stroke="${p.arc}" stroke-width="7" ` +
      `stroke-linecap="round" stroke-dasharray="${(c * frac).toFixed(2)} ${c.toFixed(2)}" ` +
      `transform="rotate(-90 72 72)"/>`;
  }
  if (label) body += text(label, 72, 52, Math.min(17, Math.floor(160 / label.length)), labelColor(p));
  let cy = label ? 80 : 72;
  if (sub) {
    cy = label ? 76 : 64;
    body += drawDigits(view.main, 72, cy, 88, label ? 30 : 38, p.fg);
    body += drawDigits(sub, 72, cy + (label ? 30 : 36), 70, label ? 16 : 20, p.fg);
  } else {
    body += drawDigits(view.main, 72, cy, label ? 88 : 96, label ? 36 : view.main.length <= 4 ? 44 : 36, p.fg);
  }
  if (view.paused) {
    body += `<rect x="63" y="${cy + 26}" width="6" height="14" rx="2" fill="${p.arc}"/>` +
      `<rect x="75" y="${cy + 26}" width="6" height="14" rx="2" fill="${p.arc}"/>`;
  }
  return svgWrap(144, 144, shownText(view), body);
}

// Touch strip segment: big digits over a horizontal progress bar.
function stripImage(view, t) {
  const p = palette(view, t);
  const frac = Math.round(p.frac * 400) / 400;
  const { paused, label } = view;
  const barX = 16, barW = 168, barY = 80, barH = 8;
  let body =
    `<rect width="200" height="100" fill="${p.bg}"/>` +
    (label ? text(label, 16, 22, 15, labelColor(p), "start") : "") +
    drawDigits(shownText(view), paused ? 92 : 100, label ? 50 : 42, paused ? 150 : 172, label ? 40 : 52, p.fg) +
    `<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="4" fill="${p.track}"/>`;
  if (frac > 0) {
    body += `<rect x="${barX}" y="${barY}" width="${Math.max(barH, barW * frac).toFixed(2)}" height="${barH}" rx="4" fill="${p.arc}"/>`;
  }
  if (paused) {
    body += `<rect x="172" y="30" width="6" height="22" rx="2" fill="${p.arc}"/>` +
      `<rect x="182" y="30" width="6" height="22" rx="2" fill="${p.arc}"/>`;
  }
  return svgWrap(200, 100, shownText(view), body);
}

function render(context, t, force = false) {
  if (!t.visible) return;
  const view = KINDS[t.kind].view(t, Date.now());
  if (force) send({ event: "setTitle", context, payload: { title: "", target: 0 } });
  // Encoders get both: the strip is what the hardware shows, the key image is what
  // OpenDeck's editor draws for the dial.
  const image = keyImage(view, t);
  if (force || image !== t.lastImage) {
    t.lastImage = image;
    send({ event: "setImage", context, payload: { image, target: 0 } });
  }
  if (t.controller === "Encoder") {
    const strip = stripImage(view, t);
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
  for (const [context, t] of instances) {
    const k = KINDS[t.kind];
    if (k.tick) k.tick(context, t, now);
    if (t.ringing && flip) t.flashOn = !t.flashOn;
    if (k.active(t) || t.ringing) render(context, t);
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
  // Hold fires while still held, so the key reacts without waiting for release.
  t.holdTimer = setTimeout(() => {
    t.holdTimer = null;
    t.pressedAt = 0;
    const ok = KINDS[t.kind].hold(context, t, Date.now());
    render(context, t, true);
    if (ok) send({ event: "showOk", context });
  }, HOLD_MS);
}

function onKeyUp(context, t) {
  if (!t.pressedAt) return; // hold already handled it
  clearTimeout(t.holdTimer);
  t.holdTimer = null;
  t.pressedAt = 0;
  KINDS[t.kind].press(context, t, Date.now());
  render(context, t, true);
}

function handle(msg) {
  const { event, context, payload = {} } = msg;
  if (!context) return;
  // Only willAppear reliably carries the action; afterwards use what we already know.
  const known = instances.get(context);
  const t = msg.action ? get(context, kindOf(msg.action)) : known || get(context);
  const k = KINDS[t.kind];
  const now = Date.now();

  switch (event) {
    case "willAppear":
      t.visible = true;
      t.controller = payload.controller || "Keypad";
      k.apply(t, payload.settings || {}, now, context);
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
      k.apply(t, payload.settings || {}, now, context);
      render(context, t, true);
      break;
    case "keyDown":
      onKeyDown(context, t);
      break;
    case "keyUp":
      onKeyUp(context, t);
      break;
    case "dialDown":
      k.dialDown(context, t, now);
      render(context, t, true);
      break;
    case "touchTap":
      k.touch(context, t, now);
      render(context, t, true);
      break;
    case "dialRotate":
      if (k.rotate) { k.rotate(context, t, Number(payload.ticks) || 0); render(context, t, true); }
      break;
    case "sendToPlugin":
      if (payload.command === "testSound" && t.settings.soundFile) {
        playSound({ settings: t.settings, ringing: false, soundProc: null });
      }
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
    for (const t of instances.values()) stopSound(t);
    process.exit(0);
  });
  ws.addEventListener("error", (e) => log("ws error", e.message || e));
}

if (require.main === module) connect();

module.exports = { KINDS, get, fmt, span, clock, describeTarget, keyImage, stripImage, instances };
