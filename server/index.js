// ProspectAI backend starter (Node 18+, zero dependencies).
// Serves the dashboard and exposes the agent loop as an API:
//   POST /api/signals            ingest a keyword signal {keyword, lat, lng, source}
//   GET  /api/prospects          find + qualify businesses (?keyword=&lat=&lng=&radius=miles)
//   POST /api/outreach           send a package {business, owner, email, phone, keyword}
//   POST /api/integrations       register a webhook {name, url, events:["signal","lead","package"]}
// Each adapter runs in "dry run" mode until its API key is present in the environment.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = process.env.PORT || 8787;
const env = process.env;
const webhooks = []; // {name, url, events}
const fences = [{ lat: 40.6782, lng: -73.9442, radiusMi: 1.5 }];

/* ---------- qualification (mirrors the dashboard rules) ---------- */
export function qualify(place, threshold = 3) {
  const fails = {
    profile: !place.website || !place.opening_hours,
    rating: (place.rating ?? 0) < 4.0,
    rank: (place.rank ?? 99) > 5,
    dirs: (place.directories ?? 0) < 3,
    ads: !place.hasAds
  };
  const n = Object.values(fails).filter(Boolean).length;
  return { fails, score: n, qualified: n >= threshold };
}

const milesBetween = (a, b) => {
  const R = 3958.8, toR = d => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const insideAnyFence = p => fences.some(f => milesBetween(f, p) <= f.radiusMi);

/* ---------- adapters ---------- */
async function placesSearch(keyword, lat, lng, radiusMi) {
  if (!env.GOOGLE_MAPS_API_KEY) return { dryRun: true, results: [] };
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.search = new URLSearchParams({ query: keyword, location: `${lat},${lng}`, radius: String(Math.round(radiusMi * 1609)), key: env.GOOGLE_MAPS_API_KEY });
  const r = await fetch(url); const j = await r.json();
  return { results: (j.results || []).map((p, i) => ({ name: p.name, address: p.formatted_address, rating: p.rating, reviews: p.user_ratings_total, placeId: p.place_id, rank: i + 1, website: null, opening_hours: p.opening_hours })) };
}
async function sendEmail({ to, subject, text }) {
  if (!env.SENDGRID_API_KEY || !to) return { dryRun: true };
  const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST", headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: env.FROM_EMAIL }, subject, content: [{ type: "text/plain", value: text }] })
  });
  return { status: r.status };
}
async function sendSms({ to, body }) {
  if (!env.TWILIO_SID || !env.TWILIO_TOKEN || !to) return { dryRun: true };
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json`, {
    method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${env.TWILIO_SID}:${env.TWILIO_TOKEN}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: body })
  });
  return { status: r.status };
}
async function publish(type, data) {
  await Promise.allSettled(webhooks.filter(w => !w.events || w.events.includes(type)).map(w =>
    fetch(w.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, data, at: new Date().toISOString() }) })));
}

/* ---------- templates ---------- */
const fill = (t, v) => t.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in v ? v[k] : m));
const TPL = {
  subject: "{{owner_name}}, {{search_count}} people searched \"{{keyword}}\" near {{business_name}}",
  email: "Hi {{owner_name}},\n\nIn the last 7 days, {{search_count}} people near {{business_name}} searched for \"{{keyword}}\". I put together a free report on where they went. Want it?\n\nHydron Culture · ProspectAI\n\nUnsubscribe: reply STOP",
  sms: "Hi {{owner_name}}, Hydron Culture here. {{search_count}} locals searched \"{{keyword}}\" near {{business_name}} this week. Want the free report? Reply YES. STOP to opt out."
};

/* ---------- http ---------- */
const json = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise(ok => { let d = ""; req.on("data", c => (d += c)); req.on("end", () => { try { ok(JSON.parse(d || "{}")); } catch { ok({}); } }); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" }); return res.end(); }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html" }); return res.end(await readFile(path.join(ROOT, "index.html")));
    }
    if (req.method === "POST" && url.pathname === "/api/signals") {
      const s = await readBody(req);
      const signal = { ...s, insideFence: insideAnyFence(s), at: new Date().toISOString() };
      await publish("signal", signal);
      return json(res, 202, signal);
    }
    if (req.method === "GET" && url.pathname === "/api/prospects") {
      const q = Object.fromEntries(url.searchParams);
      const found = await placesSearch(q.keyword, +q.lat, +q.lng, +(q.radius || 1.5));
      const scored = found.results.map(p => ({ ...p, ...qualify(p, +(q.threshold || 3)) }));
      scored.filter(p => p.qualified).forEach(p => publish("lead", p));
      return json(res, 200, { dryRun: !!found.dryRun, prospects: scored });
    }
    if (req.method === "POST" && url.pathname === "/api/outreach") {
      const b = await readBody(req);
      const vars = { owner_name: (b.owner || "there").split(" ")[0], business_name: b.business, keyword: b.keyword, search_count: b.searchCount || 25 };
      const out = {
        email: await sendEmail({ to: b.email, subject: fill(TPL.subject, vars), text: fill(TPL.email, vars) }),
        sms: await sendSms({ to: b.phone, body: fill(TPL.sms, vars) })
      };
      await publish("package", { ...b, channels: out });
      return json(res, 200, out);
    }
    if (req.method === "POST" && url.pathname === "/api/integrations") {
      const w = await readBody(req);
      if (!/^https:\/\//.test(w.url || "")) return json(res, 400, { error: "url must start with https://" });
      webhooks.push({ name: w.name, url: w.url, events: w.events });
      return json(res, 201, { ok: true, count: webhooks.length });
    }
    json(res, 404, { error: "Not found" });
  } catch (e) { json(res, 500, { error: e.message }); }
}).listen(PORT, () => console.log(`ProspectAI on http://localhost:${PORT}`));
