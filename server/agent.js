// The Ad Engine Agent: signal -> geofence -> business lookup -> qualify -> package -> channels -> follow-up sequence.
import { fill, varsFor } from "./templates.js";
import { competitorFor } from "./providers/places.js";

export const CRITERIA = ["profile", "rating", "rank", "dirs", "ads"];
export const SOURCES = ["search", "maps", "voice", "pixel"];

export const SEQUENCE_FULL = [
  { day: 1, ch: "email" }, { day: 1, ch: "sms" }, { day: 3, ch: "sms" }, { day: 4, ch: "dm" },
  { day: 5, ch: "social" }, { day: 7, ch: "call" }, { day: 8, ch: "email" }, { day: 10, ch: "voice" }
];
export const SEQUENCE_MVP = [{ day: 1, ch: "email" }, { day: 3, ch: "sms" }, { day: 7, ch: "call" }];

export function milesBetween(a, b) {
  const R = 3958.8, toR = d => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function weakSignals(b) {
  return {
    profile: !b.website || b.hasHours === false || b.hasPhotos === false,
    rating: (b.rating ?? 0) < 4.0,
    rank: (b.rank ?? 99) > 5,
    dirs: b.dirs != null ? b.dirs < 3 : false,
    ads: b.hasAds === false
  };
}

export function qualify(b, { criteria, threshold }) {
  const fails = weakSignals(b);
  const active = CRITERIA.filter(c => criteria[c]);
  const failed = active.filter(c => fails[c]);
  return { fails, failed, score: failed.length, qualified: failed.length >= Math.min(threshold, active.length || 1) };
}

export function createAgent({ store, bus, places, channels, config, log = console }) {
  const timers = new Set();

  async function ingest(raw) {
    const cfg = store.getConfig();
    const source = SOURCES.includes(raw.source) ? raw.source : "search";
    const lat = Number(raw.lat), lng = Number(raw.lng);
    if (!raw.keyword || !Number.isFinite(lat) || !Number.isFinite(lng)) throw Object.assign(new Error("keyword, lat and lng are required"), { status: 400 });
    if (!cfg.sources[source]) return { ignored: true, reason: `source ${source} is off` };
    const term = String(raw.keyword).toLowerCase().trim().slice(0, 80);
    const kw = cfg.keywords.find(k => k.term === term) || { term, cat: raw.category || "Restaurant", color: "#94A3B8", on: true };
    const insideFence = cfg.fences.some(f => milesBetween(f, { lat, lng }) <= f.radiusMi);
    const signal = { keyword: term, color: kw.color, source, lat, lng, insideFence, tracked: !!kw.on };
    store.bump("sig");
    if (insideFence) { store.bump("inside"); if (source === "voice") store.bump("voice"); if (source === "pixel") store.bump("pixel"); }
    const evt = bus.publish("signal", signal);
    if (insideFence && kw.on) {
      if (cfg.bridge && (source === "voice" || source === "pixel")) bus.publish("bridge", { from: source, to: source === "voice" ? "pixel" : "voice", keyword: term, lat, lng });
      process(signal, kw).catch(e => log.error?.("agent:", e.message));
    }
    return { id: evt.id, ...signal };
  }

  async function process(signal, kw) {
    const cfg = store.getConfig();
    const results = await places.search({ keyword: kw.term, category: kw.cat, lat: signal.lat, lng: signal.lng, radiusMi: cfg.fences[0]?.radiusMi, locationName: cfg.location?.name });
    if (!results.length) return;
    const found = results[Math.floor(Math.random() * results.length)];
    const biz = store.getBusiness(found.id) || { ...found, demand: 0 };
    biz.demand = (biz.demand || 0) + 1;
    store.upsertBusiness(biz);

    if (biz.packageId) {
      const p = store.getPackage(biz.packageId);
      if (p) { p.demand = biz.demand; store.putPackage(p); bus.publish("demand", { packageId: p.id, business: biz.name, demand: p.demand }); }
      return;
    }
    const q = qualify(biz, cfg);
    biz.fails = q.fails;
    if (!q.qualified) {
      if (!biz.monitor) { biz.monitor = true; store.bump("unq"); bus.publish("monitor", { business: biz.name, score: q.score, keyword: kw.term }); }
      store.upsertBusiness(biz);
      return;
    }
    store.bump("qual");
    bus.publish("lead", { business: biz.name, owner: biz.owner, keyword: kw.term, score: q.score, failed: q.failed });

    const enabled = Object.entries(cfg.channels).filter(([, on]) => on).map(([id]) => id);
    const pkg = {
      id: store.nextPackageId(), keyword: kw.term, color: kw.color, business: biz, competitor: competitorFor(biz),
      score: q.score, failed: q.failed, demand: biz.demand, lat: signal.lat, lng: signal.lng,
      channels: enabled.map(id => ({ id, status: "queued" })), createdAt: new Date().toISOString(), cycle: 1, replied: false, booked: false
    };
    biz.packageId = pkg.id; store.upsertBusiness(biz); store.putPackage(pkg);
    bus.publish("package", summary(pkg));

    await Promise.all(pkg.channels.map(async c => {
      c.result = await send(c.id, pkg).catch(e => ({ status: "failed", error: e.message }));
      c.status = c.result.status === "failed" ? "failed" : "sent";
      bus.publish("touch", { packageId: pkg.id, channel: c.id, status: c.status, result: c.result.status });
    }));
    store.putPackage(pkg); store.bump("pkg");
    bus.publish("package", summary(pkg));
    schedule(pkg);
  }

  function messages(pkg) {
    const cfg = store.getConfig(); const t = cfg.templates; const v = varsFor(pkg, cfg);
    return { subject: fill(t.emailSubject, v), email: fill(t.email, v), sms: fill(t.sms, v), call: fill(t.call, v), voice: fill(t.voice, v), ad: fill(t.ad, v) };
  }

  function send(ch, pkg) {
    const m = messages(pkg); const b = pkg.business;
    switch (ch) {
      case "email": return channels.email({ to: b.email, subject: m.subject, body: m.email });
      case "sms": return channels.sms({ to: b.phone, body: m.sms });
      case "call": return channels.call({ to: b.phone, script: m.call });
      case "voice": return channels.voice({ to: b.phone, message: m.voice });
      case "social": return channels.social({ email: b.email, phone: b.phone, keyword: pkg.keyword });
      case "dm": return channels.dm({ to: b.phone, body: m.sms });
      case "mail": return channels.mail({ address: b.address, body: m.email });
      default: return channels[ch] ? channels[ch]({}) : Promise.resolve({ status: "dry_run", reason: "unknown channel" });
    }
  }

  function schedule(pkg) {
    const cfg = store.getConfig();
    const steps = (cfg.mvp ? SEQUENCE_MVP : SEQUENCE_FULL).filter(s => s.day > 1 && cfg.channels[s.ch]);
    for (const s of steps) {
      const t = setTimeout(async () => {
        timers.delete(t);
        const p = store.getPackage(pkg.id); if (!p || p.replied) return;
        const r = await send(s.ch, p).catch(e => ({ status: "failed", error: e.message }));
        bus.publish("touch", { packageId: p.id, channel: s.ch, day: s.day, status: r.status === "failed" ? "failed" : "sent", result: r.status });
      }, (s.day - 1) * config.sequenceDayMs);
      timers.add(t);
    }
  }

  // Inbound replies (Twilio/SendGrid inbound webhooks, or the dashboard) move a package forward.
  function reply(id, { booked = false } = {}) {
    const p = store.getPackage(id); if (!p) return null;
    if (!p.replied) { p.replied = true; store.bump("rep"); bus.publish("reply", summary(p)); }
    if (booked && !p.booked) { p.booked = true; store.bump("book"); bus.publish("booked", summary(p)); }
    store.putPackage(p); return summary(p);
  }

  function summary(p) {
    const { business: b } = p;
    return { id: p.id, keyword: p.keyword, color: p.color, score: p.score, failed: p.failed, demand: p.demand, lat: p.lat, lng: p.lng,
      channels: p.channels.map(({ id, status }) => ({ id, status })), replied: p.replied, booked: p.booked, createdAt: p.createdAt,
      business: { id: b.id, name: b.name, owner: b.owner, rating: b.rating, reviews: b.reviews, rank: b.rank, dirs: b.dirs, website: b.website, fails: b.fails, simulated: !!b.simulated },
      competitor: p.competitor, owner: b.owner };
  }

  return { ingest, reply, messages: id => { const p = store.getPackage(id); return p ? messages(p) : null; }, summary, stop: () => timers.forEach(clearTimeout) };
}
