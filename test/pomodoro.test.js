const test = require("node:test");
const assert = require("node:assert/strict");
const { plugin, make, view } = require("./helpers");

const pomo = plugin.KINDS.pomodoro;
const S = { work: 60, shortBreak: 10, longBreak: 30, rounds: 2 };

test("phases run focus, break, focus, long break, then back to focus 1", () => {
  const t = make("pomodoro", S, 0);
  const seen = [];
  for (let i = 0; i < 5; i++) {
    seen.push(`${view(t, 0).label} ${view(t, 0).main}`);
    pomo.touch("c", t, 0); // skip
  }
  assert.deepEqual(seen, ["Focus 1/2 1:00", "Break 0:10", "Focus 2/2 1:00", "Long break 0:30", "Focus 1/2 1:00"]);
});

test("the end of a phase rings; tapping starts the next phase", () => {
  const t = make("pomodoro", S, 0);
  pomo.press("c", t, 0);
  pomo.tick("c", t, 60000);
  assert.equal(t.ringing, true);
  assert.match(t.message.body, /^Focus 1 done\./);
  plugin.dismiss("c", t, 61000);
  assert.equal(view(t, 61000).label, "Break");
  assert.equal(t.running, true);
  assert.equal(view(t, 66000).main, "0:05");
});

test("auto-start flows into the next phase without ringing", () => {
  const t = make("pomodoro", { ...S, autoStart: true }, 0);
  pomo.press("c", t, 0);
  pomo.tick("c", t, 60000);
  assert.equal(t.ringing, false);
  assert.equal(view(t, 60000).label, "Break");
  assert.equal(t.running, true);
});

test("hold restarts the whole cycle", () => {
  const t = make("pomodoro", S, 0);
  pomo.touch("c", t, 0);
  pomo.touch("c", t, 0);
  assert.equal(view(t, 0).label, "Focus 2/2");
  pomo.hold("c", t, 0);
  assert.equal(view(t, 0).label, "Focus 1/2");
});

test("new lengths apply to an untouched phase straight away", () => {
  const t = make("pomodoro", S, 0);
  pomo.apply(t, { ...S, work: 120, sound: false, notify: false }, 0);
  assert.equal(view(t, 0).main, "2:00");
});

test("messages name the next break", () => {
  const t = make("pomodoro", { work: 1500, shortBreak: 300, longBreak: 900, rounds: 4 }, 0);
  assert.equal(pomo.message(t).body, "Focus 1 done. Take a 5 min break.");
  t.round = 4;
  assert.equal(pomo.message(t).body, "Focus 4 done. Take a 15 min long break.");
});
