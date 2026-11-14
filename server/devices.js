// Devices and apps that report keyword signals: phones (voice, text, location), websites, and other apps.
// Consent first: a device must register with consent, gets its own token, and can opt out (erasing it) at any time.
// Raw voice audio never reaches the server. Transcripts and text are scanned for keywords in memory and dropped;
// only the matched keyword, the source and a rounded location are kept.
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { extractKeywords } from "./keywords.js";
import { milesBetween } from "./agent.js";

const hashToken = t => createHash("sha256").update(t).digest("hex");
const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d; // ~11 m precision

export function createDevices({ store, bus, agent }) {
  const devices = store.devices || (store.devices = new Map());

  function publicView(d) {
    const { tokenHash, ...rest } = d;
    return rest;
  }

  function register({ name = "Unnamed device", platform = "web", app = "", consent, channels = ["voice", "text", "location"] }) {
    if (consent !== true) throw Object.assign(new Error("consent must be true. Ask the person first and send consent: true."), { status: 400 });
    const allowed = ["voice", "text", "location", "app"];
    const token = "dev_" + randomBytes(24).toString("hex");
    const d = {
      id: "d_" + randomUUID().slice(0, 12), name: String(name).slice(0, 60), platform: String(platform).slice(0, 20), app: String(app).slice(0, 60),
      channels: channels.filter(c => allowed.includes(c)), consentAt: new Date().toISOString(), lastSeen: null, location: null,
      insideFence: false, counts: { voice: 0, text: 0, location: 0, app: 0, matches: 0 }, tokenHash: hashToken(token)
    };
    devices.set(d.id, d); store.save?.();
    bus.publish("device", { action: "registered", device: publicView(d) });
    return { device: publicView(d), token };
  }

  function auth(id, token) {
    const d = devices.get(id);
    if (!d) throw Object.assign(new Error("Device not found. Register it again."), { status: 404 });
    if (!token || hashToken(token) !== d.tokenHash) throw Object.assign(new Error("Wrong or missing device token (X-Device-Token)."), { status: 401 });
    return d;
  }

  async function event(id, token, ev) {
    const d = auth(id, token);
    const type = ev.type;
    if (!["voice", "text", "location", "app"].includes(type)) throw Object.assign(new Error("type must be voice, text, location or app"), { status: 400 });
    if (!d.channels.includes(type)) throw Object.assign(new Error(`This device did not consent to ${type} tracking.`), { status: 403 });
    d.lastSeen = new Date().toISOString();
    d.counts[type]++;

    if (Number.isFinite(+ev.lat) && Number.isFinite(+ev.lng)) {
      d.location = { lat: round(+ev.lat), lng: round(+ev.lng), accuracy: ev.accuracy ? Math.round(+ev.accuracy) : null, at: d.lastSeen };
      const cfg = store.getConfig();
      const was = d.insideFence;
      d.insideFence = cfg.fences.some(f => milesBetween(f, d.location) <= f.radiusMi);
      if (was !== d.insideFence) bus.publish("geofence", { deviceId: d.id, name: d.name, entered: d.insideFence, lat: d.location.lat, lng: d.location.lng });
    }

    let matches = [];
    if (type !== "location") {
      if (!d.location) { store.save?.(); return { matches: [], note: "No location yet. Send a location event so signals can be placed on the map." }; }
      const cfg = store.getConfig();
      matches = extractKeywords(String(ev.text || "").slice(0, 2000), cfg.keywords);
      const source = type === "voice" ? "voice" : type === "app" ? "app" : "text";
      for (const m of matches) {
        d.counts.matches++;
        await agent.ingest({ keyword: m.term, lat: d.location.lat, lng: d.location.lng, source, deviceId: d.id, confidence: m.score });
      }
    }
    store.save?.();
    bus.publish("device", { action: "event", device: publicView(d), type, matched: matches.map(m => m.term) });
    return { matches, insideFence: d.insideFence };
  }

  function optOut(id, token) {
    auth(id, token);
    devices.delete(id); store.save?.();
    bus.publish("device", { action: "opted_out", deviceId: id });
    return { deleted: true };
  }

  return { register, event, optOut, list: () => [...devices.values()].map(publicView), remove: id => { const ok = devices.delete(id); store.save?.(); return ok; } };
}
