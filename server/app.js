// HTTP layer: REST API, Server-Sent Events stream, static dashboard. No framework, no dependencies.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { createBus } from "./bus.js";
import { MemoryStore } from "./store.js";
import { createAgent } from "./agent.js";
import { createIntegrations } from "./integrations.js";
import { createChannels } from "./channels/index.js";
import { GooglePlaces, SimulatedPlaces } from "./providers/places.js";
import { startSimulator } from "./simulator.js";
import { createDevices } from "./devices.js";
import { loadPlugins, wirePlugins } from "./plugins.js";
import { extractKeywords } from "./keywords.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERSION = "1.1.0";
const CONFIG_KEYS = ["location", "fences", "keywords", "sources", "criteria", "threshold", "channels", "mvp", "cycles", "bridge", "templates"];

export function createApp(config, deps = {}) {
  const log = deps.log || console;
  const bus = deps.bus || createBus();
  const store = deps.store || new MemoryStore({ file: config.dataFile });
  const places = deps.places || (config.keys.googleMaps ? new GooglePlaces(config.keys.googleMaps) : new SimulatedPlaces());
  const channels = deps.channels || createChannels(config.keys);
  const agent = createAgent({ store, bus, places, channels, config, log });
  const integrations = createIntegrations({ store, bus, config, fetchImpl: deps.fetch || fetch, log });
  const devices = createDevices({ store, bus, agent });
  const plugins = { list: () => [], stop() {} };
  const ready = (deps.plugins ? Promise.resolve(deps.plugins) : loadPlugins(config.pluginsDir ? path.resolve(ROOT, config.pluginsDir) : "", log))
    .then(pl => Object.assign(plugins, wirePlugins(pl, { bus, agent, store, channels, log })));
  let sim = null;
  const setSim = on => { if (on && !sim) sim = startSimulator({ agent, store, ratePerMin: config.simulateRate, log }); if (!on && sim) { sim.stop(); sim = null; } };
  if (config.simulate && !deps.noSimulator) setSim(true);
  const clients = new Set();
  const started = Date.now();

  /* ---------- helpers ---------- */
  const cors = { "Access-Control-Allow-Origin": config.corsOrigin, "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization, X-Device-Token, X-App-Key", "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS" };
  const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json", ...cors }); res.end(JSON.stringify(body)); };
  const fail = (res, e) => send(res, e.status || 500, { error: e.status ? e.message : "Internal error" });
  const body = req => new Promise((ok, no) => {
    let d = ""; req.on("data", c => { d += c; if (d.length > 1e6) { no(Object.assign(new Error("Body too large"), { status: 413 })); req.destroy(); } });
    req.on("end", () => { if (!d) return ok({}); try { ok(JSON.parse(d)); } catch { no(Object.assign(new Error("Body must be JSON"), { status: 400 })); } });
  });
  const authed = req => {
    if (!config.apiKey) return true;
    const got = Buffer.from(String(req.headers["x-api-key"] || (req.headers.authorization || "").replace(/^Bearer /, "")));
    const want = Buffer.from(config.apiKey);
    return got.length === want.length && timingSafeEqual(got, want);
  };
  const buckets = new Map();
  const limited = req => {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
    const now = Date.now(); const b = buckets.get(ip) || { n: 0, t: now };
    if (now - b.t > 60000) { b.n = 0; b.t = now; }
    b.n++; buckets.set(ip, b);
    if (buckets.size > 10000) buckets.clear();
    return b.n > config.rateLimit.perMinute;
  };
  const snapshot = () => ({ config: store.getConfig(), stats: store.stats, integrations: integrations.list(), packages: store.listPackages({ limit: 40 }).map(agent.summary), devices: devices.list(), plugins: plugins.list(), simulate: !!sim, version: VERSION, provider: places.name });
  const appKeyOk = req => !config.deviceAppKey || req.headers["x-app-key"] === config.deviceAppKey;

  bus.subscribe(evt => { const line = `id: ${evt.id}\nevent: ${evt.type}\ndata: ${JSON.stringify({ ...evt, stats: store.stats })}\n\n`; for (const c of clients) c.write(line); });

  /* ---------- routes ---------- */
  const routes = [
    ["GET", /^\/api\/health$/, async () => ({ ok: true, version: VERSION, uptimeSec: Math.round((Date.now() - started) / 1000), provider: places.name, simulate: !!sim, streams: clients.size, ...(config.keys.googleMapsBrowser ? { mapsKey: config.keys.googleMapsBrowser } : {}) })],
    ["GET", /^\/api\/state$/, async () => snapshot()],
    ["GET", /^\/api\/stats$/, async () => store.stats],
    ["GET", /^\/api\/config$/, async () => store.getConfig()],
    ["PUT", /^\/api\/config$/, async (req) => {
      const patch = await body(req); const clean = {};
      for (const k of CONFIG_KEYS) if (k in patch) clean[k] = patch[k];
      if (clean.threshold != null && !(clean.threshold >= 1 && clean.threshold <= 5)) throw Object.assign(new Error("threshold must be 1-5"), { status: 400 });
      if (clean.fences && !(Array.isArray(clean.fences) && clean.fences.every(f => Number.isFinite(+f.lat) && Number.isFinite(+f.lng) && +f.radiusMi > 0 && +f.radiusMi <= 50))) throw Object.assign(new Error("fences need lat, lng and radiusMi between 0 and 50"), { status: 400 });
      const c = store.updateConfig(clean); bus.publish("config", { keys: Object.keys(clean) }); return c;
    }, true],
    ["POST", /^\/api\/signals$/, async (req) => {
      const b = await body(req);
      if (Array.isArray(b.signals)) return { accepted: (await Promise.all(b.signals.slice(0, 500).map(s => agent.ingest(s).catch(e => ({ error: e.message }))))) };
      return agent.ingest(b);
    }, true],
    ["GET", /^\/api\/packages$/, async (req, m, url) => store.listPackages({ limit: Math.min(200, +url.searchParams.get("limit") || 50), offset: +url.searchParams.get("offset") || 0 }).map(agent.summary)],
    ["GET", /^\/api\/packages\/([\w-]+)$/, async (req, m) => { const p = store.getPackage(m[1]); if (!p) throw Object.assign(new Error("Package not found"), { status: 404 }); return { ...agent.summary(p), messages: agent.messages(p.id) }; }],
    ["POST", /^\/api\/packages\/([\w-]+)\/reply$/, async (req, m) => { const b = await body(req); const r = agent.reply(m[1], b); if (!r) throw Object.assign(new Error("Package not found"), { status: 404 }); return r; }, true],
    ["GET", /^\/api\/integrations$/, async () => integrations.list()],
    ["POST", /^\/api\/integrations$/, async (req) => { const b = await body(req); return b.connector || b.method || b.bodyTemplate || b.headers ? integrations.addConnector(b) : integrations.add(b); }, true],
    ["POST", /^\/api\/integrations\/([\w-]+)\/test$/, async (req, m) => {
      const i = store.listIntegrations().find(x => x.id === m[1]); if (!i) throw Object.assign(new Error("Integration not found"), { status: 404 });
      const evt = { id: "test", type: "package", at: new Date().toISOString(), data: { id: "PKG-TEST", keyword: "pizza near me", business: { name: "Test Pizzeria", owner: "Test Owner" }, score: 4 } };
      if (i.connector) return integrations.callConnector(i, evt);
      if (i.url) return integrations.deliver(i.url, evt);
      return { ok: true, status: "built-in integrations are tested by their own events" };
    }, true],
    ["GET", /^\/api\/plugins$/, async () => plugins.list()],
    ["POST", /^\/api\/extract$/, async (req) => { const b = await body(req); return { matches: extractKeywords(String(b.text || "").slice(0, 2000), store.getConfig().keywords) }; }],
    ["GET", /^\/api\/devices$/, async () => devices.list(), true],
    ["POST", /^\/api\/devices$/, async (req) => { if (!appKeyOk(req)) throw Object.assign(new Error("Missing or wrong X-App-Key."), { status: 401 }); return devices.register(await body(req)); }],
    ["POST", /^\/api\/devices\/([\w-]+)\/events$/, async (req, m) => { const b = await body(req); const list = Array.isArray(b.events) ? b.events.slice(0, 100) : [b]; const out = []; for (const e of list) out.push(await devices.event(m[1], req.headers["x-device-token"], e)); return Array.isArray(b.events) ? { results: out } : out[0]; }],
    ["DELETE", /^\/api\/devices\/([\w-]+)$/, async (req, m) => { if (req.headers["x-device-token"]) return devices.optOut(m[1], req.headers["x-device-token"]); if (!authed(req)) throw Object.assign(new Error("Send the device token or the API key."), { status: 401 }); return { deleted: devices.remove(m[1]) }; }],
    ["PATCH", /^\/api\/integrations\/([\w-]+)$/, async (req, m) => { const r = integrations.toggle(m[1], (await body(req)).on); if (!r) throw Object.assign(new Error("Integration not found"), { status: 404 }); return r; }, true],
    ["DELETE", /^\/api\/integrations\/([\w-]+)$/, async (req, m) => ({ deleted: integrations.remove(m[1]) }), true],
    ["POST", /^\/api\/simulator$/, async (req) => { setSim(!!(await body(req)).on); return { simulate: !!sim }; }, true],
    ["GET", /^\/api\/events$/, async (req, m, url) => bus.recent(Math.min(500, +url.searchParams.get("limit") || 100))]
  ];

  async function handler(req, res) {
    const url = new URL(req.url, "http://x");
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    if (url.pathname.startsWith("/api/") && limited(req)) return send(res, 429, { error: "Too many requests. Slow down and retry in a minute." });

    if (req.method === "GET" && url.pathname === "/api/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no", ...cors });
      res.write(`event: hello\ndata: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 25000);
      req.on("close", () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    for (const [method, re, fn, write] of routes) {
      const m = url.pathname.match(re);
      if (!m || method !== req.method) continue;
      if (write && !authed(req)) return send(res, 401, { error: "Missing or wrong API key. Send it in the X-API-Key header." });
      try { return send(res, method === "POST" ? 201 : 200, await fn(req, m, url)); } catch (e) { if (!e.status) log.error?.(e); return fail(res, e); }
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      return res.end(await readFile(path.join(ROOT, "index.html")));
    }
    if (req.method === "GET" && (url.pathname === "/sdk.js" || url.pathname === "/prospect-sdk.js")) { res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", ...cors }); return res.end(await readFile(path.join(ROOT, "sdk", "prospect-sdk.js"))); }
    if (req.method === "GET" && url.pathname === "/openapi.yaml") { res.writeHead(200, { "Content-Type": "text/yaml", ...cors }); return res.end(await readFile(path.join(ROOT, "openapi.yaml"))); }
    send(res, 404, { error: "Not found" });
  }

  const server = http.createServer((req, res) => handler(req, res).catch(e => fail(res, e)));
  return { server, bus, store, agent, integrations, devices, ready, close() { setSim(false); agent.stop(); plugins.stop(); for (const c of clients) c.end(); return new Promise(r => server.close(r)); } };
}
