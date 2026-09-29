// Connection to OpenDeck, shared by every settings panel in this plugin.
//
// Supports both conventions OpenDeck ships: the Elgato global function and OpenDeck's
// openDeckConnection promise. Settings go out on the ACTION context
// (actionInfo.context), not the inspector's own uuid.
//
// Usage: PI.init(defaults, onSettings); PI.save(patch); PI.send(payload); PI.settings;
//        PI.onMessage(fn) for sendToPropertyInspector payloads; PI.onConnect(fn).
(function () {
  let socket = null, context = null, settings = {}, defaults = {}, onSettings = () => {};
  const messageFns = [], connectFns = [];

  function current() { return Object.assign({}, defaults, settings); }

  function start(port, uuid, registerEvent, _info, actionInfo) {
    const info = typeof actionInfo === "string" ? JSON.parse(actionInfo) : actionInfo;
    context = info.context;
    settings = (info.payload && info.payload.settings) || {};
    onSettings(current());
    socket = new WebSocket("ws://127.0.0.1:" + port);
    socket.onopen = () => {
      socket.send(JSON.stringify({ event: registerEvent, uuid }));
      connectFns.forEach((fn) => fn());
    };
    socket.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (msg.event === "didReceiveSettings") {
        settings = (msg.payload && msg.payload.settings) || {};
        onSettings(current());
      } else if (msg.event === "sendToPropertyInspector") {
        messageFns.forEach((fn) => fn(msg.payload || {}));
      }
    };
  }

  window.PI = {
    init(d, fn) { defaults = d; onSettings = fn; fn(current()); },
    onMessage(fn) { messageFns.push(fn); },
    onConnect(fn) { connectFns.push(fn); if (socket && socket.readyState === 1) fn(); },
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
