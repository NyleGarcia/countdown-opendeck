const test = require("node:test");
const assert = require("node:assert/strict");
const { plugin, make, view, localIso } = require("./helpers");

const deadline = plugin.KINDS.deadline;
const NOW = new Date(2026, 8, 28, 12, 0, 0).getTime();

test("unset target shows dashes and a prompt", () => {
  const t = make("deadline", { mode: "date" }, NOW);
  const v = view(t, NOW);
  assert.equal(v.main, "--:--");
  assert.equal(v.label, "Set a date");
});

test("date mode counts down, with days past 24 hours", () => {
  const target = new Date(NOW + (2 * 86400 + 3 * 3600) * 1000);
  const t = make("deadline", { mode: "date", target: localIso(target) }, NOW);
  assert.deepEqual([view(t, NOW).main, view(t, NOW).sub], ["2d", "03:00"]);
  assert.equal(view(t, target.getTime() - 90000).main, "1:30");
});

test("reaching the target rings once", () => {
  const t = make("deadline", { mode: "date", target: localIso(new Date(NOW + 5000)) }, NOW);
  deadline.tick("c", t, NOW + 4000);
  assert.equal(t.ringing, false);
  deadline.tick("c", t, NOW + 5000);
  assert.equal(t.ringing, true);
  plugin.dismiss("c", t, NOW + 6000);
  deadline.tick("c", t, NOW + 7000);
  assert.equal(t.ringing, false, "does not ring again");
});

test("a target that passed while OpenDeck was off never rings late", () => {
  const t = make("deadline", { mode: "date", target: localIso(new Date(NOW - 60000)), overtime: true }, NOW);
  deadline.tick("c", t, NOW + 1000);
  assert.equal(t.ringing, false);
  assert.equal(view(t, NOW).main, "+1:00");
});

test("without overtime a passed target just shows zero", () => {
  const t = make("deadline", { mode: "date", target: localIso(new Date(NOW - 60000)), overtime: false }, NOW);
  assert.equal(view(t, NOW).main, "0:00");
});

test("daily mode targets the next occurrence and rolls over after ringing", () => {
  const t = make("deadline", { mode: "daily", time: "17:00:00" }, NOW);
  assert.equal(view(t, NOW).main, "5:00:00");
  const five = new Date(2026, 8, 28, 17, 0, 0).getTime();
  deadline.tick("c", t, five);
  assert.equal(t.ringing, true);
  plugin.dismiss("c", t, five + 1000);
  assert.equal(view(t, five + 1000).main, "23:59:59", "now counting to tomorrow");

  const late = make("deadline", { mode: "daily", time: "09:00" }, NOW);
  assert.equal(view(late, NOW).main, "21:00:00", "already past today -> tomorrow");
});

test("tapping peeks at the target in the label", () => {
  const t = make("deadline", { mode: "date", target: localIso(new Date(NOW + 3600000)), label: "Launch" }, NOW);
  deadline.press("c", t, NOW);
  assert.equal(view(t, NOW + 1000).label, "Mon 13:00");
  assert.equal(view(t, NOW + 5000).label, "Launch");
});

test("ring colour follows absolute time left", () => {
  const t = make("deadline", { mode: "date", target: localIso(new Date(NOW + 2 * 3600000)) }, NOW);
  assert.equal(view(t, NOW).arc, "#3ddc84");
  assert.equal(view(t, NOW + 3600000 + 1000).arc, "#ffb020");
  assert.equal(view(t, NOW + 2 * 3600000 - 60000).arc, "#ff4d4d");
});
