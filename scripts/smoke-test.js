// End-to-end smoke test: stands in for OpenDeck with a minimal WebSocket server,
// launches the plugin via run.sh, and drives it through the SDK protocol.
// Usage: node scripts/smoke-test.js
const http = require("node:http");
const crypto = require("node:crypto");
const path = require("node:path");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");

const PLUGIN = path.join(__dirname, "..", "dev.countdown.sdPlugin");
const CTX = "ctx-1";

function frame(text) {
  const data = Buffer.from(text);
  const len = data.length;
  const head = len < 126 ? Buffer.from([0x81, len])
    : len < 65536 ? Buffer.from([0x81, 126, len >> 8, len & 255])
    : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
  return Buffer.concat([head, data]);
}

function parser(onText) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const masked = buf[1] & 128;
      const total = off + (masked ? 4 : 0) + len;
      if (buf.length < total) return;
      const mask = masked ? buf.subarray(off, off + 4) : null;
      const payload = Buffer.from(buf.subarray(total - len, total));
      if (mask) for (let i = 0; i < len; i++) payload[i] ^= mask[i % 4];
      const op = buf[0] & 15;
      buf = buf.subarray(total);
      if (op === 1) onText(payload.toString());
    }
  };
}

const received = [];
let sock;
const send = (msg) => sock.write(frame(JSON.stringify(msg)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const last = (event, ctx) =>
  [...received].reverse().find((m) => m.event === event && (!ctx || m.context === ctx));
// The time is drawn into the image; the SVG carries it as data-time for tests.
const shown = (event = "setImage", key = "image", ctx) => {
  const m = last(event, ctx);
  const svg = Buffer.from(m.payload[key].split(",")[1], "base64").toString();
  return svg.match(/data-time="([^"]*)"/)[1];
};

const server = http.createServer();
server.on("upgrade", (req, socket) => {
  const accept = crypto.createHash("sha1")
    .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock = socket;
  socket.on("data", parser((t) => received.push(JSON.parse(t))));
});

server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  const proc = spawn(path.join(PLUGIN, "run.sh"),
    ["-port", String(port), "-pluginUUID", "dev.countdown", "-registerEvent", "registerPlugin", "-info", "{}"],
    { stdio: ["ignore", "inherit", "inherit"] });
  let failed = false;
  try {
    await sleep(600);
    assert.equal(received[0]?.event, "registerPlugin", "plugin registers");

    const settings = { hours: 0, minutes: 0, seconds: 2, sound: false, label: "Tea" };
    send({ event: "willAppear", action: "dev.countdown.timer", context: CTX,
      payload: { settings, controller: "Keypad" } });
    await sleep(200);
    assert.equal(shown(), "0:02", "initial time");
    assert.equal(last("setTitle").payload.title, "", "title kept empty");
    assert.match(Buffer.from(last("setImage").payload.image.split(",")[1], "base64").toString(), />Tea</, "label drawn");
    assert.match(last("setImage").payload.image, /^data:image\/svg\+xml;base64,/, "svg image");

    // Tap -> start
    send({ event: "keyDown", context: CTX, payload: {} });
    send({ event: "keyUp", context: CTX, payload: {} });
    await sleep(1200);
    assert.equal(shown(), "0:01", "counting down");

    // Tap -> pause, value holds
    send({ event: "keyDown", context: CTX, payload: {} });
    send({ event: "keyUp", context: CTX, payload: {} });
    const paused = shown();
    await sleep(1200);
    assert.equal(shown(), paused, "paused holds");

    // Resume -> finishes -> alert
    send({ event: "keyDown", context: CTX, payload: {} });
    send({ event: "keyUp", context: CTX, payload: {} });
    await sleep(1600);
    assert.ok(received.some((m) => m.event === "showAlert"), "alert on finish");
    assert.equal(shown(), "0:00", "shows zero");

    // Hold -> reset
    send({ event: "keyDown", context: CTX, payload: {} });
    await sleep(800);
    send({ event: "keyUp", context: CTX, payload: {} });
    await sleep(100);
    assert.ok(received.some((m) => m.event === "showOk"), "ok on reset");
    assert.equal(shown(), "0:02", "reset to full");

    // Settings change while idle applies immediately
    send({ event: "didReceiveSettings", context: CTX,
      payload: { settings: { minutes: 25, seconds: 0, label: "" } } });
    await sleep(100);
    assert.equal(shown(), "25:00", "new duration");

    // Dial rotate adjusts by step
    send({ event: "dialRotate", context: CTX, payload: { ticks: -2 } });
    await sleep(100);
    assert.equal(shown(), "23:00", "dial adjust");
    assert.equal(last("setSettings").payload.minutes, 23, "dial persists settings");

    // Overtime counts up
    send({ event: "didReceiveSettings", context: CTX,
      payload: { settings: { minutes: 0, seconds: 1, overtime: true, sound: false } } });
    send({ event: "dialDown", context: CTX, payload: {} });
    await sleep(2400);
    assert.match(shown(), /^\+0:0[12]$/, "overtime counts up");
    send({ event: "touchTap", context: CTX, payload: {} });
    await sleep(100);
    assert.equal(shown(), "0:01", "touch resets");

    // Encoder: custom one-pixmap layout + strip canvas
    send({ event: "willAppear", action: "dev.countdown.timer", context: "enc-1",
      payload: { settings: { minutes: 3 }, controller: "Encoder" } });
    await sleep(150);
    const lay = received.find((m) => m.event === "setFeedbackLayout" && m.context === "enc-1");
    assert.equal(lay?.payload.layout, "layouts/strip.json", "strip layout set");
    assert.equal(shown("setFeedback", "canvas"), "3:00", "strip shows time");

    // ---- Countdown to date ----
    const pad = (n) => String(n).padStart(2, "0");
    const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const DL = "dl-1";
    const now = Date.now();
    send({ event: "willAppear", action: "dev.countdown.deadline", context: DL,
      payload: { settings: { mode: "date", target: local(new Date(now + 2500)), setAt: now, sound: false,
        overtime: false }, controller: "Keypad" } });
    await sleep(150);
    assert.match(shown("setImage", "image", DL), /^0:0[23]$/, "deadline counts down");
    await sleep(2800);
    assert.ok(received.some((m) => m.event === "showAlert" && m.context === DL), "deadline alerts");
    assert.equal(shown("setImage", "image", DL), "0:00", "deadline shows zero");
    send({ event: "keyDown", action: "dev.countdown.deadline", context: DL, payload: {} });
    send({ event: "keyUp", action: "dev.countdown.deadline", context: DL, payload: {} });
    await sleep(100);
    assert.equal(shown("setImage", "image", DL), "0:00", "dismissed stays at zero without overtime");

    // Far away: days over hours:minutes; tap peeks at the target
    const far = new Date(now + 3 * 86400000 + 5 * 3600000 + 30 * 60000);
    send({ event: "didReceiveSettings", action: "dev.countdown.deadline", context: DL,
      payload: { settings: { mode: "date", target: local(far), sound: false } } });
    await sleep(100);
    assert.match(shown("setImage", "image", DL), /^3d 05:(29|30)$/, "days + hh:mm");
    send({ event: "keyDown", action: "dev.countdown.deadline", context: DL, payload: {} });
    send({ event: "keyUp", action: "dev.countdown.deadline", context: DL, payload: {} });
    await sleep(100);
    const peekSvg = Buffer.from(last("setImage", DL).payload.image.split(",")[1], "base64").toString();
    assert.match(peekSvg, /(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d</, "tap peeks at target");

    // Past date with a fresh load: done, never rings late
    const alertsBefore = received.filter((m) => m.event === "showAlert").length;
    send({ event: "didReceiveSettings", action: "dev.countdown.deadline", context: DL,
      payload: { settings: { mode: "date", target: local(new Date(now - 60000)), overtime: true } } });
    await sleep(400);
    assert.match(shown("setImage", "image", DL), /^\+\d+:\d\d$/, "past date counts up with overtime");
    assert.equal(received.filter((m) => m.event === "showAlert").length, alertsBefore, "no late alarm");

    // Daily mode: next occurrence is always in the future
    const inOneMin = new Date(now + 90000);
    send({ event: "didReceiveSettings", action: "dev.countdown.deadline", context: DL,
      payload: { settings: { mode: "daily", time: `${pad(inOneMin.getHours())}:${pad(inOneMin.getMinutes())}:00` } } });
    await sleep(100);
    assert.match(shown("setImage", "image", DL), /^[01]:\d\d$/, "daily counts to today's time");

    // Unconfigured
    send({ event: "didReceiveSettings", action: "dev.countdown.deadline", context: DL,
      payload: { settings: { mode: "date" } } });
    await sleep(100);
    assert.equal(shown("setImage", "image", DL), "--:--", "unset target");

    // ---- Stopwatch ----
    const SW = "sw-1";
    send({ event: "willAppear", action: "dev.countdown.stopwatch", context: SW,
      payload: { settings: {}, controller: "Keypad" } });
    await sleep(100);
    assert.equal(shown("setImage", "image", SW), "0:00", "stopwatch idle");
    send({ event: "keyDown", action: "dev.countdown.stopwatch", context: SW, payload: {} });
    send({ event: "keyUp", action: "dev.countdown.stopwatch", context: SW, payload: {} });
    await sleep(1300);
    assert.equal(shown("setImage", "image", SW), "0:01", "stopwatch counts up");
    assert.equal(last("setSettings", SW).payload.swRunning, true, "running state persisted");

    // A stale inspector save must not stop or rewind it
    send({ event: "didReceiveSettings", action: "dev.countdown.stopwatch", context: SW,
      payload: { settings: { label: "Lap", swRunning: false, swAccum: 0, swStart: 0 } } });
    await sleep(900);
    assert.equal(shown("setImage", "image", SW), "0:02", "stale settings ignored");
    assert.equal(last("setSettings", SW).payload.label, "Lap", "label kept on re-save");

    send({ event: "keyDown", action: "dev.countdown.stopwatch", context: SW, payload: {} });
    send({ event: "keyUp", action: "dev.countdown.stopwatch", context: SW, payload: {} });
    await sleep(100);
    const saved = last("setSettings", SW).payload;
    assert.equal(saved.swRunning, false, "pause persisted");
    assert.ok(saved.swAccum >= 2000, "accumulated time persisted");

    // Restart: a new plugin process restores from settings
    send({ event: "willAppear", action: "dev.countdown.stopwatch", context: "sw-2",
      payload: { settings: { swRunning: true, swStart: Date.now() - 65000, swAccum: 0 }, controller: "Keypad" } });
    await sleep(100);
    assert.equal(shown("setImage", "image", "sw-2"), "1:05", "restored after restart");

    send({ event: "keyDown", action: "dev.countdown.stopwatch", context: SW, payload: {} });
    await sleep(800);
    send({ event: "keyUp", action: "dev.countdown.stopwatch", context: SW, payload: {} });
    await sleep(100);
    assert.equal(shown("setImage", "image", SW), "0:00", "hold resets stopwatch");

    console.log("smoke test: PASS");
  } catch (e) {
    failed = true;
    console.error("smoke test: FAIL -", e.message);
    console.error(received.slice(-8).map((m) => `${m.event} ${m.context || ""}`).join("\n"));
  } finally {
    sock?.destroy();
    await sleep(300);
    assert.notEqual(proc.exitCode, null, "plugin exits when socket closes");
    server.close();
    process.exit(failed ? 1 : 0);
  }
});
