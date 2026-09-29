const test = require("node:test");
const assert = require("node:assert/strict");
const { plugin, make, view, svg } = require("./helpers");

test("key image is an SVG data URI carrying the shown time", () => {
  const t = make("timer", { minutes: 25, label: "Tea & <b>" });
  const uri = plugin.keyImage(view(t), t);
  assert.match(uri, /^data:image\/svg\+xml;base64,/);
  const doc = svg(uri);
  assert.match(doc, /data-time="25:00"/);
  assert.match(doc, /width="144" height="144"/);
  assert.match(doc, />Tea &amp; &lt;b&gt;</, "label is escaped");
});

test("strip image is 200x100", () => {
  const t = make("stopwatch", {});
  assert.match(svg(plugin.stripImage(view(t), t)), /width="200" height="100"/);
});

test("ringing with flash alternates the background", () => {
  const t = make("timer", { minutes: 0, seconds: 1, flash: true });
  t.ringing = true;
  t.flashOn = true;
  assert.match(svg(plugin.keyImage(view(t), t)), /#c4001f/);
  t.flashOn = false;
  assert.doesNotMatch(svg(plugin.keyImage(view(t), t)), /#c4001f/);
});

test("every glyph used by the formats renders", () => {
  for (const s of ["0123456789", "+12d 03:59", "--:--", "1:04.5"]) {
    const t = make("timer", {});
    const v = { ...view(t), main: s };
    assert.doesNotThrow(() => plugin.keyImage(v, t));
  }
});
