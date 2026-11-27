// Translations: which file a language code picks, that the files agree with each other
// and with the manifest, and that every key the code asks for exists in English.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { plugin, make, view } = require("./helpers");

const PLUGIN_DIR = path.join(__dirname, "..", "systems.garcia.countdown.sdPlugin");
const read = (name) => fs.readFileSync(path.join(PLUGIN_DIR, name), "utf8");
const json = (name) => JSON.parse(read(name));

const manifest = json("manifest.json");
const files = Object.fromEntries(plugin.languages().map((code) => [code, json(`${code}.json`)]));
const english = files.en.Localization;

// The only thing a translation may put in braces: a plain lower-case {word}.
const PLACEHOLDER = /\{[a-z_]+\}/g;
const placeholders = (text) => (text.match(PLACEHOLDER) || []).sort();

test.afterEach(() => plugin.setLanguage("en"));

// ---------- picking a language ----------

test("English and French ship", () => {
  assert.deepEqual(plugin.languages(), ["en", "fr"]);
});

test("every spelling of French picks French", () => {
  for (const code of ["fr", "fr_FR", "fr-FR", "fr_FR.UTF-8", "FR", "fr_CA", "fr_FR@euro"]) {
    assert.equal(plugin.resolveLanguage(code), "fr", code);
  }
});

test("an unknown or missing language is English", () => {
  for (const code of ["xx", "", null, undefined, "C.UTF-8", "POSIX", "../fr", "manifest"]) {
    assert.equal(plugin.resolveLanguage(code), "en", String(code));
  }
});

test("the language comes from OpenDeck's -info, then the environment", () => {
  const info = JSON.stringify({ application: { language: "fr" } });
  assert.equal(plugin.openDeckLanguage(info, { LANG: "de_DE.UTF-8" }), "fr");
  assert.equal(plugin.openDeckLanguage("not json", { LANG: "fr_FR.UTF-8" }), "fr_FR.UTF-8");
  assert.equal(plugin.openDeckLanguage("{}", { LC_ALL: "fr_FR.UTF-8", LANG: "en_US.UTF-8" }), "fr_FR.UTF-8");
  assert.equal(plugin.openDeckLanguage(undefined, {}), "");
});

// ---------- looking strings up ----------

test("strings follow the language", () => {
  assert.equal(plugin.setLanguage("fr"), "fr");
  assert.equal(plugin.tr("key.pomodoro.break"), "Pause");
  plugin.setLanguage("en");
  assert.equal(plugin.tr("key.pomodoro.break"), "Break");
});

test("placeholders are filled, and only plain {word} ones", () => {
  plugin.setLanguage("fr");
  assert.equal(plugin.tr("key.stopwatch.lap_of", { lap: 2, count: 3 }), "Tour 2/3");
  // A value is text, not a template: braces in it are not expanded again.
  assert.equal(plugin.tr("key.stopwatch.lap", { lap: "{count}", count: 9 }), "Tour {count}");
  // A value that was not given leaves its field as written.
  assert.equal(plugin.tr("key.stopwatch.lap_of", { lap: 1 }), "Tour 1/{count}");
});

test("a missing key shows itself", () => {
  assert.equal(plugin.tr("no.such.key"), "no.such.key");
  assert.equal(plugin.tr("constructor"), "constructor");
});

test("the settings panels are sent only their own strings, in the language", () => {
  plugin.setLanguage("fr");
  const table = plugin.table("pi.");
  assert.equal(table["pi.stopwatch.laps"], "Tours");
  assert.deepEqual(Object.keys(table).filter((key) => !key.startsWith("pi.")), []);
  assert.equal(Object.keys(table).length, Object.keys(english).filter((key) => key.startsWith("pi.")).length);
});

test("a settings panel asking for its strings gets them", () => {
  plugin.setLanguage("fr");
  plugin.outbox.length = 0;
  plugin.handle({ event: "sendToPlugin", context: "pi-ctx", action: "systems.garcia.countdown.timer",
    payload: { command: "strings" } });
  const reply = plugin.outbox.find((m) => m.event === "sendToPropertyInspector");
  assert.equal(reply.context, "pi-ctx");
  assert.equal(reply.payload.language, "fr");
  assert.equal(reply.payload.strings["pi.timer.duration"], "Durée");
});

// ---------- on the keys ----------

