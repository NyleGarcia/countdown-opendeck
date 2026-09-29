const test = require("node:test");
const assert = require("node:assert/strict");
const { plugin, make, view } = require("./helpers");

const timer = plugin.KINDS.timer;

function ringing(settings) {
  const t = make("timer", { minutes: 0, seconds: 5, ...settings }, 0);
  timer.press("c", t, 0);
  timer.tick("c", t, 5000);
  return t;
}

test("snooze silences, shows a countdown, and is alerting", () => {
  const t = ringing({ snooze: 60 });
  assert.equal(plugin.snooze("c", t, 6000), true);
  assert.equal(t.ringing, false);
  assert.equal(plugin.alerting(t), true);
  const v = view(t, 36000);
  assert.equal(v.label, "Snoozed");
  assert.equal(v.main, "0:30");
  assert.equal(v.arc, "#b58cff");
});

test("snooze off returns false so the caller dismisses", () => {
  const t = ringing({ snooze: 0 });
  assert.equal(plugin.snooze("c", t, 6000), false);
});

test("dismiss clears snooze and resets the timer", () => {
  const t = ringing({ snooze: 60 });
  plugin.snooze("c", t, 6000);
  plugin.dismiss("c", t, 7000);
  assert.equal(plugin.alerting(t), false);
  assert.equal(view(t, 7000).main, "0:05");
});

test("key input routes through the alarm while ringing", () => {
  plugin.outbox.length = 0;
  plugin.handle({ event: "willAppear", action: "dev.countdown.timer", context: "route",
    payload: { settings: { minutes: 0, seconds: 1, sound: false, notify: false, snooze: 60 } } });
  const t = plugin.instances.get("route");
  timer.press("route", t, Date.now());
  timer.tick("route", t, Date.now() + 2000);
  assert.equal(t.ringing, true);
  plugin.handle({ event: "touchTap", action: "dev.countdown.timer", context: "route", payload: {} });
  assert.equal(t.snoozeUntil > 0, true, "touch snoozes");
  plugin.handle({ event: "dialDown", action: "dev.countdown.timer", context: "route", payload: {} });
  assert.equal(plugin.alerting(t), false, "press dismisses");
});
