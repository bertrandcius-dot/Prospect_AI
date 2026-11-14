/*! ProspectAI device SDK v1.1 — consent-first keyword capture for websites, PWAs and hybrid apps.
 *
 * <script src="https://YOUR-SERVER/sdk.js"></script>
 * <script>
 *   const p = ProspectSDK.init({ server: "https://YOUR-SERVER", appKey: "optional", appName: "My App" });
 *   // Call from a button the person taps ("Let ProspectAI personalize offers near me"):
 *   await p.connect({ voice: true, text: true, location: true });
 *   p.trackText("looking for pizza near me");         // any text your app sees with consent: searches, chat, notes
 *   p.startVoice();                                    // speech -> text in the browser, keywords only leave the device
 *   p.on("match", m => console.log("matched", m));
 *   await p.disconnect();                              // opt out: stops tracking and erases the device on the server
 * </script>
 *
 * Works in any browser or WebView. Native apps call the same REST API (see docs/device-sdk.md).
 * Nothing is captured before connect(), and the person can stop at any time.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ProspectSDK = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var KEY = "prospect_sdk_device";

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function save(v) { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) {} }

  function init(opts) {
    if (!opts || !opts.server) throw new Error("ProspectSDK.init needs { server }");
    var server = String(opts.server).replace(/\/$/, "");
    var state = { device: load(), watchId: null, recog: null, voiceOn: false, lastLoc: null, queue: [], timer: null };
    var handlers = {};
    function emit(t, d) { (handlers[t] || []).forEach(function (f) { try { f(d); } catch (e) {} }); }

    function req(method, path, body) {
      var h = { "Content-Type": "application/json" };
      if (opts.appKey) h["X-App-Key"] = opts.appKey;
      if (state.device) h["X-Device-Token"] = state.device.token;
      return fetch(server + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, keepalive: true })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ("HTTP " + r.status)); return j; }); });
    }

    // Events are batched every 2 s so a chatty app does not flood the network.
    function send(ev) {
      if (!state.device) return Promise.reject(new Error("Call connect() first"));
      if (state.lastLoc && ev.lat == null) { ev.lat = state.lastLoc.lat; ev.lng = state.lastLoc.lng; ev.accuracy = state.lastLoc.accuracy; }
      state.queue.push(ev);
      if (!state.timer) state.timer = setTimeout(flush, 2000);
      return Promise.resolve();
    }
    function flush() {
      state.timer = null;
      var batch = state.queue.splice(0, 100);
      if (!batch.length || !state.device) return;
      req("POST", "/api/devices/" + state.device.id + "/events", { events: batch }).then(function (r) {
        (r.results || []).forEach(function (x) { (x.matches || []).forEach(function (m) { emit("match", m); }); if (x.insideFence != null) emit("fence", { inside: x.insideFence }); });
      }).catch(function (e) { emit("error", e); });
    }

    var api = {
      on: function (t, f) { (handlers[t] = handlers[t] || []).push(f); return api; },
      get connected() { return !!state.device; },

      connect: function (want) {
        want = want || { voice: true, text: true, location: true };
        var channels = ["voice", "text", "location", "app"].filter(function (c) { return want[c] !== false && (c !== "app" || want.app); });
        var p = state.device ? Promise.resolve(state.device) : req("POST", "/api/devices", {
          consent: true, name: opts.deviceName || (navigator.userAgentData && navigator.userAgentData.platform) || "Browser", platform: opts.platform || "web", app: opts.appName || location.hostname, channels: channels
        }).then(function (r) { state.device = { id: r.device.id, token: r.token }; save(state.device); return state.device; });
        return p.then(function () { if (want.location !== false) api.startLocation(); emit("connected", state.device.id); return state.device.id; });
      },

      disconnect: function () {
        api.stopVoice(); api.stopLocation();
        var d = state.device; state.device = null; save(null);
        return d ? req("DELETE", "/api/devices/" + d.id).catch(function () {}) : Promise.resolve();
      },

      trackText: function (text, meta) { if (text && String(text).trim()) return send({ type: (meta && meta.app) ? "app" : "text", text: String(text).slice(0, 2000) }); return Promise.resolve(); },
      trackLocation: function (lat, lng, accuracy) { state.lastLoc = { lat: lat, lng: lng, accuracy: accuracy }; return send({ type: "location", lat: lat, lng: lng, accuracy: accuracy }); },

      startLocation: function () {
        if (!("geolocation" in navigator) || state.watchId != null) return false;
        var lastSent = 0;
        state.watchId = navigator.geolocation.watchPosition(function (pos) {
          var c = pos.coords; state.lastLoc = { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy };
          if (Date.now() - lastSent > 30000) { lastSent = Date.now(); send({ type: "location", lat: c.latitude, lng: c.longitude, accuracy: c.accuracy }); }
          emit("location", state.lastLoc);
        }, function (e) { emit("error", e); }, { enableHighAccuracy: true, maximumAge: 15000 });
        return true;
      },
      stopLocation: function () { if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId); state.watchId = null; },

      // On-device speech recognition. Audio stays in the browser; only the transcript text is scanned.
      startVoice: function (lang) {
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { emit("error", new Error("Speech recognition is not available in this browser")); return false; }
        if (state.recog) return true;
        var r = new SR(); r.continuous = true; r.interimResults = false; r.lang = lang || navigator.language || "en-US";
        r.onresult = function (e) { for (var i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) { var t = e.results[i][0].transcript; emit("transcript", t); send({ type: "voice", text: t }); } };
        r.onend = function () { if (state.voiceOn) try { r.start(); } catch (e) {} };
        state.recog = r; state.voiceOn = true; r.start(); return true;
      },
      stopVoice: function () { state.voiceOn = false; if (state.recog) try { state.recog.stop(); } catch (e) {} state.recog = null; },
      flush: flush
    };
    return api;
  }
  return { init: init, version: "1.1.0" };
});