test("the keys are drawn in the language", () => {
  plugin.setLanguage("fr");
  const pomo = make("pomodoro", { rounds: 4 }, 0);
  assert.equal(view(pomo, 0).label, "Travail 1/4");
  const unset = make("deadline", { mode: "daily" }, 0);
  assert.equal(view(unset, 0).label, "Choisir heure");
  assert.equal(plugin.span(12 * 86400000 + 3600000).main, "12j");
  const jan5 = new Date(2031, 0, 5, 13, 0).getTime();
  assert.equal(plugin.describeTarget(jan5, jan5 - 86400000), `${plugin.tr(`key.weekday.${new Date(jan5).getDay()}`)} 13:00`);
  assert.equal(plugin.describeTarget(jan5, new Date(2030, 5, 1).getTime()), "5 janv. 2031");
  assert.equal(plugin.describeTarget(jan5, new Date(2031, 0, 20).getTime()), "5 janv.");
});

test("notifications are written in the language", () => {
  plugin.setLanguage("fr");
  const pomo = make("pomodoro", { work: 1500, shortBreak: 300, longBreak: 900, rounds: 4 }, 0);
  assert.equal(plugin.KINDS.pomodoro.message(pomo).body, "Session 1 terminée. Prenez une pause de 5 min.");
});

test("every language's day unit has a seven-segment glyph", () => {
  for (const [code, data] of Object.entries(files)) {
    const unit = data.Localization["key.deadline.day_unit"];
    assert.match(unit, /^[a-z]$/, `${code}.json: key.deadline.day_unit must be one letter`);
    assert.ok(Object.hasOwn(plugin.SEGMENTS, unit), `${code}.json: no glyph for day unit "${unit}"`);
  }
});

// ---------- the files ----------

test("en.json says what the manifest says", () => {
  assert.equal(files.en.Name, manifest.Name);
  assert.equal(files.en.Description, manifest.Description);
  for (const action of manifest.Actions) {
    assert.deepEqual(files.en[action.UUID], { Name: action.Name, Tooltip: action.Tooltip }, action.UUID);
  }
});

test("every language names the plugin and each action", () => {
  for (const [code, data] of Object.entries(files)) {
    for (const field of ["Name", "Description"]) {
      assert.ok(typeof data[field] === "string" && data[field], `${code}.json: ${field}`);
    }
    for (const { UUID } of manifest.Actions) {
      const entry = data[UUID] || {};
      assert.ok(typeof entry.Name === "string" && entry.Name, `${code}.json: ${UUID} needs a Name`);
      assert.ok(typeof entry.Tooltip === "string" && entry.Tooltip, `${code}.json: ${UUID} needs a Tooltip`);
    }
    const known = new Set(["Name", "Description", "Localization", ...manifest.Actions.map((a) => a.UUID)]);
    assert.deepEqual(Object.keys(data).filter((key) => !known.has(key)), [], `${code}.json: unknown top-level keys`);
  }
});

test("every language has exactly the English keys, as non-empty strings", () => {
  for (const [code, data] of Object.entries(files)) {
    assert.deepEqual(Object.keys(data.Localization).sort(), Object.keys(english).sort(), `${code}.json`);
    for (const [key, value] of Object.entries(data.Localization)) {
      assert.ok(typeof value === "string" && value.trim(), `${code}.json: ${key} is empty or not a string`);
    }
  }
});

test("every language keeps the English placeholders, and nothing else in braces", () => {
  for (const [code, data] of Object.entries(files)) {
    for (const [key, value] of Object.entries(data.Localization)) {
      assert.deepEqual(placeholders(value), placeholders(english[key]), `${code}.json: ${key} has different placeholders`);
      assert.doesNotMatch(value.replace(PLACEHOLDER, ""), /[{}]/, `${code}.json: ${key} has a stray brace`);
    }
  }
});

// ---------- every key the code asks for exists ----------

function missing(names, pattern) {
  const out = [];
  for (const name of names) {
    for (const m of read(name).matchAll(pattern)) {
      if (typeof english[m[1]] !== "string") out.push(`${name}: ${m[1]}`);
    }
  }
  return out;
}

const PI_FILES = fs.readdirSync(path.join(PLUGIN_DIR, "pi")).map((name) => `pi/${name}`);

