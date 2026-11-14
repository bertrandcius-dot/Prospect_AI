import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { qualify, milesBetween } from "../server/agent.js";

const baseConfig = { port: 0, host: "127.0.0.1", apiKey: "secret", corsOrigin: "*", dataFile: "", simulate: false, simulateRate: 30, sequenceDayMs: 60_000, rateLimit: { perMinute: 1000 }, webhookSecret: "whsec", keys: {} };

test("qualify counts only enabled criteria", () => {
  const b = { website: null, rating: 3.2, rank: 12, dirs: 1, hasAds: false };
  const all = { profile: true, rating: true, rank: true, dirs: true, ads: true };
  assert.equal(qualify(b, { criteria: all, threshold: 3 }).score, 5);
  assert.equal(qualify(b, { criteria: { ...all, ads: false, dirs: false }, threshold: 3 }).score, 3);
  assert.equal(qualify({ website: "x", hasHours: true, hasPhotos: true, rating: 4.7, rank: 1, dirs: 5, hasAds: true }, { criteria: all, threshold: 3 }).qualified, false);
});

test("milesBetween is roughly right", () => {
  const d = milesBetween({ lat: 40.6782, lng: -73.9442 }, { lat: 40.7128, lng: -74.006 });
  assert.ok(d > 3.5 && d < 4.5, String(d));
});

test("signal inside the fence produces a package and reaches a webhook", async () => {
  const delivered = [];
  const fakeFetch = async (url, opts) => { delivered.push({ url, headers: opts.headers, body: JSON.parse(opts.body) }); return { ok: true, status: 200 }; };
  const app = createApp(baseConfig, { noSimulator: true, fetch: fakeFetch, log: { error() {}, warn() {} } });
  await new Promise(r => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const H = { "Content-Type": "application/json", "X-API-Key": "secret" };
  try {
    assert.equal((await fetch(base + "/api/signals", { method: "POST", body: "{}" })).status, 401);
    const wh = await fetch(base + "/api/integrations", { method: "POST", headers: H, body: JSON.stringify({ name: "Test hook", url: "https://hooks.example.com/x", events: "all" }) });
    assert.equal(wh.status, 201);
    // Lower the bar so any simulated business qualifies
    await fetch(base + "/api/config", { method: "PUT", headers: H, body: JSON.stringify({ threshold: 1, criteria: { profile: true, rating: true, rank: true, dirs: true, ads: true } }) });
    for (let i = 0; i < 12; i++) await fetch(base + "/api/signals", { method: "POST", headers: H, body: JSON.stringify({ keyword: "pizza near me", lat: 40.6782, lng: -73.9442, source: "search" }) });
    const out = await (await fetch(base + "/api/signals", { method: "POST", headers: H, body: JSON.stringify({ keyword: "pizza near me", lat: 41.5, lng: -73.9, source: "search" }) })).json();
    assert.equal(out.insideFence, false);
    await new Promise(r => setTimeout(r, 100));
    const pk = await (await fetch(base + "/api/packages")).json();
    assert.ok(pk.length >= 1, "expected at least one package");
    const detail = await (await fetch(base + "/api/packages/" + pk[0].id)).json();
    assert.match(detail.messages.email, new RegExp(detail.business.owner.split(" ")[0]));
    assert.ok(detail.channels.every(c => c.status === "sent"), "dry-run channels count as sent");
    const rep = await (await fetch(base + `/api/packages/${pk[0].id}/reply`, { method: "POST", headers: H, body: JSON.stringify({ booked: true }) })).json();
    assert.equal(rep.booked, true);
    const stats = await (await fetch(base + "/api/stats")).json();
    assert.equal(stats.book, 1);
    const hook = delivered.filter(d => d.url === "https://hooks.example.com/x");
    assert.ok(hook.some(d => d.body.type === "package"), "webhook got package event");
    assert.match(hook[0].headers["X-Prospect-Signature"], /^sha256=[0-9a-f]{64}$/);
  } finally { await app.close(); }
});

test("bad input is rejected with 400", async () => {
  const app = createApp({ ...baseConfig, apiKey: "" }, { noSimulator: true, log: { error() {}, warn() {} } });
  await new Promise(r => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    assert.equal((await fetch(base + "/api/signals", { method: "POST", body: JSON.stringify({ keyword: "x" }) })).status, 400);
    assert.equal((await fetch(base + "/api/integrations", { method: "POST", body: JSON.stringify({ name: "x", url: "http://insecure" }) })).status, 400);
    assert.equal((await fetch(base + "/api/config", { method: "PUT", body: JSON.stringify({ threshold: 9 }) })).status, 400);
  } finally { await app.close(); }
});
