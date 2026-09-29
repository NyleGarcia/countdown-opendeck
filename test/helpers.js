// Shared helpers for the unit tests. The plugin is loaded without a socket, so every
// message it would send lands in `outbox` for the tests to inspect.
const plugin = require("../dev.countdown.sdPlugin/plugin.js");

// Quiet by default: no sound players or notification processes spawned from tests.
const QUIET = { sound: false, notify: false };

let seq = 0;
function make(kind, settings = {}, now = Date.now()) {
  const t = plugin.get(`${kind}-${++seq}`, kind);
  plugin.KINDS[kind].apply(t, { ...QUIET, ...settings }, now);
  return t;
}

const view = (t, now = Date.now()) => plugin.viewOf(t, now);
const svg = (dataUri) => Buffer.from(dataUri.split(",")[1], "base64").toString();

const pad = (n) => String(n).padStart(2, "0");
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
  `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

module.exports = { plugin, make, view, svg, localIso, QUIET };
