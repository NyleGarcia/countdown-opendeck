const test = require("node:test");
const assert = require("node:assert/strict");
const { plugin, make, view } = require("./helpers");

const sw = plugin.KINDS.stopwatch;

test("counts up, pauses and resets", () => {
  const t = make("stopwatch", {}, 0);
  sw.press("c", t, 0);
  assert.equal(view(t, 65000).main, "1:05");
  sw.press("c", t, 65000);
  assert.equal(view(t, 999000).main, "1:05");
  assert.equal(view(t, 999000).paused, true);
  sw.hold("c", t, 999000);
  assert.equal(view(t, 999000).main, "0:00");
});

test("restores a running stopwatch from saved settings", () => {
  const t = make("stopwatch", { swRunning: true, swStart: 1000, swAccum: 5000 }, 61000);
  assert.equal(view(t, 61000).main, "1:05");
});

test("discards a saved start time in the future", () => {
  const t = make("stopwatch", { swRunning: true, swStart: 99999 }, 1000);
  assert.equal(t.sw.running, false);
});

test("a stale settings save does not stop or rewind it", () => {
  const t = make("stopwatch", {}, 0);
  sw.press("c", t, 0);
  sw.apply(t, { label: "Run", swRunning: false, swAccum: 0, swStart: 0 }, 10000, "c");
  assert.equal(t.sw.running, true);
  assert.equal(view(t, 10000).main, "0:10");
  assert.equal(t.settings.label, "Run");
});

test("lap mode: tap laps, hold pauses then resets", () => {
  const t = make("stopwatch", { lapMode: true }, 0);
  sw.press("c", t, 0); // start
  sw.press("c", t, 61200); // lap 1
  sw.press("c", t, 125800); // lap 2
  assert.deepEqual(sw.lapTimes(t), [61200, 64600]);

  const shown = view(t, 126000);
  assert.equal(shown.label, "Lap 2");
  assert.equal(shown.main, "1:04.6");
  assert.equal(shown.sub, "2:06");

  const live = view(t, 140000);
  assert.equal(live.label, "Lap 3");
  assert.equal(live.main, "0:14");
  assert.equal(live.sub, "2:20");

  sw.hold("c", t, 140000);
  assert.equal(t.sw.running, false, "first hold pauses");
  sw.hold("c", t, 141000);
  assert.deepEqual(t.sw.laps, [], "second hold resets");
});

test("lap mode: dial scrolls back through laps", () => {
  const t = make("stopwatch", { lapMode: true, swLaps: [10000, 25000, 31000], swAccum: 40000 }, 0);
  sw.rotate("c", t, -1);
  assert.equal(view(t, Date.now()).label, "Lap 3/3");
  sw.rotate("c", t, -1);
  assert.equal(view(t, Date.now()).label, "Lap 2/3");
  assert.equal(view(t, Date.now()).main, "0:15.0");
  sw.rotate("c", t, -10);
  assert.equal(view(t, Date.now()).label, "Lap 1/3");
});

test("keeps at most 99 laps", () => {
  const laps = Array.from({ length: 120 }, (_, i) => (i + 1) * 1000);
  const t = make("stopwatch", { lapMode: true, swLaps: laps });
  assert.equal(t.sw.laps.length, 99);
});
