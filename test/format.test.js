const test = require("node:test");
const assert = require("node:assert/strict");
const { plugin } = require("./helpers");

const { fmt, span, clock, tenths, lapColor, describeTarget } = plugin;

test("clock pads minutes and seconds, adds hours only when needed", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(65), "1:05");
  assert.equal(clock(3600), "1:00:00");
  assert.equal(clock(3725), "1:02:05");
});

test("fmt rounds a countdown up so 0:00 only shows at the true end", () => {
  assert.equal(fmt(1), "0:01");
  assert.equal(fmt(999), "0:01");
  assert.equal(fmt(1000), "0:01");
  assert.equal(fmt(1001), "0:02");
  assert.equal(fmt(0), "0:00");
});

test("fmt shows overtime with a plus sign, rounding down", () => {
  assert.equal(fmt(-1), "+0:00");
  assert.equal(fmt(-12500), "+0:12");
  assert.equal(fmt(-3600000), "+1:00:00");
});

test("span switches to days over hours:minutes past one day", () => {
  assert.deepEqual(span(86399000), { main: "23:59:59", sub: "" });
  const threeDays = (3 * 86400 + 5 * 3600 + 30 * 60) * 1000;
  assert.deepEqual(span(threeDays), { main: "3d", sub: "05:30" });
  assert.deepEqual(span(-threeDays), { main: "+3d", sub: "05:30" });
});

test("tenths shows a decimal under an hour, plain clock above", () => {
  assert.equal(tenths(61234), "1:01.2");
  assert.equal(tenths(999), "0:00.9");
  assert.equal(tenths(3600000), "1:00:00");
});

test("lapColor marks fastest green and slowest amber once there are two laps", () => {
  assert.equal(lapColor([5000], 0), "#3ba7f0");
  const laps = [5000, 4000, 6000];
  assert.equal(lapColor(laps, 1), "#3ddc84");
  assert.equal(lapColor(laps, 2), "#ffb020");
  assert.equal(lapColor(laps, 0), "#3ba7f0");
});

test("describeTarget names the weekday within six days, else the date", () => {
  const now = new Date(2026, 8, 28, 12, 0).getTime(); // Mon 28 Sep 2026
  assert.equal(describeTarget(new Date(2026, 8, 29, 17, 5).getTime(), now), "Tue 17:05");
  assert.equal(describeTarget(new Date(2026, 9, 20, 9, 0).getTime(), now), "Oct 20");
  assert.equal(describeTarget(new Date(2027, 0, 1, 0, 0).getTime(), now), "Jan 1 2027");
});