test("every key plugin.js asks for exists", () => {
  const literal = /\btr\(\s*"([^"]+)"/g;
  assert.ok([...read("plugin.js").matchAll(literal)].length > 10, "found the plugin's tr() calls");
  assert.deepEqual(missing(["plugin.js"], literal), []);
  // Keys that are chosen or built at run time.
  const chosen = /"((?:key|notify)\.[a-z0-9_.]+)"/g;
  assert.deepEqual(missing(["plugin.js"], chosen), []);
  for (let day = 0; day < 7; day++) assert.ok(english[`key.weekday.${day}`], `key.weekday.${day}`);
  for (let month = 0; month < 12; month++) assert.ok(english[`key.month.${month}`], `key.month.${month}`);
});

test("every key the settings panels ask for exists", () => {
  const marked = /data-i18n(?:-placeholder)?="([^"]+)"/g;
  const scripted = /PI\.t\(\s*"([^"]+)"/g;
  assert.ok(PI_FILES.flatMap((name) => [...read(name).matchAll(marked)]).length > 50, "found the marked elements");
  assert.deepEqual(missing(PI_FILES, marked), []);
  assert.deepEqual(missing(PI_FILES, scripted), []);
});

test("every English string is used somewhere", () => {
  const sources = ["plugin.js", ...PI_FILES].map(read).join("\n");
  const unused = Object.keys(english).filter((key) =>
    !sources.includes(`"${key}"`) && !/^key\.(weekday|month)\.\d+$/.test(key));
  assert.deepEqual(unused, []);
});

test("the settings panels never set translated text as markup", () => {
  for (const name of PI_FILES) {
    assert.doesNotMatch(read(name), /innerHTML|insertAdjacentHTML|document\.write/, name);
  }
});

// ---------- the settings panels' shared script, against a stand-in page ----------

function fakePage(nodes) {
  const sockets = [];
  class WebSocket {
    constructor() { this.readyState = 1; this.sent = []; sockets.push(this); }
    send(text) { this.sent.push(JSON.parse(text)); }
  }
  const document = {
    documentElement: { lang: "en" },
    getElementById: () => null,
    querySelectorAll: (selector) => nodes.filter((node) =>
      (selector === "[data-i18n]" ? node.dataset.i18n : node.dataset.i18nPlaceholder) !== undefined),
  };
  const window = { WebSocket, document, setInterval: () => 0, clearInterval() {} };
  window.window = window;
  vm.runInNewContext(read("pi/_shared.js"), window);
  window.connectElgatoStreamDeckSocket(1, "pi-uuid", "registerPropertyInspector", "{}",
    JSON.stringify({ context: "ctx", payload: { settings: {} } }));
  sockets[0].onopen();
  return { window, document, socket: sockets[0] };
}

test("a settings panel asks for its strings and fills them in as text", () => {
  const label = { dataset: { i18n: "pi.timer.duration" }, textContent: "Duration" };
  const option = { dataset: { i18n: "pi.pomodoro.rounds_option", count: "3" }, textContent: "3 focus rounds" };
  const input = { dataset: { i18nPlaceholder: "pi.timer.label_example" }, placeholder: "Tea" };
  const unknown = { dataset: { i18n: "pi.not.sent" }, textContent: "English stays" };
  const { window, document, socket } = fakePage([label, option, input, unknown]);
  assert.deepEqual(socket.sent.map((m) => m.payload && m.payload.command).filter(Boolean), ["strings"]);
  assert.equal(window.PI.t("pi.stopwatch.lap", "Lap {lap}", { lap: 2 }), "Lap 2", "English until the strings arrive");

  let told = 0;
  window.PI.onStrings(() => { told++; });
  plugin.setLanguage("fr");
  const strings = { ...plugin.table("pi."), "pi.timer.duration": "<b>Durée</b>" };
  socket.onmessage({ data: JSON.stringify({ event: "sendToPropertyInspector", payload: { language: "fr", strings } }) });

  assert.equal(label.textContent, "<b>Durée</b>", "set as text, so markup stays inert");
  assert.equal(option.textContent, "3 sessions de travail");
  assert.equal(input.placeholder, "Thé");
  assert.equal(unknown.textContent, "English stays");
  assert.equal(document.documentElement.lang, "fr");
  assert.equal(window.PI.t("pi.stopwatch.lap", "Lap {lap}", { lap: 2 }), "Tour 2");
  assert.equal(told, 1);
});
