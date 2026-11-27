// Connection to OpenDeck, shared by every settings panel in this plugin.
//
// Supports both conventions OpenDeck ships: the Elgato global function and OpenDeck's
// openDeckConnection promise. Settings go out on the ACTION context
// (actionInfo.context), not the inspector's own uuid.
//
// Usage: PI.init(defaults, onSettings); PI.save(patch); PI.send(payload); PI.settings;
//        PI.onMessage(fn) for sendToPropertyInspector payloads; PI.onConnect(fn).
//
// Words: the English in each page stands in until the plugin answers with OpenDeck's
// language. Mark an element with a data-i18n key (its other data-* attributes fill
// {placeholders}), an input with a data-i18n-placeholder key, and build text in a script
// with PI.t(key, fallback, values); PI.onStrings(fn) runs when the words arrive.
(function () {
  let socket = null, context = null, settings = {}, defaults = {}, onSettings = () => {};
  let strings = {}, answered = false;
  const messageFns = [], connectFns = [], stringFns = [];

  function current() { return Object.assign({}, defaults, settings); }

  // Plain {word} fields only, and always set as text, never as markup.
  function fillIn(text, values) {
    return text.replace(/\{([a-z_]+)\}/g, (whole, name) =>
      (values && values[name] !== undefined ? String(values[name]) : whole));
  }

  function translate(payload) {
    if (!payload.strings || typeof payload.strings !== "object") return;
    answered = true;
    strings = payload.strings;
    if (typeof payload.language === "string") document.documentElement.lang = payload.language.replace("_", "-");
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const text = strings[node.dataset.i18n];
      if (typeof text === "string") node.textContent = fillIn(text, node.dataset);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
      const text = strings[node.dataset.i18nPlaceholder];
      if (typeof text === "string") node.placeholder = text;
    });
    stringFns.forEach((fn) => fn());
  }

  function askForStrings() {
    PI.send({ command: "strings" });
    // One ask can be lost if the plugin is still starting; repeat until it answers.
    let tries = 0;
    const retry = setInterval(() => {
      if (answered || ++tries > 6) { clearInterval(retry); return; }
      PI.send({ command: "strings" });
    }, 600);
  }

  function start(port, uuid, registerEvent, _info, actionInfo) {
    const info = typeof actionInfo === "string" ? JSON.parse(actionInfo) : actionInfo;
    context = info.context;
    settings = (info.payload && info.payload.settings) || {};
    onSettings(current());
    socket = new WebSocket("ws://127.0.0.1:" + port);
    socket.onopen = () => {
      socket.send(JSON.stringify({ event: registerEvent, uuid }));
      askForStrings();
      connectFns.forEach((fn) => fn());
    };
    socket.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (msg.event === "didReceiveSettings") {
        settings = (msg.payload && msg.payload.settings) || {};
        onSettings(current());
      } else if (msg.event === "sendToPropertyInspector") {
        translate(msg.payload || {});
        messageFns.forEach((fn) => fn(msg.payload || {}));
      }
    };
  }

  window.PI = {
    init(d, fn) { defaults = d; onSettings = fn; fn(current()); },
    onMessage(fn) { messageFns.push(fn); },
    onConnect(fn) { connectFns.push(fn); if (socket && socket.readyState === 1) fn(); },
    onStrings(fn) { stringFns.push(fn); },
    // The translated string, or `fallback` (English) while none has arrived.
    t(key, fallback, values) {
      return fillIn(typeof strings[key] === "string" ? strings[key] : fallback, values);
    },
    get settings() { return current(); },
    save(patch) {
      settings = Object.assign(current(), patch);
      if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify({ event: "setSettings", context, payload: settings }));
      }
    },
    send(payload) {
      if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify({ event: "sendToPlugin", context, payload }));
      }
    },
    // Wire the standard alarm controls (checkboxes, sound file, test button) if present.
    bindAlarm() {
      const $ = (id) => document.getElementById(id);
      ["flash", "sound", "repeatSound", "overtime", "notify"].forEach((k) => {
        if ($(k)) $(k).addEventListener("change", () => PI.save({ [k]: $(k).checked }));
      });
      if ($("snooze")) $("snooze").addEventListener("change", () => PI.save({ snooze: Number($("snooze").value) }));
      if ($("testNotify")) $("testNotify").addEventListener("click", () => PI.send({ command: "testNotify" }));
      if ($("soundFile")) $("soundFile").addEventListener("change", () => PI.save({ soundFile: $("soundFile").value.trim() }));
      if ($("test")) $("test").addEventListener("click", () => PI.send({ command: "testSound" }));
      if ($("label")) $("label").addEventListener("change", () => PI.save({ label: $("label").value }));
    },
    fillAlarm(s) {
      const $ = (id) => document.getElementById(id);
      ["flash", "sound", "repeatSound", "overtime", "notify"].forEach((k) => { if ($(k)) $(k).checked = !!s[k]; });
      if ($("snooze")) $("snooze").value = String(s.snooze);
      if ($("soundFile")) $("soundFile").value = s.soundFile || "";
      if ($("label")) $("label").value = s.label || "";
    },
  };

  window.connectElgatoStreamDeckSocket = start;
  window.connectSocket = start;
  if (window.openDeckConnection && window.openDeckConnection.then) {
    window.openDeckConnection.then((a) => start.apply(null, a));
  }
})();
