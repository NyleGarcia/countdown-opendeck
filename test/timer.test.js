const test = require("node:test");
const assert = require("node:assert/strict");
const { plugin, make, view } = require("./helpers");

const { KINDS } = plugin;
const timer = KINDS.timer;

test("settings are clamped and defaulted", () => {
  const s = timer.normalize({ hours: 200, minutes: -3, seconds: "7", label: "A very long label" });
  assert.equal(s.hours, 99);
  assert.equal(s.minutes, 5); // invalid falls back to the default
  assert.equal(s.seconds, 7);
  assert.equal(s.label, "A very long ");
  assert.equal(s.snooze, 300);
  assert.equal(s.notify, true);
});

test("start, pause and resume keep the remaining time", () => {
  const t = make("timer", { minutes: 1, seconds: 0 }, 0);
  timer.press("c", t, 0);
  assert.equal(view(t, 20000).main, "0:40");
  timer.press("c", t, 20000); // pause
  assert.equal(view(t, 90000).main, "0:40");
  timer.press("c", t, 90000); // resume
  assert.equal(view(t, 100000).main, "0:30");
});

test("finishing rings and stops at zero, or counts up with overtime", () => {
  const t = make("timer", { minutes: 0, seconds: 5 }, 0);
  timer.press("c", t, 0);
  timer.tick("c", t, 5000);
  assert.equal(t.ringing, true);
  assert.equal(view(t, 9000).main, "0:00");

  const o = make("timer", { minutes: 0, seconds: 5, overtime: true }, 0);
  timer.press("c", o, 0);
  timer.tick("c", o, 5000);
  assert.equal(view(o, 17000).main, "+0:12");
});

test("editing the duration mid-run applies on the next reset", () => {
  const t = make("timer", { minutes: 10 }, 0);
  timer.press("c", t, 0);
  timer.apply(t, { minutes: 3, sound: false, notify: false }, 1000);
  assert.equal(view(t, 60000).main, "9:00");
  timer.hold("c", t, 60000);
  assert.equal(view(t, 60000).main, "3:00");
});

test("dial rotation adjusts the duration and persists it", () => {
  const t = make("timer", { minutes: 5, dialStep: 60 });
  plugin.outbox.length = 0;
  timer.rotate("c", t, 3);
  assert.equal(view(t).main, "8:00");
  assert.equal(plugin.outbox.at(-1).event, "setSettings");
  assert.equal(plugin.outbox.at(-1).payload.minutes, 8);
  timer.rotate("c", t, -100);
  assert.equal(view(t).main, "0:00");
});
